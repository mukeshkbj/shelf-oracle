import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
    await requireEventMember(id, user.id);
    const { data, error } = await supabaseAdmin()
      .from("products")
      .select("*")
      .eq("event_id", id)
      .order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ products: data ?? [] });
  } catch (e) {
    return handle(e);
  }
}

const ProductBody = z.object({
  brand: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  category: z.string().max(60).nullable().optional(),
  format: z.string().max(40).nullable().optional(),
  price: z.string().max(30).nullable().optional(),
  claims: z.array(z.string().max(60)).max(10).optional(),
  attributes: z.record(z.string(), z.string().nullable()).optional(),
  box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).nullable().optional(),
  thumb: z.string().max(80_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(),
  source_image_id: z.number().int().positive().nullable().optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "setup" && event.status !== "intake")
      return NextResponse.json({ error: "Intake is closed" }, { status: 409 });
    const parsed = ProductBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid product" }, { status: 400 });
    if (parsed.data.source_image_id) {
      const { data: source } = await supabaseAdmin()
        .from("shelf_images")
        .select("id")
        .eq("id", parsed.data.source_image_id)
        .eq("event_id", id)
        .maybeSingle();
      if (!source)
        return NextResponse.json({ error: "Image is not in this event" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin()
      .from("products")
      .insert({ event_id: id, ...parsed.data, attributes: Object.fromEntries(
        Object.entries(parsed.data.attributes ?? {}).filter(([, value]) => value !== null)
      ) })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data });
  } catch (e) {
    return handle(e);
  }
}
