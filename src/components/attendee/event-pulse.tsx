"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventStatus } from "@/lib/types";

type PublicStatus = {
  event: {
    slug: string;
    name: string;
    location: string | null;
    status: EventStatus;
    lockedAt: string | null;
    lockHash: string | null;
  };
  voteCount: number;
};

const phase: Record<EventStatus, string> = {
  setup: "Preparing the shelf",
  intake: "Stocking the shelf",
  locked: "Voting closed · reveal pending",
  voting: "Tasting now",
  revealed: "Results revealed",
  closed: "Event complete",
};

export function EventPulse({ initial }: { initial: PublicStatus }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/e/${encodeURIComponent(initial.event.slug)}/status`, { cache: "no-store" });
        if (response.ok && active) setData(await response.json() as PublicStatus);
      } catch {
        return;
      }
    };
    const timer = window.setInterval(refresh, 12000);
    return () => { active = false; window.clearInterval(timer); };
  }, [initial.event.slug]);

  const { event, voteCount } = data;
  const open = event.status === "voting";
  const revealed = event.status === "revealed" || event.status === "closed";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${open ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-200"}`}>
          {phase[event.status]}
        </span>
        {event.location && <span className="text-sm text-slate-300">{event.location}</span>}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Tasting panel</p>
        <h1 className="mt-3 max-w-4xl text-5xl font-semibold tracking-tight sm:text-7xl">{event.name}</h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
          {open ? "Taste the range and build your own shelf. Your ratings stay yours until the reveal." : revealed ? "The tasting is over. See how the room compared with the locked prediction." : "The room is getting ready. Check back when tasting opens."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
          <p className="text-sm text-slate-300">Ratings submitted</p>
          <p className="mt-2 font-mono text-6xl font-semibold tabular-nums text-emerald-300" aria-label={`${voteCount} ratings submitted`}>{voteCount}</p>
          <p className="mt-2 text-xs text-slate-400">Individual product ratings · updates every 12 seconds</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
          <p className="text-sm text-slate-300">Prediction proof</p>
          {event.lockHash ? (
            <>
              <p className="mt-3 break-all font-mono text-xl text-amber-300">{event.lockHash.slice(0, 12)}</p>
              <details className="mt-2 text-xs text-slate-300"><summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-300">View full SHA-256 fingerprint</summary><code className="mt-2 block break-all text-amber-200">{event.lockHash}</code></details>
              {event.lockedAt && <p className="mt-3 text-sm text-slate-300">Locked <time dateTime={event.lockedAt}>{new Date(event.lockedAt).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</time></p>}
            </>
          ) : <p className="mt-4 text-sm text-slate-300">The prediction has not been locked yet.</p>}
          <p className="mt-3 text-xs text-slate-400">The forecast and room results remain hidden until reveal.</p>
        </div>
      </div>
      {revealed && <Link href={`/e/${encodeURIComponent(event.slug)}/reveal`} className="inline-flex min-h-11 items-center rounded-xl bg-violet-500 px-6 font-semibold text-white hover:bg-violet-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400">See the reveal</Link>}
    </div>
  );
}
