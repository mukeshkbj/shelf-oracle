import { useId } from "react";
import type { PublicReveal } from "./public-reveal";
import { byRoomRank, isTasted } from "./format";

export function RankChart({ reveal, light = false }: { reveal: PublicReveal; light?: boolean }) {
  const titleId = useId();
  const descId = useId();
  const rows = byRoomRank(reveal).filter(isTasted).slice(0, 7);
  if (!rows.length) return <p className="text-sm text-inherit">No tasted products to chart yet.</p>;
  const maxRank = Math.max(1, ...reveal.predicted.map((item) => item.rank), ...reveal.consensus.map((item) => item.rank), ...reveal.actual.filter((item) => item.votes > 0 && item.rank !== null).map((item) => item.rank!));
  const step = maxRank <= 10 ? 1 : Math.ceil((maxRank - 1) / 8);
  const ticks = [...new Set([...Array.from({ length: Math.ceil(maxRank / step) }, (_, i) => 1 + i * step).filter((tick) => tick <= maxRank), maxRank])];
  const y = (rank: number) => 52 + (maxRank === 1 ? 0 : ((rank - 1) / (maxRank - 1)) * 305);

  return (
    <figure>
      <div role="region" aria-label="Three-way rank chart, scroll horizontally for all axes" tabIndex={0} className="max-w-full overflow-x-auto rounded-2xl border border-current/10 p-3 focus-visible:outline-2 focus-visible:outline-emerald-500 sm:p-5">
        <svg viewBox="0 0 900 415" className="min-w-[750px] w-full" role="img" aria-labelledby={titleId} aria-describedby={descId}>
          <title id={titleId}>{`Three-way ranking bump chart: AI prediction, human guess consensus, then actual tasting result. Rank one is at the top; all axes cover ranks one through ${maxRank}.`}</title>
          <desc id={descId}>Each numbered product follows its real positions across the three axes. Where no human consensus rank was recorded for a product, only its AI and room points appear with no connecting line. The complete positions are listed after the chart.</desc>
          <text x="235" y="24" textAnchor="middle" className={`${light ? "fill-violet-800" : "fill-violet-300"} text-[13px] font-semibold`}>AI PREDICTION</text>
          <text x="455" y="24" textAnchor="middle" className={`${light ? "fill-cyan-800" : "fill-cyan-300"} text-[13px] font-semibold`}>HUMAN CONSENSUS</text>
          <text x="675" y="24" textAnchor="middle" className={`${light ? "fill-emerald-800" : "fill-emerald-300"} text-[13px] font-semibold`}>ACTUAL TASTING</text>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1="220" x2="690" y1={y(tick)} y2={y(tick)} className={light ? "stroke-slate-200" : "stroke-slate-700"} strokeDasharray="3 6" />
              <text x="190" y={y(tick) + 4} textAnchor="end" className={light ? "fill-slate-600 text-[12px]" : "fill-slate-300 text-[12px]"}>#{tick}</text>
            </g>
          ))}
          {[235, 455, 675].map((x) => <line key={x} x1={x} x2={x} y1="52" y2="357" className={light ? "stroke-slate-300" : "stroke-slate-600"} />)}
          {rows.map((item, index) => {
            const humanRank = item.human?.rank && item.human.rank > 0 ? item.human.rank : null;
            return (
              <g key={item.productId}>
                <title>{`${item.brand} ${item.name}: AI #${item.rank}, human ${humanRank === null ? "no consensus rank" : `#${humanRank}`}, actual #${item.room!.rank}, ${item.room!.votes} ratings`}</title>
                {humanRank !== null && <polyline points={`235,${y(item.rank)} 455,${y(humanRank)} 675,${y(item.room!.rank!)}`} fill="none" className={light ? "stroke-slate-500" : "stroke-slate-300"} strokeWidth="2" />}
                <circle cx="235" cy={y(item.rank)} r="11" className="fill-violet-700" />
                {humanRank !== null && <circle cx="455" cy={y(humanRank)} r="11" className="fill-cyan-700" />}
                <circle cx="675" cy={y(item.room!.rank!)} r="11" className="fill-emerald-500" />
                <text x="235" y={y(item.rank) + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">{index + 1}</text>
                {humanRank !== null && <text x="455" y={y(humanRank) + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">{index + 1}</text>}
                <text x="675" y={y(item.room!.rank!) + 4} textAnchor="middle" className="fill-slate-950 text-[11px] font-bold">{index + 1}</text>
              </g>
            );
          })}
          <text x="455" y="403" textAnchor="middle" className={light ? "fill-slate-600 text-[12px]" : "fill-slate-300 text-[12px]"}>RANK ON EACH AXIS · #1 = HIGHEST</text>
        </svg>
      </div>
      <figcaption className={light ? "mt-3 text-sm text-slate-600" : "mt-3 text-sm text-slate-300"}>
        Showing the {rows.length} highest-ranked tasted products across AI, ordered human top-five guess consensus, and actual adjusted tasting rank. All axes use the same rank scale (#1–#{maxRank}); a product without a human consensus rank has no human point or connecting line. Scroll horizontally on small screens.
      </figcaption>
      <ol className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map((item, index) => (
          <li key={item.productId} className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 font-mono tabular-nums">{index + 1}.</span>
            <span className="min-w-0 break-words"><strong>{item.brand}</strong> · {item.name} <span className={light ? "text-slate-600" : "text-slate-300"}>({`AI #${item.rank} → human ${item.human?.rank && item.human.rank > 0 ? `#${item.human.rank}` : "— (no consensus rank)"} → actual #${item.room!.rank}`})</span></span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function AttributionChart({ reveal, light = false }: { reveal: PublicReveal; light?: boolean }) {
  const titleId = useId();
  const rows = reveal.attribution;
  if (!rows.length) return <p>No principle comparison was available for this event.</p>;
  const height = Math.max(140, rows.length * 40 + 65);
  const x = (r: number) => 390 + r * 230;
  return (
    <figure>
      <div className="overflow-x-auto rounded-2xl border border-current/10 p-3 sm:p-5">
        <svg viewBox={`0 0 760 ${height}`} className="min-w-[560px] w-full" role="img" aria-labelledby={titleId}>
          <title id={titleId}>Observed correlation between model principle scores and product ratings, on a scale from minus one to plus one. The midpoint is zero.</title>
          {[-1, 0, 1].map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1="32" y2={height - 31} className={light ? "stroke-slate-300" : "stroke-slate-600"} strokeDasharray={tick === 0 ? undefined : "3 5"} />
              <text x={x(tick)} y={height - 10} textAnchor="middle" className={light ? "fill-slate-600 text-[13px]" : "fill-slate-300 text-[13px]"}>{tick > 0 ? `+${tick}` : tick}</text>
            </g>
          ))}
          {rows.map((entry, index) => {
            const value = entry.voted >= -1 && entry.voted <= 1 ? entry.voted : null;
            const y = 52 + index * 40;
            return (
              <g key={`${entry.principle}-${index}`}>
                <title>{`${entry.principle}: ${value === null ? "correlation unavailable" : `r = ${entry.voted.toFixed(2)}`}; model weight ${entry.weight}`}</title>
                <text x="210" y={y + 4} textAnchor="end" className={light ? "fill-slate-700 text-[13px]" : "fill-slate-200 text-[13px]"}>{entry.principle.length > 25 ? `${entry.principle.slice(0, 22)}…` : entry.principle}</text>
                {value !== null && <>
                  <line x1={Math.min(x(0), x(value))} x2={Math.max(x(0), x(value))} y1={y} y2={y} className="stroke-emerald-500" strokeWidth="8" strokeLinecap="round" />
                  <circle cx={x(value)} cy={y} r="7" className="fill-emerald-500" />
                </>}
                <text x="644" y={y + 4} className={light ? "fill-slate-700 text-[13px]" : "fill-slate-200 text-[13px]"}>{value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className={light ? "mt-3 text-sm text-slate-600" : "mt-3 text-sm text-slate-300"}>r is correlation across rated products, not a causal effect. Zero may also mean insufficient or constant input data. Scroll horizontally on small screens.</figcaption>
    </figure>
  );
}
