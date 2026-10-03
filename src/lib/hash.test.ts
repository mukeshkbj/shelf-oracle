import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { canonicalHash, canonicalJson } = require("./hash.ts") as typeof import("./hash");

test("SHA-256 canonical payload ignores key order, but not ordered arrays or lock timestamp", () => {
  const payload = { createdAt: "2026-10-03T12:00:00.000Z", items: [{ id: "1", score: 3 }], nested: { b: 1, a: 2 } };
  const shuffled = { nested: { a: 2, b: 1 }, items: [{ score: 3, id: "1" }], createdAt: payload.createdAt };
  assert.equal(canonicalJson(payload), canonicalJson(shuffled));
  assert.equal(canonicalHash(payload), canonicalHash(shuffled));
  assert.match(canonicalHash(payload), /^[0-9a-f]{64}$/);
  assert.equal(createHash("sha256").update(canonicalJson(payload)).digest("hex"), canonicalHash(payload));
  assert.notEqual(canonicalHash({ ...payload, lockedAt: "2026-10-03T12:01:00.000Z" }),
    canonicalHash({ ...payload, lockedAt: "2026-10-03T12:02:00.000Z" }));
  assert.notEqual(canonicalHash({ items: ["a", "b"] }), canonicalHash({ items: ["b", "a"] }));
});
