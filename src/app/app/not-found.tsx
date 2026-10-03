import Link from "next/link";

export default function NotFound() {
  return <main className="so-app-content"><div className="so-panel so-empty"><span className="so-empty-icon" aria-hidden="true">?</span><h1>Event not found.</h1><p>It may have been moved, or this workspace doesn&apos;t have access to it.</p><Link href="/app" className="so-button so-button-dark">Back to events →</Link></div></main>;
}
