import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data: event, error: eventError } = await db
    .from("events")
    .select("id,status")
    .eq("slug", slug)
    .maybeSingle();
  if (eventError) return NextResponse.json({ error: "Unable to load event" }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!["voting", "revealed", "closed"].includes(event.status)) {
    return NextResponse.json({ error: "The shelf is not open yet" }, { status: 409 });
  }

  const { data: products, error } = await db
    .from("products")
    .select("id,brand,name,category,format,price,claims,attributes,thumb")
    .eq("event_id", event.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Unable to load products" }, { status: 500 });
  return NextResponse.json({ products: products ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
