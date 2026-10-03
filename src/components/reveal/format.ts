import type { PublicReveal } from "./public-reveal";

export type RankedProduct = PublicReveal["predicted"][number] & {
  room: PublicReveal["actual"][number] | null;
  human: PublicReveal["consensus"][number] | null;
};

export function rankedProducts(reveal: PublicReveal): RankedProduct[] {
  const actual = new Map(reveal.actual.map((row) => [row.productId, row]));
  const human = new Map(reveal.consensus.map((row) => [row.productId, row]));
  return reveal.predicted.map((item) => ({
    ...item, room: actual.get(item.productId) ?? null, human: human.get(item.productId) ?? null,
  }));
}

export function isTasted(item: RankedProduct) {
  return !!item.room && item.room.votes > 0 && item.room.rank !== null && item.room.rank > 0;
}

export function byRoomRank(reveal: PublicReveal) {
  return rankedProducts(reveal).sort((a, b) =>
    (isTasted(a) ? a.room!.rank! : Infinity) - (isTasted(b) ? b.room!.rank! : Infinity)
    || a.rank - b.rank
  );
}

export function formatCorrelation(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Not available" : value.toFixed(2);
}

export function formatPValue(value: number | null) {
  if (value === null || value < 0 || value > 1) return "Not available";
  return value < 0.001 ? "p < 0.001" : `p = ${value.toFixed(3)}`;
}

export function formatMean(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

export function formatRank(value: number | null | undefined) {
  return value === null || value === undefined || value < 1 ? "—" : `#${value}`;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" :
    `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date)} UTC`;
}

export function brandKey(value: string) {
  return value.trim().toLocaleLowerCase("en");
}
