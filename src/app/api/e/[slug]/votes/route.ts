import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

const VoteBody = z.object({
  voterId: z.string().min(8).max(80).regex(/^v_[a-z0-9]+$/),
  productId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(280).nullable().optional(),
});

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  }
  const parsed = VoteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid vote" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: event, error: eventError } = await db
    .from("events")
    .select("id,status")
    .eq("slug", slug)
    .maybeSingle();
  if (eventError) return NextResponse.json({ error: "Unable to save vote" }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.status !== "voting") {
    return NextResponse.json({ error: "Voting is not open" }, { status: 409 });
  }

  const { data: product, error: productError } = await db
    .from("products")
    .select("id")
    .eq("id", parsed.data.productId)
    .eq("event_id", event.id)
    .maybeSingle();
  if (productError) return NextResponse.json({ error: "Unable to save vote" }, { status: 500 });
  if (!product) return NextResponse.json({ error: "Product not found in this event" }, { status: 400 });

  const { data: vote, error } = await db
    .from("votes")
    .upsert({
      event_id: event.id,
      voter_id: parsed.data.voterId,
      product_id: product.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment?.trim() || null,
    }, { onConflict: "event_id,voter_id,product_id" })
    .select("product_id,rating,comment")
    .single();
  if (error) return NextResponse.json({ error: "Unable to save vote" }, { status: 500 });
  return NextResponse.json({
    saved: true,
    vote: { productId: vote.product_id, rating: vote.rating, comment: vote.comment },
  }, { headers: { "Cache-Control": "no-store" } });
}
