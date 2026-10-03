import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { verifiedPrediction } from "@/lib/reveal";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "locked" || !event.reveal || !event.lock_hash)
      return NextResponse.json({ error: "Build the reveal after voting before publishing" }, { status: 409 });
    if (!event.reveal.verified || event.reveal.lockHash !== event.lock_hash ||
        !(await verifiedPrediction(id, event.lock_hash, event.locked_at)))
      return NextResponse.json({ error: "Lock verification failed" }, { status: 409 });
    const { data, error } = await supabaseAdmin().from("events")
      .update({ status: "revealed" }).eq("id", id).eq("status", "locked")
      .eq("lock_hash", event.lock_hash).not("reveal", "is", null).select("slug").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not publish reveal" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Event changed; refresh and retry" }, { status: 409 });
    return NextResponse.json({ status: "revealed", slug: data.slug, reportUrl: `/e/${data.slug}/report` },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Could not publish reveal" }, { status: 500 });
  }
}
