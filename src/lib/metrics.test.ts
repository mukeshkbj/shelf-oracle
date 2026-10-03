import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  actualRanking, bayesianMean, brandRanking, consensusRanking,
  permutationPValue, predictorScore, spearman, suggestNextProduct, topKOverlap, weightedScore,
} = require("./metrics.ts") as typeof import("./metrics");

const map = (ids: string[]) => new Map(ids.map((id, index) => [id, index + 1]));

test("Event weights deterministically change scores and reject incomplete rubrics", () => {
  const scores = [{ principle: "novelty", score: 10 }, { principle: "salience", score: 1 }];
  assert.equal(weightedScore([{ key: "novelty", weight: 2 }, { key: "salience", weight: 1 }], scores), 7);
  assert.equal(weightedScore([{ key: "novelty", weight: 1 }, { key: "salience", weight: 2 }], scores), 4);
  assert.throws(() => weightedScore([{ key: "missing", weight: 1 }], scores));
});

test("Spearman is exact for identical and opposite orders", () => {
  assert.equal(spearman(map(["a", "b", "c", "d", "e"]), map(["a", "b", "c", "d", "e"])), 1);
  assert.equal(spearman(map(["a", "b", "c", "d", "e"]), map(["e", "d", "c", "b", "a"])), -1);
  assert.equal(spearman(map(["a", "b"]), map(["b", "a"])), null);
  assert.equal(spearman(new Map([["a", 1], ["b", 2], ["c", 5]]), map(["a", "b", "c"])), 1);
  assert.equal(permutationPValue(map(["a", "b", "c", "d", "e"]), map(["a", "b", "c", "d", "e"])), 2 / 120);
});

test("Bayesian ranking excludes untasted products and consistently breaks ties", () => {
  assert.equal(bayesianMean([5], 3), 3.5);
  const actual = actualRanking(["z", "b", "a"], [
    { product_id: "b", rating: 5 }, { product_id: "a", rating: 5 },
  ]);
  assert.deepEqual(actual.map((p) => [p.productId, p.rank]), [["a", 1], ["b", 2], ["z", null]]);
  assert.equal(actual[2].mean, null);
});

test("Borda consensus and best-SKU brand aggregation", () => {
  const consensus = consensusRanking([["a", "b", "c", "d", "e"], ["b", "a", "c", "e", "d"]]);
  assert.deepEqual(consensus.map(({ productId, points }) => [productId, points]),
    [["a", 9], ["b", 9], ["c", 6], ["d", 3], ["e", 3]]);
  assert.deepEqual(brandRanking([
    { productId: "a", brand: "Acme", rank: 3, mean: 4 },
    { productId: "b", brand: "acme", rank: 1, mean: 5 },
    { productId: "c", brand: "Other", rank: 2, mean: 4.5 },
  ]), [{ brand: "acme", rank: 1, mean: 5 }, { brand: "Other", rank: 2, mean: 4.5 }]);
});

test("Next-taste suggestion uses personal ratings and public pack cues", () => {
  const shelf = [
    { id: "a", name: "Apple crisps", category: "Snacks", claims: ["vegan"] },
    { id: "b", name: "Berry crisps", category: "Snacks", claims: ["vegan"] },
    { id: "c", name: "Cola", category: "Drinks", claims: [] },
  ];
  assert.equal(suggestNextProduct(shelf, [{ productId: "a", rating: 5 }])?.product.id, "b");
  assert.equal(suggestNextProduct(shelf, [{ productId: "a", rating: 2 }, { productId: "b", rating: 1 }])?.product.id, "c");
  assert.equal(suggestNextProduct(shelf, shelf.map((product) => ({ productId: product.id, rating: 5 }))), null);
});

test("Predictor score requires both order and actual hits", () => {
  assert.equal(predictorScore(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e"]), 100);
  assert.equal(predictorScore(["f", "g", "h", "i", "j"], ["a", "b", "c", "d", "e"]), 0);
  assert.equal(predictorScore(["e", "d", "c", "b", "a"], ["a", "b", "c", "d", "e"]), 40);
  assert.equal(topKOverlap(["a", "b", "c"], ["b", "d", "e"]), 1);
});
