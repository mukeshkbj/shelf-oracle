import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cosine, suggestNextProduct } from "@/lib/metrics";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PredictionPayload } from "@/lib/types";

const VoterId = z.string().min(8).max(80).regex(/^v_[a-z0-9]+$/);
type Ctx = { params: Promise<{ slug: string }> };

const archetypes: Record<string, string> = {
  novelty: "Curious Explorer",
  fluency: "Instant Classic",
  salience: "Shelf Spotter",
  indulgence: "Treat Seeker",
  health_halo: "Mindful Taster",
  social_proof: "Crowd Connector",
  convenience: "Everyday Optimist",
  context_fit: "Moment Maker",
  scarcity: "Discovery Hunter",
  value: "Value Hunter",
};

export async function GET(req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const voter = VoterId.safeParse(req.nextUrl.searchParams.get("voterId"));
  if (!voter.success) return NextResponse.json({ error: "Invalid voter ID" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: event, error: eventError } = await db
    .from("events")
    .select("id,status")
    .eq("slug", slug)
    .maybeSingle();
  if (eventError) return NextResponse.json({ error: "Unable to load your shelf" }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const [votesResult, guessResult] = await Promise.all([
    db.from("votes")
      .select("product_id,rating,comment")
      .eq("event_id", event.id)
      .eq("voter_id", voter.data)
      .order("created_at"),
    db.from("human_predictions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("voter_id", voter.data),
  ]);
  if (votesResult.error || guessResult.error) {
    return NextResponse.json({ error: "Unable to load your shelf" }, { status: 500 });
  }
  const ownVotes = (votesResult.data ?? []).map((vote) => ({
    productId: vote.product_id as string,
    rating: vote.rating as number,
    comment: vote.comment as string | null,
  }));

  let nextToTry = null;
  if (ownVotes.length && event.status === "voting") {
    const { data: shelf, error: shelfError } = await db.from("products")
      .select("id,brand,name,category,claims,thumb")
      .eq("event_id", event.id);
    if (shelfError) return NextResponse.json({ error: "Unable to load your shelf" }, { status: 500 });
    const next = suggestNextProduct(shelf ?? [], ownVotes);
    if (next) nextToTry = {
      productId: next.product.id, brand: next.product.brand, name: next.product.name,
      thumb: next.product.thumb,
      reason: next.match ? "Similar category or pack cues to products you liked." : "Something new to explore on this shelf.",
    };
  }

  let profile = null;
  if (ownVotes.length && (event.status === "revealed" || event.status === "closed")) {
    const [predictionResult, productsResult] = await Promise.all([
      db.from("predictions").select("payload").eq("event_id", event.id).maybeSingle(),
      db.from("products")
        .select("id,brand,name,thumb")
        .eq("event_id", event.id)
        .order("created_at"),
    ]);
    if (predictionResult.error || productsResult.error) {
      return NextResponse.json({ error: "Unable to build taste profile" }, { status: 500 });
    }

    const prediction = predictionResult.data?.payload as PredictionPayload | undefined;
    if (prediction?.principles?.length && prediction.items?.length) {
      const keys = prediction.principles.map(({ key }) => key);
      const byProduct = new Map(prediction.items.map((item) => [item.productId, item]));
      const rated = ownVotes.filter((vote) => byProduct.has(vote.productId));
      const strength = rated.reduce((sum, vote) => sum + Math.abs(vote.rating - 3), 0);
      const principleBars = prediction.principles.map(({ key, label }) => {
        const preference = rated.reduce((sum, vote) => {
          const score = byProduct.get(vote.productId)?.principles.find((p) => p.principle === key)?.score;
          return sum + (vote.rating - 3) * ((score ?? 5.5) - 5.5);
        }, 0);
        return {
          key,
          label,
          score: Math.max(1, Math.min(10, Math.round((5.5 + preference / (strength || 1)) * 10) / 10)),
        };
      });
      const top = [...principleBars].sort((a, b) => b.score - a.score)[0];
      const preferenceVector = principleBars.map((p) => p.score - 5.5);
      const votedIds = new Set(ownVotes.map((vote) => vote.productId));
      const next = (productsResult.data ?? [])
        .filter((product) => !votedIds.has(product.id) && byProduct.has(product.id))
        .map((product) => {
          const principles = byProduct.get(product.id)!.principles;
          const vector = keys.map((key) => (principles.find((p) => p.principle === key)?.score ?? 5.5) - 5.5);
          return { product, similarity: cosine(preferenceVector, vector) };
        })
        .sort((a, b) => b.similarity - a.similarity)[0]?.product;
      profile = {
        archetype: top && top.score > 5.5 ? (archetypes[top.key] ?? "Curious Taster") : "Open-Minded Taster",
        principles: principleBars,
        tryNext: next ? {
          productId: next.id,
          brand: next.brand,
          name: next.name,
          thumb: next.thumb,
        } : null,
      };
    }
  }

  return NextResponse.json({
    status: event.status,
    votes: ownVotes,
    votedCount: ownVotes.length,
    guessSubmitted: (guessResult.count ?? 0) > 0,
    nextToTry,
    profile,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
