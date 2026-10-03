import Link from "next/link";

export function Brand({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <Link href="/" className={`so-brand ${inverse ? "so-brand-inverse" : ""}`} aria-label="Shelf Oracle home">
      <span className="so-brand-symbol" aria-hidden="true"><span /><span /><span /></span>
      {!compact && <span className="so-brand-name">shelf<span>oracle</span><span className="so-brand-period">.</span></span>}
    </Link>
  );
}
