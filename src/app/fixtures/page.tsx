import Link from "next/link";
import { notFound } from "next/navigation";
import { localFixturesEnabled, readSampleArchive } from "@/lib/sample-fixtures";

export const dynamic = "force-dynamic";
export const metadata = { title: "Local synthetic fixtures", robots: { index: false, follow: false } };

export default function FixturesPage() {
  if (!localFixturesEnabled()) notFound();
  const fixtures = readSampleArchive(process.env.SHELF_ORACLE_SAMPLE_ZIP!);
  const products = fixtures.reduce((sum, fixture) => sum + fixture.products.length, 0);
  const votes = fixtures.reduce((sum, fixture) => sum + fixture.votes.length, 0);
  return <main className="min-h-screen bg-background px-4 py-10 text-ink sm:px-8">
    <div className="mx-auto max-w-6xl">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="note">Local synthetic fixtures only. No Supabase writes, Gemini requests, or real tasting evidence. These routes are unavailable in production.</p>
      <header className="my-10"><p className="font-mono text-xs uppercase tracking-widest text-quiet">Shelf Oracle · Fixture laboratory</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">A shelf for every test.</h1><p className="mt-4 max-w-3xl text-quiet">{fixtures.length} sample events · {products} products · {votes.toLocaleString("en-GB")} synthetic ratings. Original hashes are checked before conversion; reports and adapted hashes are recomputed by the current app.</p></header>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{fixtures.map((fixture) => <article key={fixture.event.id} className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-mono text-quiet">{fixture.event.createdAt.slice(0, 10)}</span><span className="rounded-full bg-muted px-3 py-1">{fixture.event.status}</span></div>
        <h2 className="mt-5 text-xl font-semibold">{fixture.event.name}</h2><p className="mt-2 text-sm text-quiet">{fixture.event.location || "Location not specified"}</p>
        <p className="mt-5 text-sm tabular-nums">{fixture.products.length} products · {fixture.votes.length} ratings · {fixture.guesses.length} guesses</p>
        <p className="mt-2 text-xs text-quiet">{fixture.provenance.sourceHashVerified ? "Original source hash verified" : "No prediction locked yet"}</p>
        {fixture.reveal ? <div className="mt-5 flex flex-wrap gap-3"><Link href={`/fixtures/${fixture.event.slug}`} className="inline-flex min-h-11 items-center rounded-lg bg-human px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-human">Open report</Link><Link href={`/fixtures/${fixture.event.slug}?view=reveal`} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ai">Reveal deck</Link></div> : <p className="mt-5 rounded-lg bg-muted p-3 text-sm text-quiet">Report hidden: this fixture has not reached the reveal phase.</p>}
      </article>)}</div>
    </div>
  </main>;
}
