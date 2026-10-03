import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { canonicalHash } from "./hash.ts";
import { calculateReveal, weightedScore } from "./metrics.ts";
import { PRINCIPLES } from "./principles.ts";
import type { EventStatus, HumanPrediction, PredictionPayload, Product, RevealPayload, Vote } from "./types";

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const weight = z.object({ key: z.string(), weight: z.number().min(0.1).max(20) }).passthrough();
const payloadSchema = z.object({
  eventId: z.uuid(), lockedAt: timestamp, model: z.string(), principles: z.array(weight),
  ranking: z.array(z.object({
    productId: z.uuid(), brand: z.string(), name: z.string(), rank: z.number().int().positive(),
    score: z.number(), scores: z.record(z.string(), z.number().min(1).max(10)),
    rationale: z.string().optional(),
  }).passthrough()),
}).passthrough();
const sourceSchema = z.object({
  event: z.object({
    id: z.uuid(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
    name: z.string(), location: z.string().nullable(),
    status: z.enum(["setup", "intake", "locked", "voting", "revealed", "closed"]),
    created_at: timestamp, locked_at: timestamp.nullable(), lock_hash: z.string().nullable(),
  }),
  products: z.array(z.object({
    id: z.uuid(), event_id: z.uuid(), brand: z.string(), name: z.string(),
    category: z.string().nullable(), format: z.string().nullable(), price: z.string().nullable(),
    claims: z.array(z.string()), attributes: z.record(z.string(), z.unknown()),
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable().optional(),
    created_at: timestamp,
  })),
  prediction: z.object({ event_id: z.uuid(), locked_at: timestamp, hash: z.string(), payload: payloadSchema }).nullable(),
  votes: z.array(z.object({
    event_id: z.uuid(), voter_id: z.string().min(1), product_id: z.uuid(),
    rating: z.number().int().min(1).max(5), comment: z.string().max(280).nullable(), created_at: timestamp,
  })),
  guesses: z.array(z.object({
    event_id: z.uuid(), voter_id: z.string().min(1), display_name: z.string().max(30),
    top5: z.array(z.uuid()).length(5), created_at: timestamp,
  })),
  reveal: z.object({ generatedAt: timestamp }).nullable(),
});

export interface SampleFixture {
  event: { id: string; slug: string; name: string; location: string | null; status: EventStatus; createdAt: string };
  products: Product[];
  prediction: PredictionPayload | null;
  lockHash: string | null;
  votes: Vote[];
  guesses: HumanPrediction[];
  reveal: RevealPayload | null;
  provenance: { synthetic: true; sourceHash: string | null; sourceHashVerified: boolean; sourceModel: string | null };
}

export function adaptSample(input: unknown): SampleFixture {
  const source = sourceSchema.parse(input);
  const eventId = source.event.id;
  const ids = new Set(source.products.map((product) => product.id));
  if (ids.size !== source.products.length || source.products.some((product) => product.event_id !== eventId))
    throw new Error("Invalid sample product references");
  const voteKeys = new Set<string>();
  const firstVotes = new Map<string, number>();
  for (const vote of source.votes) {
    const key = `${vote.voter_id}:${vote.product_id}`;
    if (vote.event_id !== eventId || !ids.has(vote.product_id) || voteKeys.has(key))
      throw new Error("Invalid or duplicate sample vote product");
    voteKeys.add(key);
    const time = Date.parse(vote.created_at);
    if (!source.event.locked_at || time < Date.parse(source.event.locked_at))
      throw new Error("Sample vote preceded prediction lock");
    firstVotes.set(vote.voter_id, Math.min(firstVotes.get(vote.voter_id) ?? Infinity, time));
  }
  const guessers = new Set<string>();
  for (const guess of source.guesses) {
    if (guess.event_id !== eventId || guessers.has(guess.voter_id) || new Set(guess.top5).size !== 5 ||
        guess.top5.some((id) => !ids.has(id))) throw new Error("Invalid sample guess products");
    if (!source.event.locked_at || Date.parse(guess.created_at) < Date.parse(source.event.locked_at) ||
        Date.parse(guess.created_at) > (firstVotes.get(guess.voter_id) ?? Infinity))
      throw new Error("Sample guess did not precede tasting");
    guessers.add(guess.voter_id);
  }

  const products: Product[] = source.products.map((product) => ({
    ...product, source_image_id: null, thumb: null, box: product.box ?? null,
    attributes: Object.fromEntries(Object.entries(product.attributes).flatMap(([key, value]) =>
      key !== "principle_scores" && ["string", "number", "boolean"].includes(typeof value) ? [[key, String(value)]] : [])),
  }));
  const voterId = (value: string) => `v_${canonicalHash({ eventId, voter: value }).slice(0, 32)}`;
  const votes: Vote[] = source.votes.map((vote, index) => ({ ...vote, id: index + 1, voter_id: voterId(vote.voter_id) }));
  const guesses: HumanPrediction[] = source.guesses.map((guess, index) => ({ ...guess, id: index + 1, voter_id: voterId(guess.voter_id) }));
  let prediction: PredictionPayload | null = null;
  let lockHash: string | null = null;
  const original = source.prediction;
  if (original) {
    if (original.event_id !== eventId || original.payload.eventId !== eventId ||
        original.locked_at !== source.event.locked_at || original.payload.lockedAt !== original.locked_at ||
        canonicalHash(original.payload) !== original.hash || original.hash !== source.event.lock_hash)
      throw new Error("Sample prediction hash verification failed");
    const keys = new Set(original.payload.principles.map((principle) => principle.key));
    if (keys.size !== PRINCIPLES.length || original.payload.principles.length !== PRINCIPLES.length ||
        PRINCIPLES.some((principle) => !keys.has(principle.key))) throw new Error("Invalid sample rubric");
    const principles = PRINCIPLES.map((principle) => ({ ...principle,
      weight: original.payload.principles.find((item) => item.key === principle.key)!.weight }));
    const rankedIds = new Set(original.payload.ranking.map((item) => item.productId));
    if (rankedIds.size !== ids.size || original.payload.ranking.length !== ids.size ||
        original.payload.ranking.some((item) => !ids.has(item.productId))) throw new Error("Incomplete sample prediction products");
    const items = original.payload.ranking.map((item) => {
      const product = products.find((value) => value.id === item.productId)!;
      if (item.brand !== product.brand || item.name !== product.name) throw new Error("Sample product names do not match prediction");
      const scores = principles.map((principle) => ({ principle: principle.key, score: item.scores[principle.key],
        rationale: "Synthetic score from the supplied fixture, not a live model response." }));
      const raw = weightedScore(principles, scores);
      return { productId: product.id, brand: product.brand, name: product.name, rank: 0,
        score: Math.round(raw * 100) / 10, principles: scores, raw, salience: item.scores.salience };
    }).sort((a, b) => b.raw - a.raw || b.salience - a.salience || a.productId.localeCompare(b.productId));
    prediction = {
      model: "synthetic-fixture", createdAt: original.locked_at, lockedAt: original.locked_at,
      principles, items: items.map((item, index) => ({ productId: item.productId, brand: item.brand,
        name: item.name, rank: index + 1, score: item.score, principles: item.principles })),
    };
    lockHash = canonicalHash(prediction);
  } else if (source.event.lock_hash || source.votes.length || source.guesses.length ||
      ["locked", "voting", "revealed", "closed"].includes(source.event.status)) {
    throw new Error("Sample event is missing its locked prediction");
  }
  const reveal = prediction && lockHash && ["revealed", "closed"].includes(source.event.status)
    ? calculateReveal(prediction, products, votes, guesses, lockHash, source.reveal?.generatedAt ?? prediction.lockedAt!)
    : null;
  return {
    event: { id: eventId, slug: source.event.slug, name: source.event.name, location: source.event.location,
      status: source.event.status, createdAt: source.event.created_at },
    products, prediction, lockHash, votes, guesses, reveal,
    provenance: { synthetic: true, sourceHash: original?.hash ?? null,
      sourceHashVerified: !!original, sourceModel: original?.payload.model ?? null },
  };
}

export function localFixturesEnabled(mode = process.env.NODE_ENV, archive = process.env.SHELF_ORACLE_SAMPLE_ZIP): boolean {
  return mode === "development" && !!archive;
}

export function readSampleArchive(archive: string): SampleFixture[] {
  const path = resolve(archive);
  const entries = execFileSync("unzip", ["-Z1", path], { encoding: "utf8", maxBuffer: 1_000_000 })
    .split(/\r?\n/).filter((entry) => /^shelf-oracle-sample-data\/exports\/[a-z0-9-]+\.json$/.test(entry));
  if (!entries.length || entries.length > 50) throw new Error("Expected 1–50 sample JSON exports");
  const fixtures = entries.map((entry) => {
    const text = execFileSync("unzip", ["-p", path, entry], { encoding: "utf8", maxBuffer: 2_000_000 });
    const fixture = adaptSample(JSON.parse(text));
    if (!entry.endsWith(`/${fixture.event.slug}.json`)) throw new Error("Sample filename and event slug differ");
    return fixture;
  });
  if (new Set(fixtures.map((fixture) => fixture.event.slug)).size !== fixtures.length) throw new Error("Duplicate sample slugs");
  return fixtures.sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));
}
