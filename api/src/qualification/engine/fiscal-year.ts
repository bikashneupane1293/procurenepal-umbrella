// =====================================================================
// Nepali fiscal year helpers (FY starts on Shrawan 1 ≈ 16/17 July AD)
// © Cuidado Technology Pvt. Ltd.
// =====================================================================

/** "2081/82" → 2081. Returns null for anything that is not a fiscal year. */
export function fyStart(fy: string | null | undefined): number | null {
  if (!fy) return null;
  const m = String(fy).trim().match(/^(\d{4})\s*[/-]\s*(\d{2,4})$/);
  if (!m) return null;
  const start = Number(m[1]);
  return start >= 2000 && start <= 2200 ? start : null;
}

/** 2081 → "2081/82" */
export function fyLabel(start: number): string {
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Fiscal year (BS start year) that contains an AD date.
 * Approximation: the FY changes on 16 July AD (Shrawan 1 is 16 or 17 July).
 */
export function fyStartForDate(d: Date): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const afterShrawan = m > 7 || (m === 7 && day >= 16);
  return afterShrawan ? y + 57 : y + 56;
}

/** Whole months between two dates (b − a), never negative. */
export function monthsBetween(a: Date, b: Date): number {
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) +
    (b.getUTCDate() - a.getUTCDate()) / 30;
  return Math.max(0, months);
}

/** Normalise an activity name for matching: lower-case, letters/digits only. */
export function normName(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const UNIT_ALIASES: Record<string, string> = {
  m3: 'm3', cum: 'm3', cumt: 'm3', cubicmeter: 'm3', cubicmetre: 'm3', cu: 'm3',
  m2: 'm2', sqm: 'm2', sqmt: 'm2', squaremeter: 'm2', squaremetre: 'm2',
  m: 'm', rm: 'm', rmt: 'm', mtr: 'm', meter: 'm', metre: 'm', lm: 'm',
  km: 'km', kilometer: 'km', kilometre: 'km',
  mt: 't', t: 't', ton: 't', tons: 't', tonne: 't', tonnes: 't', mton: 't',
  kg: 'kg', kgs: 'kg', kilogram: 'kg',
  no: 'nos', nos: 'nos', number: 'nos', numbers: 'nos', pcs: 'nos', each: 'nos', ea: 'nos',
  l: 'l', ltr: 'l', litre: 'l', liter: 'l',
};

/** Normalise a unit: "Cu.m", "cum", "m³" → "m3"; "MT", "ton" → "t". */
export function normUnit(u: string | null | undefined): string {
  const raw = String(u ?? '')
    .toLowerCase()
    .replace(/³/g, '3')
    .replace(/²/g, '2')
    .replace(/[^a-z0-9]/g, '');
  return UNIT_ALIASES[raw] ?? raw;
}

/** Two activity names match if one contains the other (after normalising). */
export function activityMatches(required: string, candidate: string): boolean {
  const a = normName(required);
  const b = normName(candidate);
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
}
