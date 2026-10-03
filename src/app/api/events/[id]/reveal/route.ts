import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { buildReveal, eventRows, verifiedPrediction } from "@/lib/reveal";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status === "revealed" || event.status === "closed")
      return NextResponse.json({ error: "Reveal is already published" }, { status: 409 });
    if (event.reveal) return NextResponse.json({ reveal: event.reveal, status: event.status },
      { headers: { "Cache-Control": "no-store" } });
    if (event.status !== "voting" && event.status !== "locked")
      return NextResponse.json({ error: "Voting must finish before reveal" }, { status: 409 });
    const prediction = await verifiedPrediction(id, event.lock_hash, event.locked_at);
    if (!prediction) return NextResponse.json({ error: "Lock verification failed" }, { status: 409 });

    if (event.status === "voting") {
      const { data: frozen, error } = await supabaseAdmin().from("events")
        .update({ status: "locked" }).eq("id", id).eq("status", "voting")
        .eq("lock_hash", event.lock_hash!).is("reveal", null).select("id").maybeSingle();
      if (error) return NextResponse.json({ error: "Could not freeze voting" }, { status: 500 });
      if (!frozen) return NextResponse.json({ error: "Event changed; retry reveal" }, { status: 409 });
    }

    const [products, votes, guesses] = await Promise.all([
      eventRows("products", id), eventRows("votes", id), eventRows("human_predictions", id),
    ]);
    const ids = new Set(products.map((p) => p.id));
    if (products.length !== prediction.items.length ||
        prediction.items.some((p) => !ids.has(p.productId)))
      return NextResponse.json({ error: "Product set changed since lock" }, { status: 409 });
    const reveal = await buildReveal(prediction, products, votes, guesses, event.lock_hash!);
    const { data: saved, error } = await supabaseAdmin().from("events")
      .update({ reveal }).eq("id", id).eq("status", "locked")
      .eq("lock_hash", event.lock_hash!).is("reveal", null).select("id").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not cache reveal" }, { status: 500 });
    if (!saved) return NextResponse.json({ error: "Reveal was already built; refresh the event" }, { status: 409 });
    return NextResponse.json({ reveal, status: "locked" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Could not build reveal; retry" }, { status: 500 });
  }
}
