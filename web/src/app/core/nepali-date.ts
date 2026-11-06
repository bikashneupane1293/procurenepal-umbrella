// Bikram Sambat (BS) ⇄ AD date helpers — © Cuidado Technology Pvt. Ltd.
// Uses the MIT-licensed "nepali-date-converter" package (official month-length tables).
// Dates are stored in the database as AD (ISO); BS is shown and accepted in the UI.
import NepaliDate from 'nepali-date-converter';

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' (AD) or Date → 'YYYY/MM/DD' (BS). Empty string if invalid. */
export function adToBs(ad: string | Date | null | undefined): string {
  if (!ad) return '';
  const s = typeof ad === 'string' ? ad.slice(0, 10) : '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : ad instanceof Date ? ad : null;
  if (!d || isNaN(d.getTime())) return '';
  try {
    const nd = NepaliDate.fromAD(d);
    return `${nd.getYear()}/${pad(nd.getMonth() + 1)}/${pad(nd.getDate())}`;
  } catch {
    return '';
  }
}

/** 'YYYY/MM/DD' or 'YYYY-MM-DD' (BS) → 'YYYY-MM-DD' (AD). Empty string if invalid. */
export function bsToAd(bs: string | null | undefined): string {
  const m = String(bs ?? '').trim().match(/^(\d{4})[/\-. ](\d{1,2})[/\-. ](\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 32) return '';
  try {
    const nd = new NepaliDate(y, mo - 1, d);
    // reject dates that roll over (e.g. 2083/01/32 when the month has 31 days)
    if (nd.getYear() !== y || nd.getMonth() !== mo - 1 || nd.getDate() !== d) return '';
    const js = nd.toJsDate();
    return `${js.getFullYear()}-${pad(js.getMonth() + 1)}-${pad(js.getDate())}`;
  } catch {
    return '';
  }
}

/** Nepali fiscal year (e.g. '2083/84') that contains an AD date. FY starts on Shrawan 1. */
export function fiscalYearOf(ad: string | Date | null | undefined): string {
  const bs = adToBs(ad);
  if (!bs) return '';
  const [y, m] = bs.split('/').map(Number);
  const start = m >= 4 ? y : y - 1; // Shrawan is month 4
  return `${start}/${pad((start + 1) % 100)}`;
}

/** Today in BS, 'YYYY/MM/DD'. */
export function todayBs(): string {
  const d = new Date();
  return adToBs(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

/** Show a stored date as "2083/07/20 BS (06 Nov 2026)". */
export function showBoth(ad: string | null | undefined): string {
  if (!ad) return '—';
  const iso = String(ad).slice(0, 10);
  const bs = adToBs(iso);
  const d = new Date(iso + 'T00:00:00');
  const en = isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return bs ? `${bs} BS (${en})` : en;
}
