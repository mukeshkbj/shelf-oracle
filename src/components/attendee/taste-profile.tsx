"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventStatus } from "@/lib/types";
import { isSyntheticEvent, SYNTHETIC_DISCLOSURE } from "@/lib/demo";

type Profile = {
  archetype: string;
  principles: { key: string; label: string; score: number }[];
  tryNext: { productId: string; brand: string; name: string; thumb: string | null } | null;
};
type MyShelf = {
  status: EventStatus;
  votedCount: number;
  guessSubmitted: boolean;
  nextToTry: { productId: string; brand: string; name: string; thumb: string | null; reason: string } | null;
  profile: Profile | null;
};

export function TasteProfile({ slug, eventName, synthetic = false }: { slug: string; eventName: string; synthetic?: boolean }) {
  const demo = isSyntheticEvent({ name: eventName, synthetic });
  const [data, setData] = useState<MyShelf | null>(null);
  const [missingVoter, setMissingVoter] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      let current: string | null = null;
      try { current = window.localStorage.getItem(`shelf-oracle:voter:${slug}`); } catch { current = null; }
      if (!current || !/^v_[a-z0-9]{6,78}$/.test(current)) {
        if (mounted) setMissingVoter(true);
        return;
      }
      try {
        const response = await fetch(`/api/e/${encodeURIComponent(slug)}/me?voterId=${encodeURIComponent(current)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Your taste profile couldn't be loaded. Please try again.");
        if (mounted) setData(await response.json() as MyShelf);
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : "Your taste profile couldn't be loaded.");
      }
    };
    void load();
    return () => { mounted = false; };
  }, [slug]);

  const revealed = data?.status === "revealed" || data?.status === "closed";
  const next = data?.profile?.tryNext;
  const early = data?.nextToTry;
  const photo = next?.thumb && (/^data:image\/(jpeg|png|webp);base64,/.test(next.thumb) || /^https:\/\//.test(next.thumb));
  const earlyPhoto = early?.thumb && (/^data:image\/(jpeg|png|webp);base64,/.test(early.thumb) || /^https:\/\//.test(early.thumb));

  return (
    <main className="min-h-screen bg-[#faf9f6] px-5 pb-20 pt-5 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <nav aria-label="Event navigation" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link href={`/e/${encodeURIComponent(slug)}/v`} className="inline-flex min-h-11 items-center font-semibold text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600">← My tasting</Link>
          <Link href={`/e/${encodeURIComponent(slug)}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600">{eventName}</Link>
        </nav>
        {demo && <aside role="note" aria-label="Synthetic demo disclosure" className="mt-6 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950"><strong className="block font-semibold">SYNTHETIC / DEMO · Demo/test event</strong><p className="mt-1">{SYNTHETIC_DISCLOSURE}</p></aside>}
        <header className="mt-10"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Your shelf · {eventName}</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Your taste profile.</h1><p className="mt-3 text-slate-600">Your own ratings shape what to try next. Deeper taste signals unlock when the room reveals its results.</p></header>
        {!data && !missingVoter && !error && <p role="status" className="mt-8 text-slate-600">Building your shelf…</p>}
        {error && <div role="alert" className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><p>{error}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 font-semibold">Try again</button></div>}
        {missingVoter && <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">No shelf on this device yet</h2><p className="mt-2 text-slate-600">Your anonymous tasting stays on the device where you rated. Open the tasting page here to get started.</p><Link href={`/e/${encodeURIComponent(slug)}/v`} className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-emerald-700 px-5 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Open tasting page</Link></div>}
        {data && <>
          <div className="mt-8 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">Products rated</p><p className="mt-1 font-mono text-5xl font-semibold tabular-nums text-emerald-700">{data.votedCount}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-600">Your top-five guess</p><p className="mt-2 text-xl font-semibold">{data.guessSubmitted ? "Locked in" : "Not submitted"}</p><p className="mt-1 text-sm text-slate-500">Guesses cannot be changed once sent.</p></div></div>
          {!revealed && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950"><h2 className="text-xl font-semibold">A pick for your next taste</h2><p className="mt-2 text-sm leading-6">This private suggestion uses only your ratings and the product labels. The model’s forecast and the room’s results stay hidden until reveal.</p>{early ? <div className="mt-5 flex items-center gap-4 rounded-xl bg-white p-3 text-slate-900">{earlyPhoto ? <Image src={early.thumb!} alt={`${early.brand} ${early.name} packaging`} width={80} height={80} unoptimized className="h-20 w-20 shrink-0 rounded-lg object-contain" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 px-2 text-center text-xs font-semibold">{early.brand}</span>}<div><p className="text-sm font-bold">{early.brand} · {early.name}</p><p className="mt-1 text-xs text-slate-600">{early.reason}</p></div></div> : <p className="mt-4 text-sm">Rate something to see what you might enjoy next.</p>}{data.status === "voting" && <Link href={`/e/${encodeURIComponent(slug)}/v`} className="mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Keep tasting →</Link>}</div>}
          {revealed && !data.profile && <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">No profile yet</h2><p className="mt-2 text-slate-600">{data.votedCount ? "Your taste profile is being prepared. Check back soon." : "This device did not submit a rating for this event."}</p></div>}
          {data.profile && <>
            <section aria-labelledby="archetype-title" className="mt-6 rounded-3xl bg-slate-950 p-7 text-white sm:p-9"><p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">Your tasting archetype</p><h2 id="archetype-title" className="mt-3 text-3xl font-semibold sm:text-4xl">{data.profile.archetype}</h2><p className="mt-3 text-sm leading-6 text-slate-300">A private interpretation of what you rated, not the room’s ranking.</p></section>
            <section aria-labelledby="signals-title" className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 id="signals-title" className="text-2xl font-semibold">Your taste signals</h2><p className="mt-2 text-sm text-slate-600">How your ratings align with each product’s locked principle scores · scale 1–10</p><ul className="mt-6 space-y-5">{data.profile.principles.map((item) => <li key={item.key}><div className="flex justify-between gap-4 text-sm"><span className="font-medium">{item.label}</span><span className="font-mono font-semibold tabular-nums">{item.score.toFixed(1)}</span></div><div role="meter" aria-label={item.label} aria-valuemin={1} aria-valuemax={10} aria-valuenow={item.score} className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${item.score * 10}%` }} /></div></li>)}</ul></section>
            <section aria-labelledby="next-title" className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">For your next shelf</p><h2 id="next-title" className="mt-2 text-2xl font-semibold">Try next</h2>{next ? <div className="mt-5 flex items-center gap-5">{photo ? <Image src={next.thumb!} alt={`${next.brand} ${next.name} packaging`} width={96} height={96} unoptimized className="h-24 w-24 shrink-0 rounded-xl bg-white object-contain" /> : <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-white px-2 text-center text-xs font-semibold">{next.brand}</div>}<div><p className="text-sm font-bold uppercase tracking-wide text-emerald-800">{next.brand}</p><p className="mt-1 font-semibold">{next.name}</p><p className="mt-2 text-sm text-slate-600">An unrated product closest to your taste signals.</p></div></div> : <p className="mt-3 text-sm text-slate-600">You rated every product on this shelf. Nothing left to try!</p>}</section>
          </>}
          {revealed && <Link href={`/e/${encodeURIComponent(slug)}/reveal`} className="mt-8 inline-flex min-h-12 items-center rounded-xl bg-violet-600 px-6 font-semibold text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">See the room’s reveal →</Link>}
        </>}
      </div>
    </main>
  );
}
