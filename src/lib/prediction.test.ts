import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Script } from "node:vm";
import OpenAI from "openai";
import { z } from "zod";
import { PRINCIPLES, TOTAL_WEIGHT } from "./principles.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
type AI = Pick<typeof import("./ai.ts"), "scoreProducts">;
const products = ["product-a", "product-b"].map((id) => ({
  id, brand: "Test brand", name: "Test product", category: "Snacks",
  claims: [], price: null, attributes: {},
}));

function loadModule<T>(path: string, imports: Record<string, unknown>, logs: unknown[] = []): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const loaded = { exports: {} };
  new Script(outputText, { filename: path }).runInNewContext({
    module: loaded,
    exports: loaded.exports,
    require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    process: { env: { AI_API_KEY: "test-secret-key", AI_MODEL: "gemini-3.5-flash" } },
    console: { error: (...args: unknown[]) => logs.push(args) },
  });
  return loaded.exports as T;
}

function aiHarness(body: unknown, status = 200) {
  let calls = 0;
  class MockTransportOpenAI extends OpenAI {
    constructor(options: ConstructorParameters<typeof OpenAI>[0]) {
      super({ ...options, fetch: async () => {
        calls += 1;
        assert.ok(calls <= 1, "Scoring must not retry a failed provider request");
        return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      } });
    }
  }
  const ai = loadModule<AI>("./ai.ts", {
    "server-only": {}, openai: MockTransportOpenAI, zod: { z },
    "./principles": { PRINCIPLES, TOTAL_WEIGHT },
  });
  return { ai, calls: () => calls };
}

function completeScores() {
  return { items: products.map(({ id }) => ({
    productId: id,
    principles: PRINCIPLES.map(({ key }) => ({ principle: key, score: 6, rationale: "Visible pack evidence." })),
  })) };
}

function completion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] };
}

class AuthError extends Error {}
class ForbiddenError extends Error {}

function routeHarness(ai: AI, status = "intake") {
  const logs: unknown[] = [];
  let writes = 0;
  const route = loadModule<{ POST: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }>("../app/api/events/[id]/predict/route.ts", {
    "next/server": require("next/server"), openai: OpenAI, "@/lib/ai": ai,
    "@/lib/auth": { AuthError, ForbiddenError, requireUser: async () => ({ id: "test-user" }),
      requireEventMember: async () => ({ status, settings: {}, settings_version: 1, products_version: 1 }) },
    "@/lib/principles": { PRINCIPLES },
    "@/lib/reveal": { eventRows: async () => products },
    "@/lib/metrics": { weightedScore: () => { throw new Error("Failed scoring must not reach weighting"); } },
    "@/lib/supabase/admin": { supabaseAdmin: () => { writes += 1; throw new Error("Unexpected database write"); } },
  }, logs);
  return { logs, writes: () => writes,
    post: () => route.POST(new Request("https://example.test/api/events/test-event/predict", { method: "POST" }), {
      params: Promise.resolve({ id: "test-event" }),
    }),
  };
}

test("Gemini's array-shaped daily quota error becomes actionable HTTP 429 with no retry or database writes", async () => {
  const harness = aiHarness([{ error: {
    code: 429, status: "RESOURCE_EXHAUSTED", message: "Private provider detail: test-secret-key data:image/jpeg;base64,private",
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20",
    }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "28392s" }],
  } }], 429);
  const route = routeHarness(harness.ai);
  const response = await route.post();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, "AI_QUOTA_EXCEEDED");
  assert.match(body.error, /daily.*reset/);
  assert.match(body.error, /Google AI Studio/);
  assert.doesNotMatch(JSON.stringify([body, route.logs]), /test-secret-key|data:image|Private provider|product-a/);
  assert.deepEqual(JSON.parse(JSON.stringify(route.logs)), [["Prediction failed", { code: "AI_QUOTA_EXCEEDED", providerStatus: 429 }]]);
  assert.equal(harness.calls(), 1);
  assert.equal(route.writes(), 0);
});

test("Scoring still requires every product and every principle rather than filling invented scores", async () => {
  const missingProduct = completeScores();
  missingProduct.items.pop();
  const duplicateProduct = completeScores();
  duplicateProduct.items[1].productId = duplicateProduct.items[0].productId;
  const missingPrinciple = completeScores();
  missingPrinciple.items[0].principles.pop();
  const invalidScore = completeScores();
  invalidScore.items[0].principles[0].score = 11;
  for (const output of [missingProduct, duplicateProduct, missingPrinciple, invalidScore]) {
    const harness = aiHarness(completion(output));
    const route = routeHarness(harness.ai);
    const response = await route.post();
    assert.equal(response.status, 502);
    assert.equal(harness.calls(), 1);
    assert.equal(route.writes(), 0);
  }
});

test("A complete rubric still scores successfully in one provider call", async () => {
  const harness = aiHarness(completion(completeScores()));
  const scores = await harness.ai.scoreProducts(products, new Map());
  assert.equal(harness.calls(), 1);
  assert.equal(scores.size, products.length);
  for (const product of products) {
    const result = scores.get(product.id)!;
    assert.equal(result.score, 60);
    assert.deepEqual(Array.from(result.principles, (entry) => entry.principle), PRINCIPLES.map((entry) => entry.key));
    assert.ok(result.principles.every((entry) => entry.score === 6 && entry.rationale === "Visible pack evidence."));
  }
});

test("Locked events do not invoke the provider or write predictions", async () => {
  const harness = aiHarness(completion(completeScores()));
  for (const status of ["locked", "voting", "revealed", "closed"]) {
    const route = routeHarness(harness.ai, status);
    const response = await route.post();
    assert.equal(response.status, 409);
    assert.equal(harness.calls(), 0);
    assert.equal(route.writes(), 0);
    assert.equal(route.logs.length, 0);
  }
});

test("Other provider failures retain a failure response and log only a controlled code and HTTP status", async () => {
  const harness = aiHarness({ error: { message: "Private provider detail: test-secret-key", code: "private-code" } }, 500);
  const route = routeHarness(harness.ai);
  const response = await route.post();
  assert.equal(response.status, 502);
  assert.equal(harness.calls(), 1);
  assert.equal(route.writes(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(route.logs)), [["Prediction failed", { code: "PREDICTION_FAILED", providerStatus: 500 }]]);
  assert.doesNotMatch(JSON.stringify([await response.json(), route.logs]), /test-secret-key|private-code|Private provider/);
});
