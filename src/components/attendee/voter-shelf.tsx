"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { voterId } from "@/lib/slug";
import type { EventStatus, Product } from "@/lib/types";

type ShelfProduct = Pick<Product, "id" | "brand" | "name" | "category" | "format" | "price" | "claims" | "attributes" | "thumb">;
type OwnVote = { productId: string; rating: number; comment: string | null };
type PersonalData = { votes: OwnVote[]; guessSubmitted: boolean };
type PublicStatus = { event: { status: EventStatus } };
type SaveState = "saving" | "saved" | "error";

function photo(src: string | null): src is string {
  return !!src && (/^data:image\/(jpeg|png|webp);base64,/.test(src) || /^https:\/\//.test(src));
}

function ProductPhoto({ product, size = "card" }: { product: ShelfProduct; size?: "card" | "sheet" }) {
  return (
    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ${size === "card" ? "h-28 w-28" : "h-36 w-36"}`}>
      {photo(product.thumb) ? <Image src={product.thumb} alt={`${product.brand} ${product.name} packaging`} width={144} height={144} unoptimized className="h-full w-full object-contain" /> : <span className="px-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">{product.brand}</span>}
    </div>
  );
}

export function VoterShelf({ slug, eventName, initialStatus }: { slug: string; eventName: string; initialStatus: EventStatus }) {
  const [voter, setVoter] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [products, setProducts] = useState<ShelfProduct[]>([]);
  const [votes, setVotes] = useState<Record<string, OwnVote>>({});
  const [guessSubmitted, setGuessSubmitted] = useState(false);
  const [showGuess, setShowGuess] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [top5, setTop5] = useState<string[]>([]);
  const [guessPending, setGuessPending] = useState(false);
  const [guessError, setGuessError] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [active, setActive] = useState<ShelfProduct | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const queued = useRef<Record<string, Promise<void>>>({});
  const versions = useRef<Record<string, number>>({});
  const lastQueued = useRef<Record<string, { rating: number; comment: string }>>({});
  const commentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatus = useRef(initialStatus);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      let current = "";
      try {
        current = window.localStorage.getItem(`shelf-oracle:voter:${slug}`) || "";
        if (!/^v_[a-z0-9]{6,78}$/.test(current)) {
          current = voterId();
          window.localStorage.setItem(`shelf-oracle:voter:${slug}`, current);
        }
      } catch {
        current = voterId();
        if (mounted) setStorageWarning(true);
      }
      if (!mounted) return;
      setVoter(current);
      try {
        const root = `/api/e/${encodeURIComponent(slug)}`;
        const [statusResponse, meResponse] = await Promise.all([
          fetch(`${root}/status`, { cache: "no-store" }),
          fetch(`${root}/me?voterId=${encodeURIComponent(current)}`, { cache: "no-store" }),
        ]);
        if (!statusResponse.ok || !meResponse.ok) throw new Error("We couldn't load your shelf. Try refreshing.");
        const [statusData, personal] = await Promise.all([
          statusResponse.json() as Promise<PublicStatus>,
          meResponse.json() as Promise<PersonalData>,
        ]);
        let items: ShelfProduct[] = [];
        if (["voting", "revealed", "closed"].includes(statusData.event.status)) {
          const productResponse = await fetch(`${root}/products`, { cache: "no-store" });
          if (!productResponse.ok) throw new Error("We couldn't load the products. Try refreshing.");
          items = (await productResponse.json() as { products: ShelfProduct[] }).products;
        }
        if (!mounted) return;
        lastStatus.current = statusData.event.status;
        setStatus(statusData.event.status);
        setProducts(items);
        setVotes(Object.fromEntries(personal.votes.map((vote) => [vote.productId, vote])));
        setGuessSubmitted(personal.guessSubmitted);
        let skipped = false;
        try { skipped = window.localStorage.getItem(`shelf-oracle:skip:${slug}:${current}`) === "1"; } catch { skipped = false; }
        setShowGuess(!skipped && !personal.guessSubmitted && personal.votes.length === 0);
        setReady(true);
      } catch (error) {
        if (mounted) setLoadError(error instanceof Error ? error.message : "We couldn't load your shelf.");
      }
    };
    void load();
    return () => { mounted = false; };
  }, [slug]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/e/${encodeURIComponent(slug)}/status`, { cache: "no-store" });
        if (res.ok) {
          const nextStatus = (await res.json() as PublicStatus).event.status;
          if (nextStatus === "voting" && lastStatus.current !== "voting") {
            const shelf = await fetch(`/api/e/${encodeURIComponent(slug)}/products`, { cache: "no-store" });
            if (!shelf.ok) return;
            setProducts((await shelf.json() as { products: ShelfProduct[] }).products);
          }
          lastStatus.current = nextStatus;
          setStatus(nextStatus);
        }
      } catch {
        return;
      }
    }, 15000);
    return () => window.clearInterval(interval);
  }, [ready, slug]);

  useEffect(() => {
    if (!active) return;
    const previousFocus = trigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        document.getElementById("close-rating-sheet")?.click();
      }
      if (event.key === "Tab" && dialog.current) {
        const controls = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), a[href]")];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [active]);

  const submitGuess = async (event: FormEvent) => {
    event.preventDefault();
    if (!voter || top5.length !== 5 || guessPending) return;
    setGuessPending(true);
    setGuessError("");
    try {
      const res = await fetch(`/api/e/${encodeURIComponent(slug)}/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId: voter, displayName, top5 }),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error || "Couldn't lock your guess");
      setGuessSubmitted(true);
      setShowGuess(false);
    } catch (error) {
      setGuessError(error instanceof Error ? error.message : "Couldn't lock your guess");
    } finally {
      setGuessPending(false);
    }
  };

  const skipGuess = () => {
    if (voter) {
      try { window.localStorage.setItem(`shelf-oracle:skip:${slug}:${voter}`, "1"); } catch { setStorageWarning(true); }
    }
    setShowGuess(false);
  };

  const queueVote = (productId: string, nextRating: number, nextComment: string) => {
    if (!voter || status !== "voting") return;
    const next = { rating: nextRating, comment: nextComment.trim() };
    const last = lastQueued.current[productId];
    if (last?.rating === next.rating && last.comment === next.comment && saveStates[productId] !== "error") return;
    lastQueued.current[productId] = next;
    const version = (versions.current[productId] ?? 0) + 1;
    versions.current[productId] = version;
    setSaveStates((states) => ({ ...states, [productId]: "saving" }));
    const previous = queued.current[productId] ?? Promise.resolve();
    queued.current[productId] = previous.then(async () => {
      try {
        const res = await fetch(`/api/e/${encodeURIComponent(slug)}/votes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voterId: voter, productId, rating: next.rating, comment: next.comment }),
        });
        const body = await res.json() as { vote?: OwnVote; error?: string };
        if (!res.ok || !body.vote) throw new Error(body.error || "Couldn't save rating");
        setVotes((existing) => ({ ...existing, [productId]: body.vote! }));
        if (versions.current[productId] === version) setSaveStates((states) => ({ ...states, [productId]: "saved" }));
      } catch {
        if (versions.current[productId] === version) setSaveStates((states) => ({ ...states, [productId]: "error" }));
      }
    });
  };

  const openSheet = (product: ShelfProduct, source: HTMLButtonElement) => {
    trigger.current = source;
    const saved = votes[product.id];
    setRating(saved?.rating ?? null);
    setComment(saved?.comment ?? "");
    if (saved) lastQueued.current[product.id] = { rating: saved.rating, comment: saved.comment ?? "" };
    setActive(product);
  };

  const flushComment = () => {
    if (commentTimer.current) clearTimeout(commentTimer.current);
    if (active && rating) queueVote(active.id, rating, comment);
  };

  const closeSheet = () => {
    flushComment();
    setActive(null);
  };

  const chooseRating = (value: number) => {
    if (!active) return;
    if (commentTimer.current) clearTimeout(commentTimer.current);
    setRating(value);
    queueVote(active.id, value, comment);
  };

  const changeComment = (value: string) => {
    setComment(value);
    if (commentTimer.current) clearTimeout(commentTimer.current);
    if (active && rating) commentTimer.current = setTimeout(() => queueVote(active.id, rating, value), 700);
  };

  const count = Object.keys(votes).filter((id) => products.some((product) => product.id === id)).length;
  const canVote = status === "voting";
  const guessing = canVote && ready && showGuess && !guessSubmitted && count === 0 && products.length >= 5;

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 pb-24 pt-5 text-slate-900 sm:px-7">
      <div className="mx-auto max-w-4xl">
        <nav aria-label="Event navigation" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link href={`/e/${encodeURIComponent(slug)}`} className="inline-flex min-h-11 items-center font-semibold text-slate-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600">← {eventName}</Link>
          <Link href={`/e/${encodeURIComponent(slug)}/me`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600">My taste profile →</Link>
        </nav>
        <header className="mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Shelf Oracle · Your tasting</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Build your shelf.</h1>
          <p className="mt-3 max-w-2xl text-slate-600">{canVote ? "Guess the standouts before you taste, or skip straight to rating. Your shelf saves as you go." : status === "revealed" || status === "closed" ? "Tasting is closed. See your saved ratings and your taste profile." : "The shelf isn't open for tasting yet. Come back when the organizer starts voting."}</p>
        </header>
        {storageWarning && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Browser storage is unavailable. Your ratings may not follow you to another visit.</p>}
        {loadError && <div role="alert" className="mt-7 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800"><p>{loadError}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 font-semibold">Try again</button></div>}
        {!ready && !loadError && <p role="status" className="mt-8 text-slate-600">Loading your shelf…</p>}
        {ready && !canVote && status !== "revealed" && status !== "closed" && <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">Tasting opens after the prediction is locked. No ratings are being collected yet.</div>}
        {ready && (canVote || status === "revealed" || status === "closed") && (
          <>
            {guessing && (
              <section aria-labelledby="guess-title" className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-700"><span className="rounded-full bg-violet-100 px-3 py-1">Optional · Before tasting</span></div>
                <h2 id="guess-title" className="mt-4 text-2xl font-semibold">Which five will win the room?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Tap five products in order, from your #1 to #5. Your guess is locked forever when submitted. You can skip this step.</p>
                <form onSubmit={submitGuess} className="mt-5">
                  <label htmlFor="guess-name" className="block text-sm font-semibold">Name or handle</label>
                  <input id="guess-name" autoComplete="nickname" maxLength={30} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we call you?" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 focus-visible:outline-2 focus-visible:outline-emerald-600" />
                  <p className="mt-2 text-xs text-slate-600">Use a nickname. This handle may appear on the public predictor leaderboard.</p>
                  <p className="mt-4 text-sm font-semibold" aria-live="polite">Your top five · {top5.length} of 5 picked</p>
                  <ol className="mt-2 grid gap-2 sm:grid-cols-5">
                    {Array.from({ length: 5 }, (_, index) => {
                      const selected = products.find((product) => product.id === top5[index]);
                      return <li key={index} className="min-h-16 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2 text-sm">
                        {selected ? <button type="button" onClick={() => setTop5((current) => current.filter((id) => id !== selected.id))} aria-label={`Remove ${selected.brand} ${selected.name} from position ${index + 1}`} className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-emerald-600"><span className="font-mono font-semibold text-violet-700">#{index + 1}</span><span className="line-clamp-2">{selected.brand} {selected.name}</span><span aria-hidden="true" className="ml-auto">×</span></button> : <span className="flex min-h-11 items-center gap-2 px-2 text-slate-500"><span className="font-mono">#{index + 1}</span> Pick a product</span>}
                      </li>;
                    })}
                  </ol>
                  <div className="mt-5 grid max-h-80 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2" aria-label="Products to rank">
                    {products.map((product) => {
                      const position = top5.indexOf(product.id);
                      return <button key={product.id} type="button" aria-pressed={position >= 0} disabled={position < 0 && top5.length >= 5} onClick={() => setTop5((current) => position >= 0 ? current.filter((id) => id !== product.id) : [...current, product.id])} className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 ${position >= 0 ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-violet-300"}`}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white font-mono font-semibold text-violet-700">{position >= 0 ? `#${position + 1}` : "+"}</span>
                        <span><strong className="block">{product.brand}</strong><span className="line-clamp-1 text-slate-600">{product.name}</span></span>
                      </button>;
                    })}
                  </div>
                  {guessError && <p role="alert" className="mt-4 text-sm text-red-700">{guessError}</p>}
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="submit" disabled={top5.length !== 5 || guessPending} className="min-h-12 rounded-xl bg-violet-600 px-6 font-semibold text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-50">{guessPending ? "Locking…" : "Lock my top five"}</button>
                    <button type="button" onClick={skipGuess} className="min-h-12 rounded-xl border border-slate-300 px-6 font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600">Skip to tasting</button>
                  </div>
                </form>
              </section>
            )}
            {!guessing && (
              <section aria-labelledby="products-title" className="mt-8">
                {guessSubmitted && <p role="status" className="mb-5 rounded-xl bg-violet-50 p-4 text-sm font-medium text-violet-800">Your top-five guess is locked. It cannot be changed.</p>}
                {canVote && !guessSubmitted && count === 0 && products.length < 5 && <p className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">A top-five guess needs at least five products. You can still rate what is here.</p>}
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Your progress</p><h2 id="products-title" className="mt-1 text-2xl font-semibold">Rate the range</h2></div>
                  <span className="font-mono text-xl font-semibold tabular-nums" aria-live="polite">{count} / {products.length}</span>
                </div>
                <progress max={Math.max(products.length, 1)} value={count} aria-label={`${count} of ${products.length} products rated`} className="mt-4 h-3 w-full accent-emerald-600" />
                {products.length === 0 && <p className="mt-5 text-slate-600">No products on the shelf yet.</p>}
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {products.map((product) => {
                    const saved = votes[product.id];
                    const state = saveStates[product.id];
                    return <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                      <button type="button" onClick={(event) => openSheet(product, event.currentTarget)} className="flex min-h-32 w-full items-start gap-4 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                        <ProductPhoto product={product} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold uppercase tracking-wide text-emerald-700">{product.brand}</span>
                          <span className="mt-1 block font-semibold leading-snug">{product.name}</span>
                          {product.format && <span className="mt-1 block text-xs text-slate-500">{product.format}</span>}
                          {product.price && <span className="mt-2 block text-sm font-medium">{product.price}</span>}
                          <span className={`mt-3 block text-sm font-semibold ${state === "error" ? "text-red-700" : saved ? "text-emerald-700" : "text-slate-500"}`} aria-live="polite">{state === "saving" ? "Saving…" : state === "error" ? "Save failed · tap to retry" : saved ? `Saved · ${saved.rating}/5` : canVote ? "Tap to rate" : "Not rated"}</span>
                        </span>
                      </button>
                      {product.claims?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{product.claims.slice(0, 3).map((claim, index) => <span key={`${claim}-${index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{claim}</span>)}</div>}
                    </article>;
                  })}
                </div>
                {count > 0 && <Link href={`/e/${encodeURIComponent(slug)}/me`} className="mt-8 inline-flex min-h-12 items-center rounded-xl bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">See my taste profile →</Link>}
              </section>
            )}
          </>
        )}
      </div>
      {active && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSheet(); }}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-9 shadow-2xl outline-none sm:rounded-3xl sm:p-8">
          <div className="flex items-center justify-between gap-4"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Your tasting notes</p><button id="close-rating-sheet" type="button" onClick={closeSheet} aria-label="Close product details" className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 text-2xl hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600">×</button></div>
          <div className="mt-3 flex gap-5"><ProductPhoto product={active} size="sheet" /><div><p className="text-sm font-semibold text-emerald-700">{active.brand}</p><h2 id="sheet-title" className="mt-1 text-xl font-semibold">{active.name}</h2>{active.category && <p className="mt-2 text-sm text-slate-500">{active.category}</p>}{active.format && <p className="mt-1 text-sm text-slate-500">{active.format}</p>}{active.price && <p className="mt-2 font-medium">{active.price}</p>}</div></div>
          {active.claims?.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{active.claims.map((claim, index) => <span key={`${claim}-${index}`} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{claim}</span>)}</div>}
          {active.attributes && Object.keys(active.attributes).length > 0 && <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">{Object.entries(active.attributes).slice(0, 8).map(([key, value]) => <div key={key}><dt className="capitalize text-slate-500">{key.replaceAll("_", " ")}</dt><dd className="font-medium">{value}</dd></div>)}</dl>}
          <fieldset className="mt-7" disabled={!canVote}><legend className="font-semibold">How did it taste?</legend><p className="mt-1 text-sm text-slate-500">Choose one rating from 1 to 5. It saves automatically.</p><div className="mt-3 flex gap-2" aria-label="Rating out of five">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} out of 5`} aria-pressed={rating === value} onClick={() => chooseRating(value)} className={`flex min-h-12 min-w-12 flex-1 items-center justify-center rounded-xl border text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-60 ${rating === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500"}`}>{value}</button>)}</div></fieldset>
          <label htmlFor="taste-comment" className="mt-6 block font-semibold">What stood out? <span className="font-normal text-slate-500">Optional</span></label>
          <p className="mt-1 text-xs text-slate-600">Optional comments may be analysed by Gemini and quoted without your name on the public report. Avoid personal details.</p>
          <textarea id="taste-comment" maxLength={280} rows={3} disabled={!canVote} value={comment} onChange={(event) => changeComment(event.target.value)} onBlur={flushComment} placeholder="Texture, flavour, surprise…" className="mt-2 w-full rounded-xl border border-slate-300 p-3 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:bg-slate-100" />
          <p className="text-right text-xs text-slate-500">{comment.length} / 280</p>
          <p role="status" aria-live="polite" className={`mt-3 text-sm font-medium ${saveStates[active.id] === "error" ? "text-red-700" : "text-emerald-700"}`}>{saveStates[active.id] === "saving" ? "Saving your rating…" : saveStates[active.id] === "error" ? "Save failed. Check your connection and retry." : votes[active.id] ? "Saved to your shelf" : canVote ? "Select a rating to save" : "Voting is closed"}</p>
          {saveStates[active.id] === "error" && canVote && rating && <button type="button" onClick={() => queueVote(active.id, rating, comment)} className="mt-3 min-h-11 rounded-xl border border-red-300 px-5 font-semibold text-red-800 focus-visible:outline-2 focus-visible:outline-red-600">Retry save</button>}
          <button type="button" onClick={closeSheet} className="mt-5 min-h-12 w-full rounded-xl bg-slate-900 px-5 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">Done</button>
        </div>
      </div>}
    </main>
  );
}
