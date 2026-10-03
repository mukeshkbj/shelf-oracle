import { NextResponse } from "next/server";
import { readPublishedReveal } from "@/components/reveal/public-reveal";
import { canonicalJson } from "@/lib/hash";
import { verifiedPrediction } from "@/lib/reveal";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    const result = await readPublishedReveal(slug);
    if (!result) return NextResponse.json({ error: "Report not available" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const { data: event, error } = await supabaseAdmin().from("events")
      .select("id,lock_hash,locked_at")
      .eq("slug", slug)
      .in("status", ["revealed", "closed"])
      .single();
    if (error || !event) return NextResponse.json({ error: "Integrity proof unavailable" }, { status: 500 });
    const payload = await verifiedPrediction(event.id, event.lock_hash, event.locked_at);
    if (!payload) return NextResponse.json({ error: "Integrity proof failed" }, { status: 409 });
    return NextResponse.json({ ...result, lockProof: { canonical: canonicalJson(payload), payload } }, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${result.event.slug}-public-report.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to load report" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
