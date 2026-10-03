import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PRINCIPLES } from "@/lib/principles";

type Ctx = { params: Promise<{ id: string }> };

function handle(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (e instanceof ForbiddenError)
    return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    return NextResponse.json({ event });
  } catch (e) {
    return handle(e);
  }
}

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  location: z.string().max(120).nullable().optional(),
  status: z.enum(["intake", "closed"]).optional(),
  settings: z.object({
    principles: z.array(z.object({ key: z.string(), weight: z.number().min(0.1).max(20) })).length(PRINCIPLES.length),
  }).optional(),
}).strict();

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      return NextResponse.json({ error: "Invalid patch" }, { status: 400 });
    const { name, location, status, settings } = parsed.data;
    if (status && !((status === "intake" && event.status === "setup") ||
        (status === "closed" && event.status === "revealed" && event.reveal)))
      return NextResponse.json({ error: "Invalid status transition" }, { status: 409 });
    if (settings && (event.status !== "setup" && event.status !== "intake"))
      return NextResponse.json({ error: "Rubric is locked" }, { status: 409 });
    if (settings && (new Set(settings.principles.map((p) => p.key)).size !== PRINCIPLES.length ||
        settings.principles.some((p) => !PRINCIPLES.some((original) => original.key === p.key))))
      return NextResponse.json({ error: "Rubric must contain each known principle exactly once" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (location !== undefined) patch.location = location;
    if (status !== undefined) patch.status = status;
    if (settings) {
      patch.settings = { principles: settings.principles.map((p) => ({
        key: p.key, weight: p.weight, label: PRINCIPLES.find((original) => original.key === p.key)!.label,
      })) };
      patch.settings_version = event.settings_version + 1;
      patch.draft = null;
    }
    let query = supabaseAdmin().from("events").update(patch).eq("id", id)
      .eq("status", event.status).eq("settings_version", event.settings_version);
    if (settings) query = query.is("lock_hash", null);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) return NextResponse.json({ error: "Could not update event" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Event changed; refresh and retry" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
