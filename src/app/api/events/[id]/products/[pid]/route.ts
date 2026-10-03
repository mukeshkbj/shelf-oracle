import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string; pid: string }> };

function handle(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (e instanceof ForbiddenError)
    return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
}

const PatchBody = z.object({
  brand: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(120).optional(),
  category: z.string().max(60).nullable().optional(),
  format: z.string().max(40).nullable().optional(),
  price: z.string().max(30).nullable().optional(),
  claims: z.array(z.string().max(60)).max(10).optional(),
  attributes: z.record(z.string(), z.string().nullable()).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id, pid } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "setup" && event.status !== "intake")
      return NextResponse.json({ error: "Editing is closed" }, { status: 409 });
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid patch" }, { status: 400 });
    const changes = parsed.data.attributes
      ? { ...parsed.data, attributes: Object.fromEntries(
          Object.entries(parsed.data.attributes).filter(([, value]) => value !== null)
        ) }
      : parsed.data;
    const { error } = await supabaseAdmin()
      .from("products")
      .update(changes)
      .eq("id", pid)
      .eq("event_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id, pid } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "setup" && event.status !== "intake")
      return NextResponse.json({ error: "Editing is closed" }, { status: 409 });
    const { error } = await supabaseAdmin()
      .from("products")
      .delete()
      .eq("id", pid)
      .eq("event_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
