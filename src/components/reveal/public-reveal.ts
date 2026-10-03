import "server-only";
import { cache } from "react";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RevealPayload } from "@/lib/types";
import { isSyntheticEvent } from "@/lib/demo";

const number = z.number().finite();
const rank = number.nullable();
const image = z.string().nullable().transform((value) =>
  value && value.length <= 80_000 && /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)
    ? value
    : null
);

const publicRevealSchema = z.object({
  generatedAt: z.string(),
  lockHash: z.string(),
  verified: z.boolean(),
  voterCount: number,
  voteCount: number,
  guesserCount: number,
  predicted: z.array(z.object({
    productId: z.string(), brand: z.string(), name: z.string(), rank: number, score: number, thumb: image,
  })),
  actual: z.array(z.object({ productId: z.string(), rank, mean: rank, adjustedMean: rank.optional(), votes: number })),
  consensus: z.array(z.object({ productId: z.string(), rank: number, points: number })),
  brandActual: z.array(z.object({ brand: z.string(), rank, mean: rank })),
  brandPredicted: z.array(z.object({ brand: z.string(), rank })),
  metrics: z.object({
    spearman: rank, pValue: rank, topKOverlap: number, humanSpearman: rank,
    aiBeatsHumans: number, humansTotal: number,
  }),
  attribution: z.array(z.object({ principle: z.string(), weight: number, voted: number })),
  misses: z.array(z.object({
    productId: z.string(), brand: z.string(), name: z.string(),
    predictedRank: number, actualRank: number, note: z.string(),
  })),
  leaderboard: z.array(z.object({ name: z.string(), score: number, rho: rank })),
  comments: z.array(z.object({ product: z.string(), brand: z.string(), text: z.string(), rating: number })),
});

export type PublicReveal = Omit<RevealPayload, "actual" | "brandActual" | "brandPredicted"> & {
  actual: { productId: string; rank: number | null; mean: number | null; adjustedMean?: number | null; votes: number }[];
  brandActual: { brand: string; rank: number | null; mean: number | null }[];
  brandPredicted: { brand: string; rank: number | null }[];
};

export interface PublicResult {
  event: { slug: string; name: string; location: string | null; synthetic?: boolean };
  reveal: PublicReveal;
}

export const readPublishedReveal = cache(async (slug: string): Promise<PublicResult | null> => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;

  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("slug, name, location, reveal, settings")
    .eq("slug", slug)
    .in("status", ["revealed", "closed"])
    .not("reveal", "is", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const parsed = publicRevealSchema.safeParse(data.reveal);
  if (!parsed.success) return null;
  return {
    event: { slug: data.slug, name: data.name, location: data.location, synthetic: isSyntheticEvent(data) },
    reveal: parsed.data,
  };
});
