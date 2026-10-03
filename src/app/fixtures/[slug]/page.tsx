import Link from "next/link";
import { notFound } from "next/navigation";
import ReportView from "@/components/reveal/ReportView";
import RevealDeck from "@/components/reveal/RevealDeck";
import { localFixturesEnabled, readSampleArchive } from "@/lib/sample-fixtures";

export const dynamic = "force-dynamic";
export const metadata = { title: "Synthetic fixture preview", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; autoplay?: string }> };

export default async function FixturePreview({ params, searchParams }: Props) {
  if (!localFixturesEnabled()) notFound();
  const { slug } = await params;
  const fixture = readSampleArchive(process.env.SHELF_ORACLE_SAMPLE_ZIP!).find((item) => item.event.slug === slug);
  if (!fixture?.reveal) notFound();
  const query = await searchParams;
  const result = { event: fixture.event, reveal: fixture.reveal };
  return <>
    <aside role="note" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2"><span><strong>LOCAL SYNTHETIC PREVIEW.</strong> Ratings, names and comments are simulated. No live data or model calls.</span><Link href="/fixtures" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">All fixtures</Link></div>
      <p className="mx-auto max-w-7xl text-xs">Source hash {fixture.provenance.sourceHash?.slice(0, 12)} verified · adapted hash {fixture.lockHash?.slice(0, 12)} recomputed after conversion.</p>
    </aside>
    {query.view === "reveal" ? <RevealDeck result={result} initialAutoplay={query.autoplay === "1"} fixture /> : <ReportView result={result} fixture />}
  </>;
}
