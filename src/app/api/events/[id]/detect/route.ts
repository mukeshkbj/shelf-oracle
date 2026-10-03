import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, ForbiddenError, requireEventMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { detectShelf } from "@/lib/ai";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  image: z.string().max(6_000_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const event = await requireEventMember(id, user.id);
    if (event.status !== "setup" && event.status !== "intake")
      return NextResponse.json(
        { error: "Intake is closed for this event" },
        { status: 409 }
      );

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Expected a resized JPEG (max ~4MB)" }, { status: 400 });
    const image = parsed.data.image;

    const items = await detectShelf(image);
    const db = supabaseAdmin();
    const path = `${event.org_id}/${id}/${randomUUID()}.jpg`;
    const bytes = Buffer.from(image.slice("data:image/jpeg;base64,".length), "base64");
    const { error: storageError } = await db.storage.from("shelf-oracle-shelves")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (storageError) return NextResponse.json({ error: "Could not save shelf photo" }, { status: 500 });

    const { data: row, error } = await db
      .from("shelf_images")
      .insert({ event_id: id, image: path, detected_count: items.length })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Move event into intake on first upload.
    if (event.status === "setup")
      await supabaseAdmin().from("events").update({ status: "intake" }).eq("id", id).eq("status", "setup");

    return NextResponse.json({ imageId: row.id, items });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("detect failed:", e);
    return NextResponse.json({ error: "Detection failed — try a sharper photo." }, { status: 502 });
  }
}
