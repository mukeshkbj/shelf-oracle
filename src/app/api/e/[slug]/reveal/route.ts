import { NextResponse } from "next/server";
import { readPublishedReveal } from "@/components/reveal/public-reveal";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    const result = await readPublishedReveal(slug);
    if (!result) return NextResponse.json({ error: "Result not available" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load result" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
