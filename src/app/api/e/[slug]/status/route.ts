import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/types";
import { isSyntheticEvent } from "@/lib/demo";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("events")
    .select("id,slug,name,location,status,locked_at,lock_hash,settings")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load event" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const event = data as Pick<EventRow, "id" | "slug" | "name" | "location" | "status" | "locked_at" | "lock_hash" | "settings">;
  const { count, error: countError } = await db
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id);
  if (countError) return NextResponse.json({ error: "Unable to load event" }, { status: 500 });

  return NextResponse.json({
    event: {
      slug: event.slug,
      name: event.name,
      location: event.location,
      status: event.status,
      lockedAt: event.locked_at,
      lockHash: event.lock_hash,
      synthetic: isSyntheticEvent(event),
    },
    voteCount: count ?? 0,
  }, { headers: { "Cache-Control": "no-store" } });
}
