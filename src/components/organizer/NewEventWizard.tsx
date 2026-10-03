"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./WorkspaceShell";

function slugify(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }

export function NewEventWizard() {
  const router = useRouter();
  const { orgId, orgs } = useWorkspace();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workspace = orgs.find(o => o.org_id === orgId)?.org.name || "Your workspace";

  async function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (step === 1) { if (!slug) setSlug(slugify(name)); setStep(2); return; }
    if (step === 2) { if (!slugify(slug)) { setError("Choose a URL with letters or numbers."); return; } setSlug(slugify(slug)); setStep(3); return; }
    if (!orgId) { setError("No workspace found for this account. Please sign in again."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), location: location.trim(), slug, orgId }) });
      const data: { event?: { slug: string }; error?: string } = await res.json();
      if (!res.ok || !data.event) throw new Error(data.error || "Could not create the event.");
      router.push(`/app/e/${encodeURIComponent(data.event.slug)}`);
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect. Please try again."); setBusy(false); }
  }

  return <main className="so-app-content"><div className="so-breadcrumb"><Link href="/app">Events</Link><span aria-hidden="true">/</span><span>New event</span></div><div className="so-wizard"><span className="so-kicker">NEW TASTING PANEL / STEP 0{step} OF 03</span><div className="so-wizard-steps" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map(i => <span key={i} className={i <= step ? "active" : ""} />)}</div><form onSubmit={next} className="so-panel so-wizard-panel">
    {step === 1 && <><h2>What are we tasting?</h2><p>Give this panel a name your team will recognize later. You can always adjust it before the session.</p><div className="so-form-stack"><label className="so-field">Event name<input className="so-input" autoFocus required maxLength={80} placeholder="e.g. Spring snack tasting" value={name} onChange={e => setName(e.target.value)} /></label><label className="so-field">Location <small>Optional</small><input className="so-input" maxLength={120} placeholder="e.g. London, Studio 4" value={location} onChange={e => setLocation(e.target.value)} /></label></div></>}
    {step === 2 && <><h2>Give it a home.</h2><p>Your event gets a unique link for attendees to join from their phones. Keep it short and memorable.</p><label className="so-field">Event URL <small>Letters, numbers and hyphens only</small><input className="so-input so-mono" autoFocus required maxLength={60} value={slug} onChange={e => setSlug(e.target.value)} /></label><p className="so-hint">shelforacle / e / <strong>{slugify(slug) || "your-event"}</strong></p></>}
    {step === 3 && <><h2>Ready to set the shelf?</h2><p>Once created, you can upload the shelf photo, review every pack and run your prediction.</p><div className="so-wizard-summary"><div><span>Event</span><strong>{name}</strong></div><div><span>Location</span><strong>{location || "Not specified"}</strong></div><div><span>Attendee URL</span><strong>/e/{slug}</strong></div><div><span>Workspace</span><strong>{workspace}</strong></div></div></>}
    {error && <div className="so-alert" role="alert" style={{ marginTop: 18 }}>{error}</div>}
    <div className="so-wizard-controls">{step === 1 ? <Link href="/app" className="so-button so-button-outline">Cancel</Link> : <button type="button" onClick={() => { setError(""); setStep(step - 1); }} className="so-button so-button-outline">← Back</button>}<button type="submit" className="so-button so-button-dark" disabled={busy}>{busy ? <><span className="so-spinner" /> Creating…</> : step === 3 ? "Create event ↗" : "Continue →"}</button></div>
  </form></div></main>;
}
