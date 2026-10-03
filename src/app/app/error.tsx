"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="so-app-content"><div className="so-panel so-empty" role="alert"><span className="so-empty-icon" aria-hidden="true">!</span><h1>We couldn&apos;t load this page.</h1><p>{error.message || "Please check your connection and try again."}</p><div className="so-inline-actions" style={{ justifyContent: "center" }}><button className="so-button so-button-dark" type="button" onClick={reset}>Try again</button><Link href="/app" className="so-button so-button-outline">All events</Link></div></div></main>;
}
