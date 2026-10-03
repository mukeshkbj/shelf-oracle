"use client";

import { useState, type FormEvent } from "react";
import { PRINCIPLES } from "@/lib/principles";
import { apiFetch } from "./api";

type Weight = { key: string; label: string; weight: number };

export function RubricEditor({ eventId, principles, editable, onSaved }: {
  eventId: string;
  principles: Weight[];
  editable: boolean;
  onSaved: () => void;
}) {
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(principles.map(({ key, weight }) => [key, String(weight)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const labels = new Map(principles.map((principle) => [principle.key, principle.label]));
  const changed = PRINCIPLES.some((principle) => Number(weights[principle.key]) !==
    principles.find((item) => item.key === principle.key)?.weight);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const values = PRINCIPLES.map(({ key }) => ({ key, weight: Number(weights[key]) }));
    if (values.some(({ weight }) => !Number.isFinite(weight) || weight < 0.1 || weight > 20)) {
      setError("Use a weight between 0.1 and 20 for every principle.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch<{ ok: boolean }>(`/api/events/${encodeURIComponent(eventId)}`, "PATCH", {
        settings: { principles: values },
      });
      setSaved(true);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Weights could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <details className="mt-6 rounded-xl border border-line bg-surface p-4 sm:p-5">
    <summary className="cursor-pointer text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ai">Behavioural rubric · {editable ? "adjust weights" : "locked weights"}</summary>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-quiet">Each principle receives an AI score from 1–10. The event ranks products by the weighted average, with shelf salience breaking ties. Changing weights invalidates any existing draft.</p>
    <form className="mt-5" onSubmit={submit}>
      <div className="grid gap-x-7 gap-y-4 sm:grid-cols-2">
        {PRINCIPLES.map(({ key }) => <label key={key} className="flex min-h-12 items-center justify-between gap-3 text-sm text-ink">
          <span>{labels.get(key) || key}</span>
          <input type="number" inputMode="decimal" min="0.1" max="20" step="0.1" required disabled={!editable || saving}
            value={weights[key] ?? ""} onChange={(event) => { setWeights((previous) => ({ ...previous, [key]: event.target.value })); setSaved(false); }}
            className="h-11 w-20 shrink-0 rounded-md border border-line bg-white px-2 text-right text-base tabular-nums focus-visible:outline-2 focus-visible:outline-ai disabled:bg-muted" />
        </label>)}
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="mt-4 text-sm text-human">Weights saved. Generate a fresh draft before locking.</p>}
      {editable && <button type="submit" disabled={!changed || saving} className="so-button so-button-outline mt-5 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving weights…" : "Save event weights"}</button>}
    </form>
  </details>;
}
