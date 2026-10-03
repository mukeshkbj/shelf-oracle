"use client";

import Link from "next/link";
import Image from "next/image";
import { useWorkspace } from "./WorkspaceShell";
import type { EventRow } from "@/lib/types";

type EventSummary = EventRow & { productCount: number; thumbs: string[]; voteCount: number; voterCount: number };
const statusLabel: Record<EventRow["status"], string> = { setup: "Setting up", intake: "Intake", locked: "Reveal pending", voting: "Voting live", revealed: "Revealed", closed: "Archived" };
const statusColor: Record<EventRow["status"], string> = { setup: "slate", intake: "violet", locked: "amber", voting: "emerald", revealed: "emerald", closed: "slate" };

export function EventsOverview({ events }: { events: EventSummary[] }) {
  const { orgId, orgs } = useWorkspace();
  const visible = events.filter(e => e.org_id === orgId);
  const active = visible.filter(e => ["locked", "voting"].includes(e.status)).length;
  const completed = visible.filter(e => ["revealed", "closed"].includes(e.status)).length;
  return <main className="so-app-content">
    <div className="so-page-header"><div><span className="so-kicker">EVENT HISTORY / {orgs.find(o => o.org_id === orgId)?.org.name.toUpperCase() || "YOUR WORKSPACE"}</span><h1>Every panel, in one place.</h1><p>Follow the room in real time. Revisit the evidence any time.</p></div><Link href="/app/new" className="so-button so-button-dark">New event <span aria-hidden="true">↗</span></Link></div>
    <div className="so-stats"><div className="so-panel so-stat"><span>TOTAL EVENTS</span><strong>{visible.length}</strong></div><div className="so-panel so-stat"><span>LIVE / PENDING</span><strong>{active}</strong></div><div className="so-panel so-stat"><span>REPORTS READY</span><strong>{completed}</strong></div><div className="so-panel so-stat"><span>HUMAN VOTES</span><strong>{visible.reduce((sum, e) => sum + e.voteCount, 0)}</strong></div></div>
    <div className="so-toolbar"><h2>All events</h2><span>{visible.length} {visible.length === 1 ? "EVENT" : "EVENTS"} · NEWEST FIRST</span></div>
    {visible.length === 0 ? <div className="so-panel so-empty"><span className="so-empty-icon" aria-hidden="true">▦</span><h3>Your first panel starts here.</h3><p>Make an event, photograph the shelf and give the room something to vote on. All your past panels will live here.</p><Link href="/app/new" className="so-button so-button-violet">Create an event <span aria-hidden="true">↗</span></Link></div> : <div className="so-event-grid">{visible.map(event => <Link href={`/app/e/${encodeURIComponent(event.slug)}`} className="so-panel so-event-card" key={event.id}><div className="so-event-card-head"><span className="so-kicker">{new Date(event.created_at).toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</span><span className={`so-pill so-pill-${statusColor[event.status]}`}>{statusLabel[event.status]}</span></div><h3>{event.name}</h3><p>{event.location || "Location not set"}</p><div className="so-event-card-metrics"><div><strong>{event.productCount}</strong> <span>products</span></div><div><strong>{event.voteCount}</strong> <span>votes</span></div><div><strong>{event.voterCount}</strong> <span>voters</span></div>{event.reveal?.metrics?.spearman != null && <div><strong>{event.reveal.metrics.spearman.toFixed(2)}</strong> <span>ρ score</span></div>}</div><div className="so-event-card-foot"><div className="so-thumb-strip" aria-hidden="true">{event.thumbs.length ? event.thumbs.map((thumb, i) => <Image key={i} alt="" src={thumb} width={32} height={34} unoptimized />) : <><i className="so-thumb-placeholder" /><i className="so-thumb-placeholder" /><i className="so-thumb-placeholder" /></>}</div><span>OPEN EVENT ↗</span></div></Link>)}</div>}
  </main>;
}
