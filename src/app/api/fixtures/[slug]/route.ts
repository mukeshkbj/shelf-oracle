import { NextResponse } from "next/server";
import { canonicalJson } from "@/lib/hash";
import { localFixturesEnabled, readSampleArchive } from "@/lib/sample-fixtures";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  if (!localFixturesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { slug } = await params;
  try {
    const fixture = readSampleArchive(process.env.SHELF_ORACLE_SAMPLE_ZIP!).find((item) => item.event.slug === slug);
    if (!fixture?.reveal || !fixture.prediction) return NextResponse.json({ error: "Fixture report is not available" }, { status: 404 });
    return NextResponse.json({
      event: fixture.event, reveal: fixture.reveal, provenance: fixture.provenance,
      lockProof: { canonical: canonicalJson(fixture.prediction), payload: fixture.prediction },
    }, { headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${fixture.event.slug}-synthetic.json"`,
    } });
  } catch {
    return NextResponse.json({ error: "Fixture could not be validated" }, { status: 422 });
  }
}
