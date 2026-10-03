import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { eventRows, verifiedPrediction } from "@/lib/reveal";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    const prediction = event.lock_hash ? await verifiedPrediction(id, event.lock_hash, event.locked_at) : null;
    if (event.lock_hash && !prediction)
      return NextResponse.json({ error: "Lock verification failed" }, { status: 409 });
    const [products, votes, guesses] = await Promise.all([
      eventRows("products", id), eventRows("votes", id), eventRows("human_predictions", id),
    ]);
    const filename = `shelf-oracle-${event.slug.replace(/[^a-z0-9-]/gi, "-")}.json`;
    return new Response(JSON.stringify({
      event: { id: event.id, slug: event.slug, name: event.name, location: event.location,
        status: event.status, createdAt: event.created_at, settings: event.settings,
        lockedAt: event.locked_at, lockHash: event.lock_hash },
      products, draft: event.draft, prediction, votes, guesses, reveal: event.reveal,
    }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"` } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Could not export event" }, { status: 500 });
  }
}
