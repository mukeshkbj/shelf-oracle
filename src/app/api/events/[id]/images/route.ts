import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireEventMember(id, user.id);
    const db = supabaseAdmin();
    const { data: rows, error } = await db.from("shelf_images")
      .select("id,image,detected_count,created_at")
      .eq("event_id", id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return NextResponse.json({ error: "Could not load shelf photos" }, { status: 500 });
    const images = await Promise.all((rows ?? []).map(async (row) => {
      const { data, error: signedError } = await db.storage.from("shelf-oracle-shelves")
        .createSignedUrl(row.image, 3600);
      return {
        id: row.id,
        detectedCount: row.detected_count,
        createdAt: row.created_at,
        url: signedError ? null : data?.signedUrl ?? null,
      };
    }));
    return NextResponse.json({ images }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Could not load shelf photos" }, { status: 500 });
  }
}
