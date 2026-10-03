import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

const GuessBody = z.object({
  voterId: z.string().min(8).max(80).regex(/^v_[a-z0-9]+$/),
  displayName: z.string().trim().min(1).max(30),
  top5: z.array(z.uuid()).length(5).refine((ids) => new Set(ids).size === 5),
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
  const parsed = GuessBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose five different products and a name" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: event, error: eventError } = await db
    .from("events")
    .select("id,status")
    .eq("slug", slug)
    .maybeSingle();
  if (eventError) return NextResponse.json({ error: "Unable to save guess" }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.status !== "voting") {
    return NextResponse.json({ error: "Voting is not open" }, { status: 409 });
  }

  const { data: existingVotes, error: votesError } = await db
    .from("votes")
    .select("id")
    .eq("event_id", event.id)
    .eq("voter_id", parsed.data.voterId)
    .limit(1);
  if (votesError) return NextResponse.json({ error: "Unable to save guess" }, { status: 500 });
  if (existingVotes?.length) {
    return NextResponse.json({ error: "Guesses must be made before tasting" }, { status: 409 });
  }

  const { data: products, error: productsError } = await db
    .from("products")
    .select("id")
    .eq("event_id", event.id)
    .in("id", parsed.data.top5);
  if (productsError) return NextResponse.json({ error: "Unable to save guess" }, { status: 500 });
  if (products?.length !== 5) {
    return NextResponse.json({ error: "All five products must belong to this event" }, { status: 400 });
  }

  const { error } = await db.from("human_predictions").insert({
    event_id: event.id,
    voter_id: parsed.data.voterId,
    display_name: parsed.data.displayName,
    top5: parsed.data.top5,
  });
  if (error?.code === "23505") {
    return NextResponse.json({ error: "Your guess is already locked" }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: "Unable to save guess" }, { status: 500 });
  return NextResponse.json({ guessSubmitted: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
