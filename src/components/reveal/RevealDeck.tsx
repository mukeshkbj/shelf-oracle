"use client";

import Link from "next/link";
import { isSyntheticEvent, SYNTHETIC_DISCLOSURE, SYNTHETIC_PROOF_DISCLOSURE } from "@/lib/demo";
import { useEffect, useState } from "react";
import type { PublicResult } from "./public-reveal";
import { AttributionChart, RankChart } from "./charts";
import { byRoomRank, formatCorrelation, formatDate, formatMean, formatPValue, formatRank } from "./format";

export default function RevealDeck({ result, initialAutoplay, fixture = false }: { result: PublicResult; initialAutoplay: boolean; fixture?: boolean }) {
  const { event, reveal } = result;
  const synthetic = fixture || isSyntheticEvent(event);
  const reportHref = fixture ? `/fixtures/${event.slug}` : `/e/${event.slug}/report`;
  const ranked = byRoomRank(reveal);
  const winner = ranked.find((item) => item.room && item.room.votes > 0 && item.room.rank === 1);
  const votedProducts = reveal.actual.filter((item) => item.votes > 0).length;
  const [index, setIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(initialAutoplay);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);

  const slides = [
    {
      label: "The room",
      heading: synthetic ? "A simulated room. A demo result." : "The shelf made a claim. The room answered.",
      body: <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div>
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.3em] text-emerald-300">{fixture ? "Synthetic local preview" : synthetic ? "SYNTHETIC / DEMO result" : "Live tasting / published result"}</p>
          <h2 className="max-w-5xl text-5xl font-semibold leading-[1.03] tracking-tight sm:text-7xl xl:text-8xl">{synthetic ? <>A simulated room.<br /><span className="text-emerald-400">A demo result.</span></> : <>The shelf made a claim.<br /><span className="text-emerald-400">The room answered.</span></>}</h2>
          <p className="mt-8 max-w-2xl text-base text-slate-300 sm:text-xl">{event.name}{event.location ? ` · ${event.location}` : ""}. {synthetic ? "A demo prediction compared with simulated ratings and guesses. This is not a record of real shopper demand." : "An AI prediction was locked before people tasted the products. This is what the room actually rated."}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-white/15 pt-5 lg:grid-cols-1 lg:gap-6 lg:border-l lg:border-t-0 lg:pl-8">
          {[[reveal.voterCount, "voters"], [reveal.voteCount, "ratings"], [votedProducts, "tasted products"]].map(([value, label]) => <div key={label} className="min-w-0"><span className="block font-mono text-3xl tabular-nums text-white sm:text-6xl">{value}</span><span className="block text-xs uppercase tracking-wide text-slate-300 sm:text-sm">{label}</span></div>)}
        </div>
      </div>,
    },
    {
      label: "The lock",
      heading: synthetic ? "Reconstructed demo proof." : "First, the prediction was sealed.",
      body: <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-amber-300">01 / The proof</p>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">{synthetic ? <>Reconstructed <span className="text-amber-300">demo proof.</span></> : <>First, the prediction <span className="text-amber-300">was sealed.</span></>}</h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300 sm:text-xl">{synthetic ? SYNTHETIC_PROOF_DISCLOSURE : "A fingerprint of the locked AI prediction was recorded before voting. The reveal builder compared the locked prediction with that fingerprint."}</p>
        </div>
        <div className="rounded-3xl border border-amber-300/30 bg-amber-300/5 p-5 sm:p-10">
          <p className="font-mono text-xs uppercase tracking-widest text-amber-200">SHA-256 / locked prediction</p>
          <p className="mt-7 break-all font-mono text-2xl tracking-wide text-white sm:text-4xl">{reveal.lockHash ? `${reveal.lockHash.slice(0, 12)}…` : "Fingerprint unavailable"}</p>
          <p className="mt-3 text-sm text-slate-300">{reveal.lockHash ? "First 12 characters of the recorded hash" : "No hash included in this public result"}</p>
          <p className={`mt-8 border-t border-white/15 pt-5 text-lg font-medium ${reveal.verified && reveal.lockHash ? "text-emerald-300" : "text-amber-200"}`}>{reveal.verified && reveal.lockHash ? synthetic ? "Demo payload hash matched" : "Locked prediction matched at reveal" : "Hash verification not confirmed"}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">The public report download includes the canonical locked payload for independent SHA-256 verification against this fingerprint.</p>
        </div>
      </div>,
    },
    {
      label: "The favourite",
      heading: "The room's first choice.",
      body: <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">02 / The verdict</p>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">The room&apos;s <span className="text-emerald-400">first choice.</span></h2>
          <p className="mt-6 max-w-lg text-lg text-slate-300">The top tasting rank is based on adjusted ratings; displayed means are raw scores on a 1–5 scale.</p>
        </div>
        {winner ? <div className="rounded-3xl border border-emerald-400/30 bg-emerald-400/5 p-6 sm:p-12">
          <p className="font-mono text-sm tracking-widest text-emerald-300">ROOM RANK / 01</p>
          <h3 className="mt-6 break-words text-4xl font-semibold tracking-tight sm:text-6xl">{winner.brand}</h3>
          <p className="mt-2 break-words text-lg text-slate-200 sm:text-2xl">{winner.name}</p>
          <div className="mt-10 grid grid-cols-3 gap-2 border-t border-white/15 pt-6 text-sm sm:gap-4"><div><strong className="block font-mono text-2xl tabular-nums text-emerald-300 sm:text-4xl">{formatMean(winner.room?.mean)}</strong>mean / 5</div><div><strong className="block font-mono text-2xl tabular-nums sm:text-4xl">{winner.room!.votes}</strong>ratings</div><div><strong className="block font-mono text-2xl tabular-nums text-violet-300 sm:text-4xl">{formatRank(winner.rank)}</strong>AI rank</div></div>
        </div> : <div className="rounded-3xl border border-white/15 p-8 text-xl text-slate-300">No tasted products have a ranking in this published result.</div>}
      </div>,
    },
    {
      label: "Rank shift",
      heading: synthetic ? "Demo prediction, simulated consensus and ratings." : "AI, human consensus, actual tasting.",
      body: <div>
        <p className="font-mono text-xs uppercase tracking-widest text-violet-300">03 / The rank shift</p>
        <h2 className="mt-3 mb-6 text-3xl font-semibold tracking-tight sm:text-5xl"><span className="text-violet-300">AI</span> → human consensus → <span className="text-emerald-400">{synthetic ? "simulated ratings." : "actual tasting."}</span></h2>
        <RankChart reveal={reveal} />
      </div>,
    },
    {
      label: "The numbers",
      heading: "How close was the call?",
      body: <div>
        <p className="font-mono text-xs uppercase tracking-widest text-violet-300">04 / The comparison</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">How close was the call?</h2>
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-violet-300/25 bg-violet-400/5 p-5 sm:p-8"><span className="text-sm text-violet-200">AI vs room · Spearman ρ</span><strong className="mt-5 block font-mono text-4xl tabular-nums sm:text-6xl">{formatCorrelation(reveal.metrics.spearman)}</strong><p className="mt-3 text-sm text-slate-300">Rank agreement across products eligible for both rankings. +1 is identical order; −1 is reversed.</p></div>
          <div className="rounded-2xl border border-white/15 p-5 sm:p-8"><span className="text-sm text-slate-200">Permutation test · two-sided</span><strong className="mt-5 block font-mono text-3xl tabular-nums sm:text-5xl">{formatPValue(reveal.metrics.pValue)}</strong><p className="mt-3 text-sm text-slate-300">Small values mean this degree of rank alignment is uncommon under random order, not proof of generalizability.</p></div>
          <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/5 p-5 sm:p-8"><span className="text-sm text-emerald-200">Top-five overlap</span><strong className="mt-5 block font-mono text-4xl tabular-nums sm:text-6xl">{reveal.metrics.topKOverlap}</strong><p className="mt-3 text-sm text-slate-300">Products shared by the AI top five and the room&apos;s up-to-five highest-ranked tasted products.</p></div>
        </div>
        <p className="mt-6 text-sm text-slate-300">{reveal.voterCount} voters · {reveal.voteCount} ratings · {votedProducts} tasted products. These are within-event descriptions, not an out-of-sample accuracy claim.</p>
      </div>,
    },
    {
      label: "Human guesses",
      heading: "And what did people predict?",
      body: <div>
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">05 / The human forecast</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">And what did <span className="text-emerald-400">people predict?</span></h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/5 p-6"><span className="text-sm text-emerald-200">Human consensus vs room · ρ</span><strong className="mt-4 block font-mono text-4xl tabular-nums sm:text-6xl">{formatCorrelation(reveal.metrics.humanSpearman)}</strong><p className="mt-3 text-sm text-slate-300">Consensus is aggregated from submitted ordered top-five guesses, not ratings.</p></div>
          <div className="rounded-2xl border border-violet-300/25 bg-violet-400/5 p-6"><span className="text-sm text-violet-200">AI beat individual predictors</span><strong className="mt-4 block font-mono text-4xl tabular-nums sm:text-6xl">{reveal.metrics.humansTotal ? `${reveal.metrics.aiBeatsHumans} / ${reveal.metrics.humansTotal}` : "—"}</strong><p className="mt-3 text-sm text-slate-300">Among scored individual guesses in this event; {reveal.guesserCount} submitted guesses.</p></div>
          <div className="rounded-2xl border border-white/15 p-6"><span className="text-sm text-slate-200">Predictor leaderboard · score / 100</span>{votedProducts > 0 && reveal.leaderboard.length ? <ol className="mt-4 space-y-3">{reveal.leaderboard.slice(0, 4).map((entry, i) => <li className="flex items-center justify-between gap-3 border-t border-white/10 pt-2" key={`${entry.name}-${i}`}><span className="min-w-0 break-words">{i + 1}. {entry.name}</span><strong className="font-mono tabular-nums text-emerald-300">{entry.score}</strong></li>)}</ol> : <p className="mt-4 text-sm text-slate-300">No individual leaderboard available.</p>}</div>
        </div>
        {votedProducts > 0 && reveal.consensus.length > 0 ? <div className="mt-5 overflow-hidden rounded-2xl border border-white/15">
          <p className="border-b border-white/15 px-4 py-3 text-sm text-slate-300">Room&apos;s top five tasted products · their position in each forecast</p>
          <div className="hidden grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] gap-2 px-4 py-2 font-mono text-xs uppercase text-slate-300 sm:grid"><span>Product</span><span>AI</span><span>Human</span><span>Room</span></div>
          {ranked.filter((item) => item.room && item.room.votes > 0 && item.room.rank !== null).slice(0, 5).map((item) => <div key={item.productId} className="grid grid-cols-[minmax(0,1fr)_3rem_3.5rem_3.5rem] gap-2 border-t border-white/10 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] sm:text-sm"><span className="min-w-0 break-words">{item.brand} · {item.name}</span><span className="font-mono tabular-nums text-violet-300">{formatRank(item.rank)}</span><span className="font-mono tabular-nums text-emerald-300">{formatRank(item.human?.rank)}</span><span className="font-mono tabular-nums text-white">{formatRank(item.room?.rank)}</span></div>)}
          <p className="border-t border-white/15 px-4 py-2 text-xs text-slate-300 sm:hidden">Columns: AI / human consensus / room. A dash means no consensus rank.</p>
        </div> : <p className="mt-5 text-sm text-slate-300">No rated products and human consensus to compare side by side.</p>}
      </div>,
    },
    {
      label: "What mattered",
      heading: "What tracked with the room?",
      body: <div>
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">06 / Principle comparison</p>
        <h2 className="mt-3 mb-6 text-3xl font-semibold tracking-tight sm:text-5xl">What tracked with the room?</h2>
        <AttributionChart reveal={reveal} />
        <p className="mt-4 text-sm text-slate-300">The AI rubric weight is an input; observed r compares its per-product scores with actual ratings. Association is not an explanation of why anyone voted.</p>
      </div>,
    },
    {
      label: "The misses",
      heading: "The most useful calls were the misses.",
      body: <div>
        <p className="font-mono text-xs uppercase tracking-widest text-amber-300">07 / Where we got it wrong</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">The most useful calls were <span className="text-amber-300">the misses.</span></h2>
        {reveal.misses.length ? <div className="mt-8 grid gap-4 md:grid-cols-2">{reveal.misses.slice(0, 4).map((item, i) => <article key={`${item.productId}-${i}`} className="rounded-2xl border border-white/15 p-5 sm:p-7"><p className="break-words text-xl font-medium">{item.brand} · {item.name}</p><p className="mt-4 font-mono text-sm tabular-nums text-amber-200">AI #{item.predictedRank} → room #{item.actualRank}</p><p className="mt-4 text-sm leading-relaxed text-slate-200">{item.note}</p></article>)}</div> : <p className="mt-8 text-slate-300">No highlighted misses in this event.</p>}
        <p className="mt-6 text-sm text-slate-300">Post-vote notes are interpretations (model-generated when available), not measured causes.</p>
      </div>,
    },
    {
      label: "Room voices",
      heading: synthetic ? "Simulated demo comments." : "In the room's own words.",
      body: <div>
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">08 / {synthetic ? "Simulated written feedback" : "Actual written feedback"}</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">{synthetic ? <>Simulated <span className="text-emerald-400">demo comments.</span></> : <>In the room&apos;s <span className="text-emerald-400">own words.</span></>}</h2>
        {reveal.comments.length ? <div className="mt-8 grid gap-4 md:grid-cols-2">{reveal.comments.slice(0, 4).map((entry, i) => <figure key={`${entry.product}-${i}`} className="rounded-2xl border border-white/15 p-5 sm:p-8"><blockquote className="break-words text-lg leading-relaxed sm:text-2xl">“{entry.text}”</blockquote><figcaption className="mt-5 break-words text-sm text-slate-300">{entry.brand} · {entry.product} · {entry.rating}/5 submitted rating</figcaption></figure>)}</div> : <p className="mt-8 text-slate-300">No written tasting comments were shared for this event.</p>}
        <p className="mt-6 text-sm text-slate-300">{synthetic ? "Simulated demo comments, not authentic customer testimonials or evidence of retail demand." : "Direct excerpts from submitted comments; not generated testimonials."}</p>
      </div>,
    },
    {
      label: "Keep the proof",
      heading: "One event. A record worth keeping.",
      body: <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-300">09 / After the room clears</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">One event. <span className="text-emerald-400">A record worth keeping.</span></h2>
          <p className="mt-6 max-w-2xl text-lg text-slate-300">{synthetic ? "The shareable demo report illustrates rankings, simulated votes and comments, and methodology. It must not be used as evidence for retail decisions." : "The shareable report preserves the rankings, votes, methodology, quotes and the AI's misses. A repeatable panel is a better starting point for the next shelf decision."}</p>
          <Link href={reportHref} className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-emerald-400 px-7 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400">Open the public report <span aria-hidden="true" className="ml-2">↗</span></Link>
        </div>
        <aside className="rounded-2xl border border-white/15 p-6 text-sm leading-relaxed text-slate-300"><h3 className="text-lg font-medium text-white">What this doesn&apos;t prove</h3><p className="mt-3">One self-selected room is not a representative market sample. Correlations are not causes, and the public fingerprint alone does not independently verify the original locked payload.</p><p className="mt-4">Report generated {formatDate(reveal.generatedAt)}.</p></aside>
      </div>,
    },
  ];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest("input, textarea, select, [contenteditable='true'], [role='region']")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); setIndex((i) => Math.min(slides.length - 1, i + 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      if (event.key === "Home") { event.preventDefault(); setIndex(0); }
      if (event.key === "End") { event.preventDefault(); setIndex(slides.length - 1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slides.length]);

  useEffect(() => {
    if (!autoplay || reducedMotion || hidden) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), 9000);
    return () => window.clearInterval(timer);
  }, [autoplay, reducedMotion, hidden, index, slides.length]);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-slate-950 text-stone-100">
      <div className="pointer-events-none absolute -right-32 top-12 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-10">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 font-mono text-lg font-semibold text-emerald-300">S</span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-white">Shelf Oracle</p><p className="truncate text-xs text-slate-300">{event.name} / Reveal</p></div></div>
        <div className="flex items-center gap-3 text-sm"><Link href={fixture ? "/fixtures" : `/e/${event.slug}`} className="rounded px-2 py-2 text-slate-300 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-400">{fixture ? "Fixtures" : "Event"}</Link><Link href={reportHref} className="rounded-full border border-white/20 px-4 py-2 hover:border-emerald-300 hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-400">Full report ↗</Link></div>
      </header>
      <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
        {synthetic && <aside role="note" aria-label="Synthetic demo disclosure" className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-950/40 p-4 text-sm leading-relaxed text-amber-100"><strong className="block font-semibold">SYNTHETIC / DEMO{fixture ? " · Local fixture" : " · Demo/test event"}</strong><p className="mt-1">{SYNTHETIC_DISCLOSURE}</p><p className="mt-2">{SYNTHETIC_PROOF_DISCLOSURE}</p></aside>}
        <div className="mb-6 flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-300"><span>{fixture ? "Synthetic preview" : synthetic ? "SYNTHETIC / DEMO result" : "Published result"} / {slides[index].label}</span><span className="shrink-0 tabular-nums">{String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span></div>
        <section aria-label={slides[index].heading} className="flex flex-1 flex-col justify-center py-5 sm:py-10">{slides[index].body}</section>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4">
          <p className="sr-only" aria-live="polite">Slide {index + 1} of {slides.length}: {slides[index].heading}</p>
          <div className="flex items-center gap-2"><button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Previous slide" className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/30 text-xl hover:border-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-emerald-400">←</button><button type="button" onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))} disabled={index === slides.length - 1} aria-label="Next slide" className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/30 text-xl hover:border-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-emerald-400">→</button><span className="ml-2 hidden text-xs text-slate-300 sm:block">← → to navigate</span></div>
          <button type="button" aria-pressed={autoplay && !reducedMotion} disabled={reducedMotion} onClick={() => setAutoplay((value) => !value)} className="min-h-11 rounded-full border border-white/20 px-4 py-2 text-xs text-slate-200 hover:border-white disabled:cursor-not-allowed disabled:opacity-75 focus-visible:outline-2 focus-visible:outline-emerald-400">{reducedMotion ? "Autoplay off · reduced motion" : autoplay ? "Pause autoplay" : "Play autoplay"}</button>
        </div>
        <nav aria-label="Reveal slides" className="mt-4 flex gap-1 overflow-x-auto pb-2">{slides.map((slide, i) => <button type="button" key={slide.label} onClick={() => setIndex(i)} aria-label={`Slide ${i + 1}: ${slide.label}`} aria-current={i === index ? "step" : undefined} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs focus-visible:outline-2 focus-visible:outline-emerald-400 ${i === index ? "border-emerald-400 bg-emerald-400/15 text-emerald-200" : "border-white/15 text-slate-300 hover:border-white/50"}`}>{String(i + 1).padStart(2, "0")} <span className="hidden md:inline">{slide.label}</span></button>)}</nav>
      </div>
    </main>
  );
}
