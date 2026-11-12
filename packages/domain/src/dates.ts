/** Date helpers on ISO date strings (YYYY-MM-DD) treated as calendar days, timezone-free. */
const DAY = 86_400_000;

export const toUtcDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Whole days from a to b (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((toUtcDay(b) - toUtcDay(a)) / DAY);

export function addDays(iso: string, n: number): string {
  return new Date(toUtcDay(iso) + n * DAY).toISOString().slice(0, 10);
}

/** Resolve an MM-DD window boundary in a given season year. */
export const seasonDate = (year: number, mmdd: string) => `${year}-${mmdd}`;

export const isoDay = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Asia/Kolkata (UTC+5:30, no DST) local date of a UTC instant. */
export function istDay(utc: string | Date): string {
  const t = (typeof utc === 'string' ? Date.parse(utc) : utc.getTime()) + 5.5 * 3_600_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function istHour(utc: string | Date): number {
  const t = (typeof utc === 'string' ? Date.parse(utc) : utc.getTime()) + 5.5 * 3_600_000;
  return new Date(t).getUTCHours();
}
