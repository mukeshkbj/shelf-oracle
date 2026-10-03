"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventRow, EventStatus, PredictionPayload, Product, RevealPayload } from "@/lib/types";
import { PRINCIPLES } from "@/lib/principles";
import { apiFetch } from "./api";
import { RubricEditor } from "./RubricEditor";
import { IntakePanel } from "./IntakePanel";
import { AttendeeLink } from "./AttendeeLink";

export type Monitor = { voteCount: number; voterCount: number; guessCount: number; comments: { text: string; rating: number; productId: string; createdAt: string }[] };
type Stage = "intake" | "predict" | "live" | "results";
const label: Record<EventStatus, string> = { setup: "Setting up", intake: "Intake", locked: "Reveal pending", voting: "Voting live", revealed: "Revealed", closed: "Archived" };
const color: Record<EventStatus, string> = { setup: "slate", intake: "violet", locked: "amber", voting: "emerald", revealed: "emerald", closed: "slate" };
const stageFor = (status: EventStatus): Stage => status === "revealed" || status === "closed" ? "results" : status === "voting" || status === "locked" ? "live" : "intake";
const phaseOrder: Record<EventStatus, number> = { setup: 0, intake: 1, voting: 2, locked: 3, revealed: 4, closed: 5 };
const protectedStage = (stage: Stage, status: EventStatus, productCount: number) => stage === "intake" || (stage === "predict" && productCount > 0) || ((stage === "live" || stage === "results") && !["setup", "intake"].includes(status));

export function EventStudio({ event, initialProducts, imageCount, monitor }: { event: EventRow; initialProducts: Product[]; imageCount: number; monitor: Monitor }) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [stage, setStage] = useState<Stage>(() => stageFor(event.status));
  const [localStatus, setLocalStatus] = useState<EventStatus | null>(null);
  const [localDraft, setLocalDraft] = useState<PredictionPayload | null>(null);
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [localLockedAt, setLocalLockedAt] = useState<string | null>(null);
  const [localReveal, setLocalReveal] = useState<RevealPayload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmLock, setConfirmLock] = useState(false);
  const [lockAcknowledged, setLockAcknowledged] = useState(false);
  const [draftNeedsRefresh, setDraftNeedsRefresh] = useState(false);
  const status = localStatus && phaseOrder[localStatus] > phaseOrder[event.status] ? localStatus : event.status;
  const draft = localDraft || event.draft;
  const hash = localHash || event.lock_hash;
  const lockedAt = localLockedAt || event.locked_at;
  const reveal = localReveal || event.reveal;
  const editable = status === "setup" || status === "intake";
  const base = `/api/events/${encodeURIComponent(event.id)}`;
  const reportPath = `/e/${encodeURIComponent(event.slug)}/report`;

  useEffect(() => {
    if (status !== "voting") return;
    const interval = window.setInterval(() => router.refresh(), 12000);
    return () => window.clearInterval(interval);
  }, [router, status]);

  function choose(next: Stage) { setStage(next); setError(""); setNotice(""); }
  async function action<T>(path: string, progress: string): Promise<T | null> {
    setBusy(progress); setError(""); setNotice("");
    try { const response = await apiFetch<T>(`${base}/${path}`, "POST"); router.refresh(); return response; }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong. Please try again."); router.refresh(); return null; }
    finally { setBusy(""); }
  }
  async function predict() {
    const result = await action<{ draft: PredictionPayload }>("predict", "Building the prediction…");
    if (result) { setLocalDraft(result.draft); setDraftNeedsRefresh(false); setLocalStatus("intake"); setNotice("Draft ready. Review the ranking before you lock it."); }
  }
  async function lock() {
    if (!lockAcknowledged || draftNeedsRefresh) return;
    const result = await action<{ hash: string; lockedAt: string; prediction?: PredictionPayload }>("lock", "Sealing prediction…");
    if (result) { setLocalHash(result.hash); setLocalLockedAt(result.lockedAt); setLocalStatus("voting"); if (result.prediction) setLocalDraft(result.prediction); setConfirmLock(false); setStage("live"); setNotice("Prediction locked. Voting is live."); }
  }
  async function buildReveal() {
    const result = await action<{ reveal: RevealPayload }>("reveal", "Building reveal…");
    if (result) { setLocalReveal(result.reveal); setLocalStatus("locked"); setNotice("Voting is closed and the reveal is frozen. Review the evidence, then publish when you're ready."); }
  }
  async function publish() {
    const result = await action<{ ok?: boolean; status?: string }>("publish", "Publishing report…");
    if (result && (result.ok || result.status === "revealed")) { setLocalStatus("revealed"); setNotice("The reveal is public. Your report is ready to share."); }
  }
  async function copyHash() {
    if (!hash) return;
    try { await navigator.clipboard.writeText(hash); setNotice("Lock fingerprint copied."); }
    catch { setError("Could not copy automatically. Select the fingerprint and copy it manually."); }
  }
  async function exportJson() {
    setBusy("Preparing export…"); setError("");
    try {
      const response = await fetch(`${base}/export`, { cache: "no-store" });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || "Export unavailable. Try again later."); }
      const blob = await response.blob();
      download(blob, `${event.slug}-data.json`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not export data."); }
    finally { setBusy(""); }
  }
  function exportCsv() {
    if (!reveal) return;
    const actual = new Map(reveal.actual.map(item => [item.productId, item]));
    const predicted = new Map(reveal.predicted.map(item => [item.productId, item]));
    const csv = [["Brand", "Product", "AI rank", "AI score", "Room rank", "Room average", "Votes"], ...products.map(p => { const a = actual.get(p.id); const ai = predicted.get(p.id); return [p.brand, p.name, ai?.rank ?? "", ai?.score ?? "", a?.rank ?? "", a?.mean ?? "", a?.votes ?? 0]; })].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    download(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), `${event.slug}-rankings.csv`);
  }
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stages: { key: Stage; number: string; title: string }[] = [{ key: "intake", number: "01", title: "Shelf intake" }, { key: "predict", number: "02", title: "AI prediction" }, { key: "live", number: "03", title: "Live panel" }, { key: "results", number: "04", title: "Reveal & report" }];

  return <main className="so-app-content">
    <div className="so-breadcrumb"><Link href="/app">Events</Link><span aria-hidden="true">/</span><span>{event.name}</span></div>
    <div className="so-event-hero"><div><span className="so-kicker">EVENT STUDIO / {event.slug.toUpperCase()}</span><h1>{event.name}</h1><p>{event.location || "Location not set"} · Created {new Date(event.created_at).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" })}</p></div><div className="so-event-hero-side"><span className={`so-pill so-pill-${color[status]}`}>{label[status]}</span><Link className="so-button so-button-outline" href={`/e/${encodeURIComponent(event.slug)}`} target="_blank" rel="noopener noreferrer">Attendee page ↗</Link></div></div>
    <div className="so-stage-nav" role="tablist" aria-label="Event stages">{stages.map(item => <button role="tab" key={item.key} type="button" aria-selected={stage === item.key} aria-controls="event-stage-panel" disabled={!protectedStage(item.key, status, products.length)} onClick={() => choose(item.key)}><small>{item.number}</small> {item.title}</button>)}</div>
    {(error || notice) && <div className={`so-alert ${!error ? "so-alert-success" : ""}`} role={error ? "alert" : "status"} style={{ marginBottom: 17 }}>{error || notice}</div>}
    <div className="so-studio-grid"><div className="so-studio-main" id="event-stage-panel" role="tabpanel">
      {stage === "intake" && <><IntakePanel id={event.id} editable={editable} products={products} onProduct={product => { setProducts(previous => previous.some(p => p.id === product.id) ? previous.map(p => p.id === product.id ? product : p) : [...previous, product]); if (draft) { setDraftNeedsRefresh(true); setConfirmLock(false); } router.refresh(); }} onRemove={id => { setProducts(previous => previous.filter(p => p.id !== id)); if (draft) { setDraftNeedsRefresh(true); setConfirmLock(false); } router.refresh(); }} onIntake={() => { setLocalStatus("intake"); router.refresh(); }} />{products.length > 0 && <div className="so-inline-actions"><button type="button" className="so-button so-button-dark" onClick={() => choose("predict")}>Continue to prediction →</button></div>}</>}
      {stage === "predict" && <><section className="so-panel so-section-panel"><span className="so-kicker">02 / ORACLE PREDICTION</span><h2>Make the call before the room does.</h2><p>The Oracle scores the products against behavioural principles, then ranks the lineup. Draft as many times as you need before you lock it. After locking, the ranking cannot be changed.</p>
        <RubricEditor eventId={event.id} principles={event.settings?.principles ?? PRINCIPLES} editable={editable} onSaved={() => { setLocalDraft(null); setDraftNeedsRefresh(true); setConfirmLock(false); router.refresh(); }} />
        {draftNeedsRefresh && <div className="so-alert" role="alert" style={{ marginBottom: 17 }}>The lineup or rubric changed after this draft. Re-run the prediction before locking.</div>}
        {draft ? <><div className="so-toolbar"><h2>Predicted ranking</h2><span>{draft.items.length} PRODUCTS · {draft.model}</span></div><div className="so-table-wrap"><table className="so-ranking"><thead><tr><th scope="col">RANK</th><th scope="col">PRODUCT</th><th scope="col">AI SCORE / 100</th></tr></thead><tbody>{draft.items.map(item => <tr key={item.productId}><td className="so-rank-number">{String(item.rank).padStart(2, "0")}</td><td><strong>{item.brand}</strong><small>{item.name}</small></td><td className="so-score">{item.score.toFixed(1)}</td></tr>)}</tbody></table></div><p className="so-hint" style={{ marginTop: 12 }}>Drafted {new Date(draft.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}. Scores estimate how the room might respond, not product quality.</p></> : <div className="so-empty"><span className="so-empty-icon" aria-hidden="true">◇</span><h3>No prediction yet.</h3><p>Review your product lineup and generate a first draft. Nothing goes public until you lock it.</p></div>}
        {editable && <div className="so-inline-actions"><button type="button" disabled={Boolean(busy) || !products.length} onClick={predict} className="so-button so-button-violet">{busy === "Building the prediction…" ? <><span className="so-spinner" /> Analysing the lineup…</> : draft ? "Re-run prediction ↗" : "Generate draft ↗"}</button>{draft && !draftNeedsRefresh && !confirmLock && <button type="button" className="so-button so-button-outline" onClick={() => setConfirmLock(true)}>Lock prediction →</button>}</div>}
        {!editable && hash && <div className="so-lock-panel"><h3>Sealed before voting</h3><p>This ranking is immutable. Its fingerprint is publicly shown during the reveal.</p><code className="so-hash">{hash}</code></div>}
      </section>{editable && draft && !draftNeedsRefresh && confirmLock && <section className="so-lock-panel"><h3>Seal this prediction?</h3><p>This freezes the lineup and ranking permanently, generates a cryptographic fingerprint, and opens voting immediately. You cannot edit products or rerun the prediction after this.</p><label className="so-field" style={{ display: "flex", alignItems: "center", gap: 10 }}><input type="checkbox" checked={lockAcknowledged} onChange={e => setLockAcknowledged(e.target.checked)} /> I&apos;ve reviewed the lineup and I&apos;m ready to open voting.</label><div className="so-inline-actions"><button type="button" className="so-button so-button-amber" disabled={!lockAcknowledged || Boolean(busy)} onClick={lock}>{busy === "Sealing prediction…" ? "Sealing…" : "Lock & open voting ↗"}</button><button type="button" className="so-button so-button-outline" onClick={() => { setConfirmLock(false); setLockAcknowledged(false); }}>Go back</button></div></section>}</>}
      {stage === "live" && <><section className="so-panel so-section-panel"><span className="so-kicker">03 / LIVE PANEL</span><h2>{status === "voting" ? "The room is now in the loop." : "Voting has closed."}</h2><p>{status === "voting" ? "Share the QR at the tasting table. Attendees make their own predictions and rate products from their phones." : "The room's responses have been frozen for the reveal. You can still view the attendee link, but no new votes can be cast."}</p><AttendeeLink slug={event.slug} /></section><section className="so-panel so-section-panel"><div className="so-toolbar"><h2>Room pulse</h2><span><span className="so-dot so-dot-emerald" /> {status === "voting" ? "UPDATES EVERY 12 SECONDS" : "VOTING CLOSED"}</span></div><div className="so-monitor-stats"><div><span>RATINGS CAST</span><strong>{monitor.voteCount}</strong></div><div><span>UNIQUE TASTERS</span><strong>{monitor.voterCount}</strong></div><div><span>HUMAN GUESSES</span><strong>{monitor.guessCount}</strong></div></div><h2 style={{ fontSize: 14, marginTop: 22 }}>Latest from the room</h2>{monitor.comments.length ? monitor.comments.map((comment, index) => { const product = products.find(p => p.id === comment.productId); return <div className="so-comment" key={`${comment.productId}-${index}`}><small>{product ? `${product.brand} — ${product.name}` : "Product"} · {comment.rating}/5</small><p>“{comment.text}”</p><small>{new Date(comment.createdAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}</small></div>; }) : <p className="so-hint">No comments yet. Share the voting link and watch this space.</p>}</section><div className="so-inline-actions"><button type="button" className="so-button so-button-dark" onClick={() => choose("results")}>{reveal ? "See reveal →" : "Build reveal →"}</button></div></>}
      {stage === "results" && <><section className="so-panel so-section-panel"><span className="so-kicker">04 / THE REVEAL</span><h2>Show what actually happened.</h2><p>Compare the sealed prediction with the room&apos;s ranking, then publish a report people can return to.</p>{!reveal ? <div className="so-empty"><span className="so-empty-icon" aria-hidden="true">≠</span><h3>There&apos;s a story here.</h3><p>{monitor.voteCount ? `${monitor.voteCount} ratings are in. Building the reveal closes voting and freezes the results. Wait until everyone is done.` : "No ratings yet. You can build a reveal once the room starts voting."}</p><button type="button" className="so-button so-button-violet" disabled={Boolean(busy) || !monitor.voteCount} onClick={buildReveal}>{busy === "Building reveal…" ? <><span className="so-spinner" /> Calculating…</> : "Build reveal ↗"}</button></div> : <><div className="so-reveal-metrics"><div><strong>{reveal.voterCount}</strong><small>HUMAN TASTERS</small></div><div><strong>{reveal.voteCount}</strong><small>RATINGS CAST</small></div><div><strong>{reveal.metrics?.spearman == null ? "—" : reveal.metrics.spearman.toFixed(2)}</strong><small>AI / ROOM ρ</small></div></div><div className="so-toolbar"><h2>Where the room landed</h2><span>AI VS HUMAN</span></div><div className="so-table-wrap"><table className="so-ranking"><thead><tr><th scope="col">ROOM</th><th scope="col">PRODUCT</th><th scope="col">ORACLE</th></tr></thead><tbody>{reveal.actual.map(item => { const product = products.find(p => p.id === item.productId); const prediction = reveal.predicted.find(p => p.productId === item.productId); return <tr key={item.productId}><td className="so-rank-number">{item.rank ? String(item.rank).padStart(2, "0") : "—"}</td><td><strong>{product?.brand || prediction?.brand || "Product"}</strong><small>{product?.name || prediction?.name || ""} · {item.votes} ratings</small></td><td className="so-score">{prediction?.rank ? `#${prediction.rank}` : "—"}</td></tr>; })}</tbody></table></div>{status === "voting" || status === "locked" ? <div className="so-inline-actions"><button type="button" className="so-button so-button-dark" disabled={Boolean(busy)} onClick={publish}>{busy === "Publishing report…" ? "Publishing…" : "Publish reveal ↗"}</button></div> : <div className="so-alert so-alert-success" role="status" style={{ marginTop: 20 }}>Published. Voting is closed and the report is shareable.</div>}</>}
      </section>{reveal && <section className="so-panel so-section-panel"><h2>The report lives on.</h2><p>Share the public report when published, or export the full event data for your own analysis.</p><div className="so-export-links">{["revealed", "closed"].includes(status) && <><Link href={reportPath} target="_blank" rel="noopener noreferrer" className="so-button so-button-violet">View public report ↗</Link><Link href={`/app/e/${encodeURIComponent(event.slug)}/report`} className="so-button so-button-outline">Organizer report ↗</Link><Link href={`/e/${encodeURIComponent(event.slug)}/reveal`} target="_blank" rel="noopener noreferrer" className="so-button so-button-outline">Open stage deck ↗</Link></>}<button type="button" className="so-button so-button-outline" disabled={Boolean(busy)} onClick={exportJson}>Download data JSON ↓</button><button type="button" className="so-button so-button-outline" onClick={exportCsv}>Rankings CSV ↓</button></div>{["revealed", "closed"].includes(status) && <div className="so-link-box" style={{ marginTop: 16 }}>{reportPath}</div>}</section>}</>}
    </div><aside className="so-studio-aside"><div className="so-panel so-side-panel"><h3>Event at a glance</h3><dl><div><dt>Phase</dt><dd><span className={`so-pill so-pill-${color[status]}`}>{label[status]}</span></dd></div><div><dt>Products</dt><dd>{products.length}</dd></div><div><dt>Shelf photos</dt><dd>{imageCount}</dd></div><div><dt>Votes</dt><dd>{monitor.voteCount}</dd></div><div><dt>People</dt><dd>{monitor.voterCount}</dd></div></dl></div><div className="so-panel so-side-panel"><h3>Integrity record</h3>{hash ? <><p>Prediction sealed {lockedAt ? new Date(lockedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "before voting"}. This fingerprint proves the call came first.</p><code className="so-hash">{hash}</code><button type="button" className="so-icon-button" onClick={copyHash}>Copy fingerprint ↗</button></> : <p>No lock yet. The ranking remains private and editable until you seal it.</p>}</div><div className="so-panel so-side-panel"><h3>How this works</h3><div className="so-activity"><p><strong>01</strong> Review the shelf</p><p><strong>02</strong> Draft and lock</p><p><strong>03</strong> Share the QR</p><p><strong>04</strong> Reveal the difference</p></div></div></aside></div>
  </main>;
}
