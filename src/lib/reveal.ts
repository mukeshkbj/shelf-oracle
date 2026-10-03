import "server-only";
import { explainMisses } from "./ai";
import { canonicalHash } from "./hash";
import { calculateReveal } from "./metrics";
import { supabaseAdmin } from "./supabase/admin";
import type { HumanPrediction, PredictionPayload, Product, RevealPayload, Vote } from "./types";

export async function eventRows(table: "products", eventId: string): Promise<Product[]>;
export async function eventRows(table: "votes", eventId: string): Promise<Vote[]>;
export async function eventRows(table: "human_predictions", eventId: string): Promise<HumanPrediction[]>;
export async function eventRows(table: "products" | "votes" | "human_predictions", eventId: string) {
  const rows: (Product | Vote | HumanPrediction)[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin().from(table).select("*")
      .eq("event_id", eventId).order("id").range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []) as (Product | Vote | HumanPrediction)[]);
    if (!data || data.length < 1000) return rows;
  }
}

export async function verifiedPrediction(eventId: string, eventHash: string | null, lockedAt: string | null) {
  if (!eventHash || !lockedAt) return null;
  const { data, error } = await supabaseAdmin().from("predictions").select("payload, hash, locked_at")
    .eq("event_id", eventId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const payload = data.payload as PredictionPayload;
  if (data.hash !== eventHash || canonicalHash(payload) !== eventHash ||
      !payload.lockedAt || new Date(payload.lockedAt).getTime() !== new Date(lockedAt).getTime() ||
      new Date(data.locked_at).getTime() !== new Date(lockedAt).getTime()) return null;
  return payload;
}

export async function buildReveal(
  prediction: PredictionPayload, products: Product[], votes: Vote[], guesses: HumanPrediction[], lockHash: string
): Promise<RevealPayload> {
  const reveal = calculateReveal(prediction, products, votes, guesses, lockHash, new Date().toISOString());
  const evidencedMisses = reveal.misses.map((miss) => ({
    ...miss,
    topComments: votes.filter((vote) => vote.product_id === miss.productId && vote.comment?.trim())
      .slice(0, 3).map((vote) => vote.comment!.trim()),
  })).filter((miss) => miss.topComments.length > 0);
  if (process.env.AI_API_KEY && evidencedMisses.length) {
    try {
      const notes = await explainMisses(evidencedMisses);
      for (const miss of reveal.misses) {
        const note = notes.get(miss.productId)?.trim();
        if (note) miss.note = note.slice(0, 220);
      }
    } catch {
      reveal.misses.forEach((miss) => { miss.note = miss.note.slice(0, 220); });
    }
  }
  return reveal;
}
