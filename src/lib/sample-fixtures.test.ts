import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalHash } from "./hash.ts";
import { PRINCIPLES } from "./principles.ts";
import { adaptSample, localFixturesEnabled, readSampleArchive } from "./sample-fixtures.ts";

function sourceFixture(status = "revealed") {
  const eventId = "20000000-0000-4000-8000-000000000001";
  const lockedAt = "2026-10-03T13:00:00Z";
  const products = Array.from({ length: 5 }, (_, index) => ({
    id: `30000000-0000-4000-8000-00000000000${index + 1}`,
    event_id: eventId, brand: "Fixture brand", name: `Sample ${index + 1}`,
    category: "Snacks", format: "pouch", price: null, claims: ["vegan"],
    attributes: { flavour: "salted", vegan: true, principle_scores: { novelty: 10 } },
    thumb: "data:image/svg+xml;base64,PHN2Zy8+", created_at: "2026-10-03T10:00:00Z",
  }));
  const payload = {
    eventId, lockedAt, model: "gemini-3.5-flash",
    principles: PRINCIPLES.map(({ key }) => ({ key, weight: 1 })),
    ranking: products.map((product, index) => ({
      productId: product.id, brand: product.brand, name: product.name,
      rank: index + 1, score: 5,
      scores: Object.fromEntries(PRINCIPLES.map(({ key }) => [key, 5])),
      rationale: "Synthetic source rationale",
    })),
  };
  const hash = canonicalHash(payload);
  return {
    event: { id: eventId, slug: "sample-panel", name: "Sample panel", location: null,
      status, locked_at: lockedAt, lock_hash: hash,
      created_at: "2026-10-03T09:00:00Z", settings: { principles: payload.principles } },
    products, prediction: { event_id: eventId, locked_at: lockedAt, hash, payload },
    votes: products.map((product, index) => ({ event_id: eventId, voter_id: "anon_fixture",
      product_id: product.id, rating: 5 - index, comment: null, created_at: "2026-10-03T14:00:00Z" })),
    guesses: [{ event_id: eventId, voter_id: "anon_fixture", display_name: "Fixture taster",
      top5: products.map((product) => product.id), created_at: "2026-10-03T13:30:00Z" }],
    reveal: { generatedAt: "2026-10-03T18:00:00Z", metrics: { spearman: -999 } },
  };
}

test("Synthetic samples convert deterministically without reusing old proof or cached metrics", () => {
  const source = sourceFixture();
  const before = JSON.stringify(source);
  const fixture = adaptSample(source);
  assert.deepEqual(fixture, adaptSample(source));
  assert.equal(JSON.stringify(source), before);
  assert.equal(fixture.provenance.sourceHashVerified, true);
  assert.equal(fixture.provenance.sourceHash, source.prediction.hash);
  assert.notEqual(fixture.lockHash, source.prediction.hash);
  assert.equal(canonicalHash(fixture.prediction), fixture.lockHash);
  assert.equal(fixture.prediction?.model, "synthetic-fixture");
  assert.equal(fixture.prediction?.items[0].score, 50);
  assert.equal(fixture.products[0].thumb, null);
  assert.equal("principle_scores" in fixture.products[0].attributes, false);
  assert.ok(Object.values(fixture.products[0].attributes).every((value) => typeof value === "string"));
  assert.match(fixture.votes[0].voter_id, /^v_[a-f0-9]{32}$/);
  assert.equal(fixture.votes[0].voter_id, fixture.guesses[0].voter_id);
  assert.equal(fixture.reveal?.voteCount, 5);
  assert.equal(fixture.reveal?.metrics.spearman, 1);
});

test("Sample conversion rejects tampered hashes and invalid vote references", () => {
  const tampered = sourceFixture();
  tampered.prediction.payload.ranking[0].scores.novelty = 9;
  assert.throws(() => adaptSample(tampered), /hash/i);
  const invalid = sourceFixture();
  invalid.votes[0].product_id = "30000000-0000-4000-8000-000000000099";
  assert.throws(() => adaptSample(invalid), /product/i);
});

test("Unpublished fixtures preserve reveal gates and production disables fixture mode", () => {
  assert.equal(adaptSample(sourceFixture("voting")).reveal, null);
  assert.equal(localFixturesEnabled("production", "sample.zip"), false);
  assert.equal(localFixturesEnabled("development", "sample.zip"), true);
});

test("Provided archive converts all 17 events without network calls", { skip: !process.env.SHELF_ORACLE_SAMPLE_ZIP }, () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Fixture conversion must not make network calls"); };
  try {
    const fixtures = readSampleArchive(process.env.SHELF_ORACLE_SAMPLE_ZIP!);
    assert.equal(fixtures.length, 17);
    assert.equal(fixtures.reduce((sum, fixture) => sum + fixture.products.length, 0), 200);
    assert.equal(fixtures.reduce((sum, fixture) => sum + fixture.votes.length, 0), 5215);
    assert.equal(fixtures.reduce((sum, fixture) => sum + fixture.guesses.length, 0), 370);
    assert.equal(fixtures.filter((fixture) => fixture.provenance.sourceHashVerified).length, 15);
    assert.equal(fixtures.filter((fixture) => fixture.reveal).length, 14);
    assert.equal(fixtures.find((fixture) => fixture.event.slug === "eat-hack-2026-rehearsal")?.reveal, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Local fixture report renders non-empty accessible chart titles", { skip: !process.env.SHELF_ORACLE_FIXTURE_BASE_URL }, async () => {
  const base = new URL(process.env.SHELF_ORACLE_FIXTURE_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  const response = await fetch(new URL("/fixtures/popcorn-and-puffs-2026", base));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("LOCAL SYNTHETIC PREVIEW"));
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((match) => match[1]);
  assert.ok(titles.length > 1);
  assert.ok(titles.every((title) => title.trim().length > 0), "SVG chart titles must survive server rendering");
  const unpublished = await fetch(new URL("/api/fixtures/eat-hack-2026-rehearsal", base));
  assert.equal(unpublished.status, 404);
});
