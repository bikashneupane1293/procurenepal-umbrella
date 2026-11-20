// Same as api/src/common/nepal-time.ts — keep the two in step.
// Nepal Time (NPT, UTC+05:45, no daylight saving) — every "today", date limit and day count in
// ProcureNepal follows Nepal's calendar day, not UTC's (which lags by 5h45m: between 00:00 and
// 05:45 NPT, UTC is still "yesterday"). © Cuidado Technology Pvt. Ltd.
export const NPT_OFFSET_MINUTES = 345;
const OFFSET_MS = NPT_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

/** The Nepal calendar date (YYYY-MM-DD) of an instant. Date-only values stored as UTC midnight keep their date. */
export function nptDate(d: Date | string | number = new Date()): string {
  return new Date(new Date(d).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's date in Nepal (YYYY-MM-DD). */
export const nptToday = (now: Date = new Date()) => nptDate(now);

/** The last instant of a Nepal calendar day (23:59:59.999 NPT) — "valid until <date>" means through this moment. */
export function endOfNptDay(ymd: string): Date {
  return new Date(Date.parse(ymd.slice(0, 10) + 'T23:59:59.999Z') - OFFSET_MS);
}

/** Nepal date `days` days after `ymd`. */
export function addNptDays(ymd: string, days: number): string {
  return new Date(Date.parse(ymd.slice(0, 10) + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole Nepal calendar days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function nptDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS);
}

/** Readable Nepal timestamp, e.g. "2026-11-20 00:54 NPT". */
export function nptStamp(d: Date = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' NPT';
}
