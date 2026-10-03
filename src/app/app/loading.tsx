export default function Loading() {
  return <main className="so-app-content" role="status" aria-label="Loading workspace"><div className="so-kicker">SHELF ORACLE / LOADING</div><div className="so-page-header"><div><h1>Getting your workspace ready<span aria-hidden="true">…</span></h1><p>Your event history will be here in a moment.</p></div><span className="so-spinner" /></div><div className="so-stats">{[1,2,3,4].map(i => <div className="so-panel so-stat" key={i} style={{ minHeight: 105 }} />)}</div></main>;
}
