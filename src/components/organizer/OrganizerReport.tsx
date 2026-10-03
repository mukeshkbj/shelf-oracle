"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventRow } from "@/lib/types";
import { apiFetch } from "./api";

export function OrganizerReport({ event }: { event: EventRow }) {
  const router = useRouter();
  const [status, setStatus] = useState(event.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const reveal = event.reveal;
  if (!reveal) return null;
  const publicPath = `/e/${encodeURIComponent(event.slug)}/report`;
  async function copy() {
    try { await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).toString()); setNotice("Report link copied."); }
    catch { setError("Could not copy the link automatically. Open the public report and copy its address."); }
  }
  async function close() {
    setBusy(true); setError("");
    try { await apiFetch<{ ok: boolean }>(`/api/events/${encodeURIComponent(event.id)}`, "PATCH", { status: "closed" }); setStatus("closed"); setConfirm(false); setNotice("Event archived in your history. The public report stays live."); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not archive this event."); }
    finally { setBusy(false); }
  }
  return <main className="so-app-content"><div className="so-breadcrumb"><Link href="/app">Events</Link><span>/</span><Link href={`/app/e/${encodeURIComponent(event.slug)}`}>{event.name}</Link><span>/</span><span>Report</span></div><div className="so-page-header" style={{ marginTop: 23 }}><div><span className="so-kicker">EVENT REPORT / {status === "closed" ? "ARCHIVED" : "PUBLISHED"}</span><h1>What the room really wanted.</h1><p>{event.name} · {event.location || "Location not set"} · {new Date(reveal.generatedAt).toLocaleDateString("en", { dateStyle: "long" })}</p></div><Link href={publicPath} target="_blank" rel="noopener noreferrer" className="so-button so-button-violet">Open shareable report ↗</Link></div>
    {error && <div className="so-alert" role="alert" style={{ marginBottom: 17 }}>{error}</div>}{notice && <div className="so-alert so-alert-success" role="status" style={{ marginBottom: 17 }}>{notice}</div>}
    <div className="so-stats"><div className="so-panel so-stat"><span>ROOM PARTICIPANTS</span><strong>{reveal.voterCount}</strong></div><div className="so-panel so-stat"><span>RATINGS CAST</span><strong>{reveal.voteCount}</strong></div><div className="so-panel so-stat"><span>AI / ROOM CORRELATION</span><strong>{reveal.metrics.spearman?.toFixed(2) ?? "—"}</strong></div><div className="so-panel so-stat"><span>HUMAN PREDICTIONS</span><strong>{reveal.guesserCount}</strong></div></div>
    <div className="so-studio-grid"><div><section className="so-panel so-section-panel"><span className="so-kicker">01 / THE RANKING</span><h2>Predicted vs. preferred.</h2><p>The AI ranking was sealed before voting opened. This is how the room ranked each product.</p><div className="so-table-wrap"><table className="so-ranking"><thead><tr><th scope="col">ROOM</th><th scope="col">PRODUCT</th><th scope="col">ORACLE</th></tr></thead><tbody>{reveal.actual.map(item => { const predicted = reveal.predicted.find(p => p.productId === item.productId); return <tr key={item.productId}><td className="so-rank-number">{item.rank ? String(item.rank).padStart(2, "0") : "—"}</td><td><strong>{predicted?.brand || "Product"}</strong><small>{predicted?.name || ""} · {item.votes} votes · {item.mean?.toFixed(1) ?? "—"}/5 average</small></td><td className="so-score">{predicted?.rank ? `#${predicted.rank}` : "—"}</td></tr>; })}</tbody></table></div></section><section className="so-panel so-section-panel"><span className="so-kicker">02 / THE RECORD</span><h2>A prediction made before the vote.</h2><p>Verification fingerprint for this event. It remains unchanged when the report is shared or archived.</p><code className="so-hash">{reveal.lockHash}</code><span className={`so-pill so-pill-${reveal.verified ? "emerald" : "amber"}`}>{reveal.verified ? "VERIFIED LOCK" : "VERIFYING"}</span></section></div><aside className="so-studio-aside"><div className="so-panel so-side-panel"><h3>Share the evidence</h3><p>This public link is permanent, including after archiving.</p><div className="so-link-box">{publicPath}</div><div className="so-inline-actions"><button type="button" className="so-button so-button-outline" onClick={copy}>Copy link ↗</button><a className="so-button so-button-outline" href={`/api/events/${encodeURIComponent(event.id)}/export`}>Download data JSON ↓</a></div></div><div className="so-panel so-side-panel"><h3>Event lifecycle</h3><p>Archived events stay in your workspace history. Your public report remains available to anyone with the link.</p>{status === "revealed" && (confirm ? <div className="so-inline-actions"><button type="button" className="so-button so-button-amber" onClick={close} disabled={busy}>{busy ? "Archiving…" : "Yes, archive event"}</button><button type="button" className="so-button so-button-outline" onClick={() => setConfirm(false)}>Cancel</button></div> : <button type="button" className="so-button so-button-outline" onClick={() => setConfirm(true)}>Archive event →</button>)}{status === "closed" && <span className="so-pill so-pill-slate">ARCHIVED</span>}</div></aside></div>
  </main>;
}
