// Metrics — pure functions, unit-tested (node:test). No I/O.

import type { HumanPrediction, PredictionPayload, Product, RevealPayload, Vote } from "./types";

export interface Rankable {
  productId: string;
  value: number;
}

export function weightedScore(
  rubric: { key: string; weight: number }[],
  scores: { principle: string; score: number }[]
): number {
  const byKey = new Map(scores.map((item) => [item.principle, item.score]));
  const total = rubric.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(total) || total <= 0 || rubric.some((item) =>
    !Number.isFinite(item.weight) || item.weight <= 0 ||
    !Number.isFinite(byKey.get(item.key)) || byKey.get(item.key)! < 1 || byKey.get(item.key)! > 10))
    throw new Error("Incomplete weighted behavioural rubric");
  return rubric.reduce((sum, item) => sum + item.weight * byKey.get(item.key)!, 0) / total;
}

/** Bayesian mean shrinks small-sample ratings toward the global mean. */
export function bayesianMean(ratings: number[], globalMean: number, C = 3): number {
  const n = ratings.length;
  if (n === 0) return globalMean;
  const sum = ratings.reduce((s, r) => s + r, 0);
  return (n / (n + C)) * (sum / n) + (C / (n + C)) * globalMean;
}

export function rank(values: Rankable[]): { productId: string; rank: number }[] {
  const sorted = [...values].sort((a, b) => b.value - a.value || a.productId.localeCompare(b.productId));
  return sorted.map((v, i) => ({ productId: v.productId, rank: i + 1 }));
}

function normalizedRanks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const positions = new Map<number, number>();
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j] === sorted[i]) j++;
    positions.set(sorted[i], (i + 1 + j) / 2);
    i = j;
  }
  return values.map((value) => positions.get(value)!);
}

export function spearman(
  a: Map<string, number>,
  b: Map<string, number>
): number | null {
  const keys = [...a.keys()].filter((k) => b.has(k)).sort();
  if (keys.length < 3) return null;
  return pearson(normalizedRanks(keys.map((key) => a.get(key)!)),
    normalizedRanks(keys.map((key) => b.get(key)!)));
}

/** Two-sided permutation test: P(|rho_perm| >= |rho_obs|). Deterministic seed. */
export function permutationPValue(
  a: Map<string, number>,
  b: Map<string, number>,
  iterations = 2000
): number | null {
  const observed = spearman(a, b);
  if (observed === null) return null;
  const keys = [...a.keys()].filter((k) => b.has(k)).sort();
  const aRanks = normalizedRanks(keys.map((k) => a.get(k)!));
  const bRanks = normalizedRanks(keys.map((k) => b.get(k)!));
  let count = 0;
  const exceeds = (values: number[]) => {
    const rho = pearson(aRanks, values);
    if (rho !== null && Math.abs(rho) + 1e-12 >= Math.abs(observed)) count++;
  };
  if (keys.length <= 8) {
    const permute = (arr: number[], start: number) => {
      if (start === arr.length) {
        exceeds(arr);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        [arr[start], arr[i]] = [arr[i], arr[start]];
        permute(arr, start + 1);
        [arr[start], arr[i]] = [arr[i], arr[start]];
      }
    };
    permute([...bRanks], 0);
    let factorial = 1;
    for (let i = 2; i <= keys.length; i++) factorial *= i;
    return count / factorial;
  }
  if (!Number.isInteger(iterations) || iterations < 1) return null;
  // xorshift32 — deterministic shuffle for reproducible tests.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  for (let i = 0; i < iterations; i++) {
    const perm = [...bRanks];
    for (let j = perm.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [perm[j], perm[k]] = [perm[k], perm[j]];
    }
    exceeds(perm);
  }
  return (count + 1) / (iterations + 1);
}

export interface ActualRank {
  productId: string;
  rank: number | null;
  mean: number | null;
  adjustedMean: number | null;
  votes: number;
}

export function actualRanking(
  productIds: string[],
  votes: { product_id: string; rating: number }[]
): ActualRank[] {
  const ids = new Set(productIds);
  const ratings = new Map(productIds.map((id) => [id, [] as number[]]));
  for (const vote of votes) {
    if (ids.has(vote.product_id) && Number.isFinite(vote.rating) && vote.rating >= 1 && vote.rating <= 5)
      ratings.get(vote.product_id)!.push(vote.rating);
  }
  const all = [...ratings.values()].flat();
  const globalMean = all.length ? all.reduce((sum, value) => sum + value, 0) / all.length : 3;
  const rows = [...ratings].map(([productId, scores]) => ({
    productId,
    rank: null as number | null,
    mean: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    adjustedMean: scores.length ? bayesianMean(scores, globalMean) : null,
    votes: scores.length,
  }));
  rows.sort((a, b) => (b.adjustedMean ?? -1) - (a.adjustedMean ?? -1) || a.productId.localeCompare(b.productId));
  let currentRank = 0;
  for (const row of rows) {
    if (row.votes) row.rank = ++currentRank;
  }
  return rows;
}

export function brandRanking(
  products: { productId: string; brand: string; rank: number | null; mean?: number | null }[]
): { brand: string; rank: number | null; mean: number | null }[] {
  const brands = new Map<string, { brand: string; rank: number | null; mean: number | null }>();
  for (const item of products) {
    const brand = item.brand.trim();
    const key = brand.toLocaleLowerCase("en");
    const current = brands.get(key);
    if (!current || (item.rank !== null && (current.rank === null || item.rank < current.rank)))
      brands.set(key, { brand, rank: item.rank, mean: item.mean ?? null });
  }
  return [...brands.values()].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.brand.localeCompare(b.brand));
}

export function topKOverlap(
  predictedTop: string[],
  actualTop: string[]
): number {
  const set = new Set(actualTop);
  return predictedTop.filter((id) => set.has(id)).length;
}

export function meanAbsRankError(
  predicted: Map<string, number>,
  actual: Map<string, number>
): number {
  const keys = [...predicted.keys()].filter((k) => actual.has(k));
  if (keys.length === 0) return 0;
  const sum = keys.reduce(
    (s, k) => s + Math.abs(predicted.get(k)! - actual.get(k)!),
    0
  );
  return sum / keys.length;
}

/**
 * Principle attribution: correlate each principle's score with actual ratings
 * across products — "what the room actually valued". Returns the pearson r per
 * principle for products that have both a score and ≥1 vote.
 */
export function principleAttribution(
  perProduct: {
    productId: string;
    principleScores: Record<string, number>;
    actualValue: number;
  }[],
  principleKeys: string[]
): { principle: string; r: number }[] {
  return principleKeys.map((key) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of perProduct) {
      const s = p.principleScores[key];
      if (s !== undefined) {
        xs.push(s);
        ys.push(p.actualValue);
      }
    }
    return { principle: key, r: pearson(xs, ys) ?? 0 };
  });
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Borda consensus over ordered top-5 lists: rank1=5pts … rank5=1pt. */
export function consensusRanking(
  top5s: string[][]
): { productId: string; points: number; rank: number }[] {
  const points = new Map<string, number>();
  for (const top5 of top5s) {
    const seen = new Set<string>();
    top5.slice(0, 5).forEach((pid, i) => {
      if (seen.has(pid)) return;
      seen.add(pid);
      points.set(pid, (points.get(pid) ?? 0) + (5 - i));
    });
  }
  return [...points.entries()]
    .map(([productId, pts]) => ({ productId, points: pts }))
    .sort((a, b) => b.points - a.points || a.productId.localeCompare(b.productId))
    .map((v, i) => ({ ...v, rank: i + 1 }));
}

/**
 * Individual predictor score 0-100:
 * 60% pairwise ordering agreement with actual top-5 (10 pairs),
 * 40% fraction of their top-5 that are in actual top-5.
 */
export function predictorScore(
  top5: string[],
  actualTop5: string[]
): number {
  const actualRank = new Map(actualTop5.map((id, i) => [id, i + 1]));
  let pairsAgree = 0;
  for (let i = 0; i < Math.min(top5.length, 5); i++) {
    for (let j = i + 1; j < Math.min(top5.length, 5); j++) {
      const ra = actualRank.get(top5[i]);
      const rb = actualRank.get(top5[j]);
      if (ra !== undefined && rb !== undefined && ra < rb) pairsAgree++;
    }
  }
  const pairScore = pairsAgree / 10;
  const hits = new Set(top5.slice(0, 5).filter((id) => actualRank.has(id))).size / 5;
  return Math.round((0.6 * pairScore + 0.4 * hits) * 100);
}

export function suggestNextProduct<T extends { id: string; name: string; category: string | null; claims: string[] }>(
  products: T[], ratings: { productId: string; rating: number }[]
): { product: T; match: number } | null {
  const rated = new Set(ratings.map((vote) => vote.productId));
  const liked = new Set(ratings.filter((vote) => vote.rating >= 4).map((vote) => vote.productId));
  const favourites = products.filter((product) => liked.has(product.id));
  return products.filter((product) => !rated.has(product.id))
    .map((product) => ({ product, match: favourites.reduce((score, favourite) =>
      score + (product.category && favourite.category &&
        product.category.toLowerCase() === favourite.category.toLowerCase() ? 2 : 0)
      + product.claims.filter((claim) => favourite.claims.some((other) =>
        other.toLowerCase() === claim.toLowerCase())).length, 0) }))
    .sort((a, b) => b.match - a.match || a.product.name.localeCompare(b.product.name) ||
      a.product.id.localeCompare(b.product.id))[0] ?? null;
}

/** Cosine similarity over principle vectors → "try next" recommendation. */
export function cosine(a: number[], b: number[]): number {
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    num += a[i] * b[i];
    da += a[i] * a[i];
    db += b[i] * b[i];
  }
  if (da === 0 || db === 0) return 0;
  return num / (Math.sqrt(da) * Math.sqrt(db));
}

export function calculateReveal(
  prediction: PredictionPayload, products: Product[], votes: Vote[], guesses: HumanPrediction[],
  lockHash: string, generatedAt: string
): RevealPayload {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const predicted = prediction.items.map((item) => ({
    productId: item.productId, brand: item.brand, name: item.name,
    rank: item.rank, score: item.score, thumb: productMap.get(item.productId)?.thumb ?? null,
  })).sort((a, b) => a.rank - b.rank);
  const ids = new Set(predicted.map((product) => product.productId));
  const validVotes = votes.filter((vote) => ids.has(vote.product_id) &&
    Number.isInteger(vote.rating) && vote.rating >= 1 && vote.rating <= 5);
  const validGuesses = guesses.filter((guess) => Array.isArray(guess.top5) && guess.top5.length === 5 &&
    new Set(guess.top5).size === 5 && guess.top5.every((id) => ids.has(id)));
  const actual = actualRanking([...ids], validVotes);
  const tasted = actual.filter((product) => product.rank !== null);
  const predictedMap = new Map(predicted.map((product) => [product.productId, product.rank]));
  const actualMap = new Map(tasted.map((product) => [product.productId, product.rank!]));
  const actualTop = tasted.slice(0, 5).map((product) => product.productId);
  const consensus = consensusRanking(validGuesses.map((guess) => guess.top5));
  const humanSpearman = spearman(new Map(consensus.map((product) => [product.productId, product.rank])), actualMap);
  const aiScore = actualTop.length ? predictorScore(predicted.slice(0, 5).map((product) => product.productId), actualTop) : 0;
  const humans = validGuesses.map((guess) => ({
    name: guess.display_name, score: actualTop.length ? predictorScore(guess.top5, actualTop) : 0,
    rho: spearman(new Map(guess.top5.map((id, index) => [id, index + 1])), actualMap),
  }));
  const comments = validVotes.filter((vote) => vote.comment?.trim()).map((vote) => ({
    product: productMap.get(vote.product_id)?.name ?? "",
    brand: productMap.get(vote.product_id)?.brand ?? "",
    text: vote.comment!.trim(), rating: vote.rating,
  }));
  const misses = tasted.map((row) => {
    const item = predicted.find((product) => product.productId === row.productId)!;
    return { productId: row.productId, brand: item.brand, name: item.name,
      predictedRank: item.rank, actualRank: row.rank!,
      note: row.rank! < item.rank ? "Tasters ranked this above the locked prediction." : "Tasters ranked this below the locked prediction." };
  }).filter((row) => row.actualRank !== row.predictedRank)
    .sort((a, b) => Math.abs(b.actualRank - b.predictedRank) - Math.abs(a.actualRank - a.predictedRank) || a.productId.localeCompare(b.productId))
    .slice(0, 5);
  const perProduct = tasted.map((row) => ({
    productId: row.productId, actualValue: row.mean!,
    principleScores: Object.fromEntries(prediction.items.find((product) => product.productId === row.productId)!
      .principles.map((score) => [score.principle, score.score])),
  }));
  const attributed = principleAttribution(perProduct, prediction.principles.map((principle) => principle.key));
  return {
    generatedAt, lockHash, verified: true,
    voterCount: new Set(validVotes.map((vote) => vote.voter_id)).size,
    voteCount: validVotes.length, guesserCount: validGuesses.length,
    predicted, actual, consensus,
    brandActual: brandRanking(actual.map((product) => ({ ...product, brand: productMap.get(product.productId)?.brand ??
      predicted.find((item) => item.productId === product.productId)!.brand }))),
    brandPredicted: brandRanking(predicted.map((product) => ({ productId: product.productId, brand: product.brand, rank: product.rank })))
      .map(({ brand, rank: position }) => ({ brand, rank: position })),
    metrics: {
      spearman: spearman(predictedMap, actualMap), pValue: permutationPValue(predictedMap, actualMap),
      topKOverlap: topKOverlap(predicted.slice(0, 5).map((product) => product.productId), actualTop),
      humanSpearman, aiBeatsHumans: actualTop.length ? humans.filter((human) => aiScore > human.score).length : 0,
      humansTotal: humans.length,
    },
    attribution: prediction.principles.map((principle, index) => ({ principle: principle.key, weight: principle.weight, voted: attributed[index].r })),
    misses, leaderboard: [{ name: "Shelf Oracle AI", score: aiScore, rho: spearman(predictedMap, actualMap) }, ...humans]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    comments,
  };
}
