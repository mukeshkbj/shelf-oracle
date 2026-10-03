"use client";

import { useState } from "react";

export default function CopyReportLink() {
  const [message, setMessage] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("Report link copied");
    } catch {
      setMessage("Copy the URL from your address bar");
    }
  }

  return <span className="inline-flex flex-col gap-1"><button type="button" onClick={copy} className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-900 hover:border-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">Copy report link</button><span role="status" className="min-h-5 text-xs text-slate-600">{message}</span></span>;
}
