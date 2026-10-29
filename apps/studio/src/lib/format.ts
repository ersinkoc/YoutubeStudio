/** Para: $0.0034 / $0.25 / $12.40 / $1,250 */
export function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Süre: 45 sn / 3 dk 20 sn / 1 sa 5 dk */
export function duration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} sn`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} dk ${s % 60} sn` : `${m} dk`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} sa ${m % 60} dk` : `${h} sa`;
}

export function number(n: number): string {
  return Math.round(n).toLocaleString("tr-TR");
}

export function date(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}
