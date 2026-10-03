import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { canonicalHash, canonicalJson } from "@/lib/hash";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PredictionPayload } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if ((event.status !== "setup" && event.status !== "intake") || event.lock_hash)
      return NextResponse.json({ error: "Prediction already locked" }, { status: 409 });
    const draft = event.draft;
    if (!draft || !Array.isArray(draft.items) || draft.items.length === 0 || !draft.createdAt)
      return NextResponse.json({ error: "Generate a draft before locking" }, { status: 409 });
    const payload: PredictionPayload = { ...draft, lockedAt: new Date().toISOString() };
    const canonical = canonicalJson(payload);
    const hash = canonicalHash(payload);
    const { data, error } = await supabaseAdmin().rpc("lock_event_prediction", {
      p_event_id: id,
      p_expected_draft: draft,
      p_payload: payload,
      p_canonical: canonical,
      p_hash: hash,
    });
    if (error) return NextResponse.json({ error: "Could not lock prediction" }, { status: 500 });
    if (data?.outcome !== "locked")
      return NextResponse.json({ error: "Prediction changed or already locked", reason: data?.outcome }, { status: 409 });
    return NextResponse.json({ hash: data.hash, lockedAt: data.lockedAt, prediction: payload, status: "voting" },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Could not lock prediction" }, { status: 500 });
  }
}
