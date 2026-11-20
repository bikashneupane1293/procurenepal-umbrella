// Reads the qualification requirements out of a Nepali bidding document's TEXT (Task 13).
// Works on the IFB, the Bid Data Sheet and Section III (Evaluation and Qualification Criteria),
// including the column-interleaved text that EQC tables turn into when a PDF is read as lines.
// Pure functions (no browser) — tested in Node against a real document. Every row is a
// suggestion: it is saved with needsVerification = true until a person confirms it.
// © Cuidado Technology Pvt. Ltd.

export type RequirementKind =
  | 'TURNOVER' | 'SIMILAR_CONTRACT' | 'KEY_ACTIVITY' | 'GENERAL_EXPERIENCE' | 'FINANCIAL_RESOURCES'
  | 'BID_CAPACITY' | 'PERSONNEL' | 'EQUIPMENT' | 'COMPLETION_PERIOD' | 'BID_SECURITY'
  | 'BID_VALIDITY' | 'PRICE_ADJUSTMENT';

export interface FoundRequirement {
  kind: RequirementKind;
  label: string;
  data: Record<string, any>;
  /** The document text the value was read from (whitespace collapsed). */
  sourceText: string;
  /** 0–1: how sure the reader is. Raised when the IFB, BDS and EQC agree; lowered when they don't. */
  confidence: number;
  /** Plain-language note, e.g. "IFB and EQC agree" or "the document gives two different amounts". */
  note?: string;
}

export const KIND_LABEL: Record<RequirementKind, string> = {
  TURNOVER: 'Average annual turnover',
  SIMILAR_CONTRACT: 'Similar contract',
  KEY_ACTIVITY: 'Key activity',
  GENERAL_EXPERIENCE: 'General experience',
  FINANCIAL_RESOURCES: 'Financial resources (cash flow)',
  BID_CAPACITY: 'Bid capacity',
  PERSONNEL: 'Key personnel',
  EQUIPMENT: 'Key equipment',
  COMPLETION_PERIOD: 'Completion period',
  BID_SECURITY: 'Bid security',
  BID_VALIDITY: 'Bid validity',
  PRICE_ADJUSTMENT: 'Price adjustment',
};

// ---------------------------------------------------------------- small helpers
const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90,
};
const NUM_WORD = String.raw`(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|sixty|ninety)`;
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()] ?? NaN);
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 220) => { const f = flat(s); return f.length > n ? f.slice(0, n - 1) + '…' : f; };

const UNIT_MULT: Record<string, number> = { crore: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, million: 1e6, mn: 1e6, billion: 1e9, arba: 1e9 };
const mult = (u: string) => UNIT_MULT[u.toLowerCase().replace(/\.$/, '')] ?? 1;

/** "Rs 1,23,45,678.50" → "1,23,45,678.50" grouping in lakh/crore style, for labels. */
export function npr(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const body = rest ? rest + ',' + last3 : last3;
  return 'Rs ' + body + (dec !== '00' ? '.' + dec : '');
}

/**
 * Every money amount in a (flattened) piece of text, in rupees.
 *  - "NRs 85.50 million", "NRs. 4 Million", "Rs. 55,25,00,000", "63 crore", "a minimum of 4 million"
 *  - "NRs. 130.00 Form FIN of the of the million" — EQC tables push the unit a few cells away;
 *    a small number followed (without other digits in between) by million/crore/lakh within six
 *    words takes that unit.
 * Bare amounts under 1 lakh without a unit are ignored (fees, page numbers, form numbers).
 */
export function moneyAmounts(text: string): { amount: number; at: number; raw: string }[] {
  const out: { amount: number; at: number; raw: string }[] = [];
  const re = /(?:\b(N\.?\s?Rs\.?|NPR|Rs\.?)\s*:?\s*)?(?<![\d.,])(\d[\d,]*(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [raw, cur, n] = m;
    const value = Number(n.replace(/,/g, ''));
    if (!isFinite(value) || !value) continue;
    const after = text.slice(m.index + raw.length, m.index + raw.length + 70);
    const direct = after.match(/^\s*(crore|cr\.|lakhs?|lacs?|million|mn|billion|arba)\b/i);
    const delayed = after.match(/^((?:\s+[^\d\s]+){1,6}?)\s+(crore|lakhs?|lacs?|million)\b/i);
    let amount: number | null = null;
    let shown = raw;
    if (direct) { amount = value * mult(direct[1]); shown = raw + direct[0]; }
    else if (cur && value < 1e5 && delayed) { amount = value * mult(delayed[2]); shown = raw + ' ' + delayed[2]; }
    else if (cur && value >= 1e5) amount = value;
    if (amount == null || amount < 1e5) continue;
    out.push({ amount: Math.round(amount * 100) / 100, at: m.index, raw: flat(shown) });
  }
  return out;
}

/** Lines that start a new clause/heading/bullet — a requirement's text stops there. */
const STOP_LINE = /^\s*(?:[•▪●■]|\d{1,2}(?:\.\d{1,2})*\.?\s+(?!(?:metric|cubic|square|running|tons?|tonnes?|MT|m3|m2|kg|km|nos?|numbers?|met(?:er|re)s?|million|crore|lakhs?|years?|months?|days?|percent)\b)[A-Z(]|\(?[a-h]\)\s+[A-Z]|ITB\s+\d|Page\s*\|)/i;

interface Window { text: string; at: number; anchor: string; }

/**
 * The text that follows each mention of `anchor`, up to the next clause/heading line
 * (or maxChars). Mentions that fall inside the previous window are skipped, so one clause
 * is never counted twice.
 */
export function windows(text: string, anchor: RegExp, maxChars = 900, minLines = 0): Window[] {
  const out: Window[] = [];
  const re = new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g');
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index < lastEnd) continue;
    const lineEnd = text.indexOf('\n', m.index);
    let end = lineEnd < 0 ? text.length : lineEnd;
    let lines = 0;
    while (end < text.length && end - m.index < maxChars) {
      const next = text.indexOf('\n', end + 1);
      const line = text.slice(end + 1, next < 0 ? text.length : next);
      if (lines >= minLines && STOP_LINE.test(line)) break;
      // the same heading starting again = a new mention; it gets its own window
      const again = line.search(new RegExp(anchor.source, anchor.flags.replace('g', '')));
      if (again >= 0 && again < 12) break;
      end = next < 0 ? text.length : next;
      lines++;
    }
    const w = text.slice(m.index, Math.min(end, m.index + maxChars));
    out.push({ text: flat(w), at: m.index, anchor: m[0] });
    lastEnd = m.index + w.length;
  }
  return out;
}

interface Candidate<T> { value: T; key: string; source: string; strong: boolean; }

/** Pick the value most mentions agree on; confidence grows with agreement, drops on conflict. */
function vote<T>(cands: Candidate<T>[]): { value: T; source: string; confidence: number; note?: string } | null {
  if (!cands.length) return null;
  const groups = new Map<string, Candidate<T>[]>();
  for (const c of cands) groups.set(c.key, [...(groups.get(c.key) ?? []), c]);
  const ranked = [...groups.values()].sort((a, b) =>
    (b.filter((c) => c.strong).length - a.filter((c) => c.strong).length) || (b.length - a.length));
  const best = ranked[0];
  const agree = best.length;
  let confidence = Math.min(0.95, 0.65 + 0.15 * (agree - 1) + (best.some((c) => c.strong) ? 0.05 : 0));
  let note = agree > 1 ? `Found ${agree} times in the document, all the same.` : 'Found once in the document.';
  if (ranked.length > 1) {
    confidence = Math.max(0.3, confidence - 0.3);
    note = `The document gives different values (${ranked.map((g) => g[0].key).join(' / ')}) — check which applies.`;
  }
  const src = best.find((c) => c.strong) ?? best[0];
  return { value: src.value, source: src.source, confidence: Math.round(confidence * 100) / 100, note };
}

// ---------------------------------------------------------------- money requirements
function moneyRequirement(text: string, anchor: RegExp, opts: { maxChars?: number; near?: RegExp } = {}): Candidate<number>[] {
  const cands: Candidate<number>[] = [];
  for (const w of windows(text, anchor, opts.maxChars ?? 700)) {
    let body = w.text;
    if (opts.near) {
      const n = body.search(opts.near);
      if (n > 0) body = body.slice(n);
    }
    const a = moneyAmounts(body)[0];
    if (!a) continue;
    cands.push({
      value: a.amount, key: npr(a.amount), source: clip(body.slice(0, Math.max(a.at + a.raw.length + 10, 120))),
      strong: /^\d+\.\d+(\.\d+)*\s/.test(w.text) || /^\s*\d/.test(text.slice(Math.max(0, text.lastIndexOf('\n', w.at) + 1), w.at)),
    });
  }
  return cands;
}

function bestOutOf(text: string): { bestYears?: number; lookbackYears?: number } {
  const m = text.match(new RegExp(String.raw`best\s+${NUM_WORD}\s*(?:\(\s*\d+\s*\))?\s*(?:fiscal\s+|financial\s+)?years?\s+(?:out\s+of|within|in|of)\s+(?:the\s+)?(?:last|past|preceding)\s+${NUM_WORD}`, 'i'));
  return m ? { bestYears: num(m[1]), lookbackYears: num(m[2]) } : {};
}

function turnover(text: string): FoundRequirement | null {
  const cands = moneyRequirement(text, /average annual (?:construction )?turnover/i, { maxChars: 900 });
  const v = vote(cands);
  if (!v) return null;
  // best N of last M years: look around every mention, prefer the one next to the chosen amount
  let years: { bestYears?: number; lookbackYears?: number } = {};
  for (const w of windows(text, /average annual (?:construction )?turnover/i, 900)) {
    years = bestOutOf(w.text);
    if (years.bestYears) break;
  }
  const data = { amountNPR: v.value, ...years };
  const yrs = years.bestYears ? ` (best ${years.bestYears} of the last ${years.lookbackYears} years)` : '';
  return { kind: 'TURNOVER', label: `Average annual construction turnover ≥ ${npr(v.value)}${yrs}`, data, sourceText: v.source, confidence: v.confidence, note: v.note };
}

function similarContract(text: string): FoundRequirement | null {
  const anchor = /(?:contracts?|work experience|works?) of similar (?:size|nature)|similar size and nature/i;
  const ws = windows(text, anchor, 1500);
  const cands: Candidate<number>[] = [];
  let count: number | undefined, lookback: number | undefined, partner: number | undefined, description: string | undefined;
  for (const w of ws) {
    const amounts = moneyAmounts(w.text);
    if (!amounts.length) continue;
    const first = amounts[0];
    cands.push({ value: first.amount, key: npr(first.amount), source: clip(w.text.slice(0, Math.max(160, first.at + 40))), strong: /^\(?a\)?\s|^Contracts? of Similar/i.test(w.text) || amounts.length > 1 });
    // a smaller amount in the same EQC row = "each partner" requirement for a JV
    const smaller = amounts.find((a) => a.amount < first.amount);
    if (smaller && partner == null) partner = smaller.amount;
    const c = w.text.match(new RegExp(String.raw`at least\s+${NUM_WORD}\s*(?:\(\s*\d+\s*\))?\s*(?:similar\s+)?contracts?`, 'i'))
      ?? w.text.match(new RegExp(String.raw`at least\s+${NUM_WORD}\b`, 'i'));
    if (c && count == null) count = num(c[1]);
    const y = w.text.match(new RegExp(String.raw`(?:last|past)\s+${NUM_WORD}\s*(?:\(\s*\d+\s*\)\)?)?\s*(?:fiscal\s+)?years`, 'i'));
    if (y && lookback == null) lookback = num(y[1]);
    const d = w.text.match(/Construction of at least .{5,120}?(?=\s+(?:of value|of NRs|of Rs|with a value|having)|\.|$)/i);
    if (d && !description) description = d[0].trim();
  }
  const v = vote(cands);
  if (!v) return null;
  const data: Record<string, any> = { amountNPR: v.value, count: count ?? 1 };
  if (lookback) data['lookbackYears'] = lookback;
  if (partner) data['partnerAmountNPR'] = partner;
  if (description) data['description'] = description;
  const label = `At least ${data['count']} similar contract${data['count'] > 1 ? 's' : ''} of ≥ ${npr(v.value)}` +
    (lookback ? ` in the last ${lookback} years` : '') + (partner ? ` (each JV partner ≥ ${npr(partner)})` : '');
  return { kind: 'SIMILAR_CONTRACT', label, data, sourceText: v.source, confidence: v.confidence, note: v.note };
}

function simpleMoney(text: string, kind: RequirementKind, anchor: RegExp, label: (n: number) => string, near?: RegExp, maxChars = 700): FoundRequirement | null {
  const v = vote(moneyRequirement(text, anchor, { near, maxChars }));
  if (!v) return null;
  return { kind, label: label(v.value), data: { amountNPR: v.value }, sourceText: v.source, confidence: v.confidence, note: v.note };
}

function bidSecurity(text: string): FoundRequirement | null {
  const anchor = /\bbid security\b|\bbid bond\b|\bearnest money\b/i;
  const cands: Candidate<number>[] = [];
  let beyond: number | undefined;
  for (const w of windows(text, anchor, 500)) {
    const a = moneyAmounts(w.text)[0];
    if (!a) continue;
    cands.push({ value: a.amount, key: npr(a.amount), source: clip(w.text), strong: /ITB\s*19/i.test(text.slice(Math.max(0, w.at - 120), w.at)) });
    const b = w.text.match(/valid for\s+(?:a period of\s+)?(\d+)\s*(?:\(\s*\w+\s*\)\s*)?days beyond/i);
    if (b && beyond == null) beyond = Number(b[1]);
  }
  const v = vote(cands);
  if (!v) return null;
  const data: Record<string, any> = { amountNPR: v.value };
  if (beyond != null) data['validBeyondDays'] = beyond;
  return { kind: 'BID_SECURITY', label: `Bid security ≥ ${npr(v.value)}` + (beyond != null ? `, valid ${beyond} days beyond bid validity` : ''), data, sourceText: v.source, confidence: v.confidence, note: v.note };
}

// ---------------------------------------------------------------- periods and yes/no
function bidValidity(text: string): FoundRequirement | null {
  const cands: Candidate<number>[] = [];
  const anchor = /bid validity period|\bbids? (?:must|shall|will) (?:be|remain) valid|validity of (?:the )?bids?/i;
  for (const w of windows(text, anchor, 220)) {
    const m = w.text.match(new RegExp(String.raw`(?:${NUM_WORD}\s*)?\(?\s*(\d+)\s*\)?\s*days`, 'i'));
    if (!m || /beyond/i.test(w.text.slice(0, (m.index ?? 0) + m[0].length + 8).slice(-40))) continue;
    const d = Number(m[2]);
    cands.push({ value: d, key: `${d} days`, source: clip(w.text, 160), strong: /ITB\s*18/i.test(text.slice(Math.max(0, w.at - 40), w.at)) });
  }
  const v = vote(cands);
  if (!v) return null;
  return { kind: 'BID_VALIDITY', label: `Bids valid for ${v.value} days`, data: { days: v.value }, sourceText: v.source, confidence: v.confidence, note: v.note };
}

function completionPeriod(text: string): FoundRequirement | null {
  const cands: Candidate<{ n: number; unit: string }>[] = [];
  const anchor = /intended completion (?:date|period)|time for completion|completion period|contract period|construction period|period of completion/i;
  for (const w of windows(text, anchor, 260)) {
    const m = w.text.match(/\(?\s*(\d+)\s*\)?\s*(?:\([A-Za-z\s-]+\)\s*)?(calendar\s+)?(months?|days?|years?)\b/i);
    if (!m || +m[1] === 0) continue;
    // ignore "within 28 days" style procedure deadlines
    if (/days?/i.test(m[3]) && +m[1] < 60) continue;
    const unit = m[3].toLowerCase().replace(/s$/, '');
    cands.push({ value: { n: +m[1], unit }, key: `${m[1]} ${unit}s`, source: clip(w.text, 160), strong: /SCC|GCC|BDS|ITB/i.test(text.slice(Math.max(0, w.at - 40), w.at)) });
  }
  const v = vote(cands);
  if (!v) return null;
  const { n, unit } = v.value;
  const months = unit === 'month' ? n : unit === 'year' ? n * 12 : Math.max(1, Math.round(n / 30));
  return { kind: 'COMPLETION_PERIOD', label: `Complete within ${n} ${unit}${n > 1 ? 's' : ''}`, data: { value: n, unit, months }, sourceText: v.source, confidence: v.confidence, note: v.note };
}

function priceAdjustment(text: string): FoundRequirement | null {
  const re = /(shall not be|will not be|shall be|will be)["'“”‘’\s]*subject to (?:price )?adjustment/gi;
  const cands: Candidate<boolean>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const applies = !/not/i.test(m[1]);
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    // the BDS entry ("ITB 14.6 …") is the one that decides; generic ITB text only says "if specified"
    const strong = /ITB\s*14|BDS/i.test(before);
    const after = text.slice(m.index, m.index + 160);
    if (!strong && /if (?:so )?(?:specified|provided)/i.test(after)) continue;
    cands.push({ value: applies, key: applies ? 'applies' : 'does not apply', source: clip(before.split('\n').pop() + after, 180), strong });
  }
  const v = vote(cands);
  if (!v) return null;
  return { kind: 'PRICE_ADJUSTMENT', label: v.value ? 'Prices are subject to adjustment (submit the price adjustment data table)' : 'Prices are fixed (no price adjustment)', data: { applies: v.value }, sourceText: v.source, confidence: v.confidence, note: v.note };
}

function generalExperience(text: string): FoundRequirement | null {
  const cands: Candidate<number>[] = [];
  for (const w of windows(text, /general (?:construction )?experience/i, 700)) {
    const m = w.text.match(new RegExp(String.raw`(?:for\s+)?at least\s+(?:the\s+)?(?:last\s+)?${NUM_WORD}\s*(?:\(\s*\w+\s*\))?\s*years`, 'i'));
    if (!m) continue;
    const y = num(m[1]);
    if (!y) continue;
    cands.push({ value: y, key: `${y} years`, source: clip(w.text.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + m[0].length + 40)), strong: true });
  }
  const v = vote(cands);
  if (!v) return null;
  return { kind: 'GENERAL_EXPERIENCE', label: `At least ${v.value} years of construction experience`, data: { years: v.value }, sourceText: v.source, confidence: v.confidence, note: v.note };
}

// ---------------------------------------------------------------- key activities
const ACT_UNIT = String.raw`(metric\s+tons?|metric\s+tonnes?|MT|tons?|tonnes?|cubic\s+met(?:er|re)s?|cu\.?\s?m\.?|cum|m3|m³|square\s+met(?:er|re)s?|sq\.?\s?m\.?|sqm|m2|m²|running\s+met(?:er|re)s?|rmt?|kilomet(?:er|re)s?|km|met(?:er|re)s?|nos?\.?|numbers?|kg)`;
const UNIT_NORM: [RegExp, string][] = [
  [/metric|^mt$|^tons?$|^tonnes?$/i, 'MT'], [/cubic|^cu|^cum$|^m3$|^m³$/i, 'm3'], [/square|^sq|^m2$|^m²$/i, 'm2'],
  [/running|^rmt?$/i, 'RM'], [/kilomet|^km$/i, 'km'], [/^met/i, 'm'], [/^nos?\.?$|^numbers?$/i, 'Nos'], [/^kg$/i, 'kg'],
];
const normUnit = (u: string) => (UNIT_NORM.find(([re]) => re.test(u.trim()))?.[1] ?? u.trim());

function keyActivities(text: string): FoundRequirement[] {
  const out: FoundRequirement[] = [];
  const seen = new Set<string>();
  const re = new RegExp(String.raw`([A-Z][A-Za-z0-9\-,&/() ]{2,90}?)\s+(?:of\s+)?(\d[\d,]*(?:\.\d+)?)\s*${ACT_UNIT}\s*(?:(?:per|/|in\s+(?:a|one|any one))\s*(year|annum|month|fiscal year))?`, 'gi');
  for (const w of windows(text, /key activit|construction experience in key|minimum (?:annual )?production rate/i, 2500, 3)) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(w.text))) {
      // the unit words are matched case-insensitively, so start the name at its first capital letter
      const cap = m[1].search(/[A-Z]/);
      const name = (cap > 0 ? m[1].slice(cap) : m[1]).replace(/^.*\bkey activit(?:y|ies)\b[^A-Za-z]*/i, '').split(' ').slice(-10).join(' ').replace(/^(?:(?:the|and|or|of|following|completed|a|key activities?)\b[:\s]*)+/i, '').replace(/\s+(?:of|or|and|with)$/i, '').trim();
      if (name.length < 3 || /^(?:NRs?|Rs|Form|Page|ITB|Section|Contract|Value|Amount|Turnover|Capacity)\b/i.test(name)) continue;
      const quantity = Number(m[2].replace(/,/g, ''));
      if (!quantity) continue;
      const unit = normUnit(m[3]);
      const period = m[4] ? (/month/i.test(m[4]) ? 'month' : 'year') : 'year';
      const key = `${name.toLowerCase()}|${quantity}|${unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'KEY_ACTIVITY', label: `${name}: ${quantity.toLocaleString('en-IN')} ${unit} per ${period}`,
        data: { name, quantity, unit, period }, sourceText: clip(m[0], 200),
        confidence: m[4] ? 0.8 : 0.55, note: m[4] ? undefined : 'No "per year/month" next to the quantity — check the period.',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- personnel and equipment tables
function tableAfter(text: string, heading: RegExp, kind: 'PERSONNEL' | 'EQUIPMENT'): FoundRequirement | null {
  const lines = text.split('\n');
  let best: FoundRequirement | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!heading.test(lines[i].trim())) continue;
    const block = lines.slice(i, i + 40);
    const end = block.findIndex((l, k) => k > 0 && /^\s*Page\s*\|/.test(l));
    const body = end > 0 ? block.slice(0, end) : block;
    // must look like the actual table (a header row), not a mention in running text
    if (!(kind === 'PERSONNEL' ? /position/i : /equipment type|type and characteristics|min(?:imum)?\.? number/i).test(body.join(' '))) continue;
    const numbered = body.filter((l) => /^\s*\d{1,2}\.\s*/.test(l));
    const rows = numbered
      .map((l) => l.replace(/^\s*\d{1,2}\.\s*/, '').trim())
      .filter((l) => l.length > 1)
      .map((l) => {
        const m = l.match(/^(.+?)\s+(\d{1,3})(?:\s*(?:nos?\.?|units?|sets?|persons?))?\b(.*)$/i);
        return m ? { name: m[1].trim(), count: Number(m[2]), rest: m[3].trim() } : { name: l, count: null, rest: '' };
      });
    const title = kind === 'PERSONNEL' ? 'Key personnel' : 'Key equipment';
    const found: FoundRequirement = rows.length
      ? { kind, label: `${title}: ${rows.map((r) => (r.count ? `${r.count} × ` : '') + r.name).join('; ')}`, data: { rows, blank: false }, sourceText: clip(body.join(' '), 260), confidence: 0.5, note: 'Table rows read line by line — check every row against the document.' }
      : { kind, label: `${title}: the table is left blank in this document`, data: { rows: [], blank: true }, sourceText: clip(body.join(' '), 260), confidence: 0.85, note: numbered.length ? 'Rows are numbered but empty — nothing is required here, or the Employer forgot to fill it in. Ask the procuring entity if unsure.' : undefined };
    if (!best || (found.data['rows'].length > (best.data['rows'] as any[]).length)) best = found;
  }
  return best;
}

/** Plain-language note about pages that could not be read (scanned) or were not read (very long PDFs). */
export function pdfReadNote(pdf: { pages: number; pagesRead: number; emptyPages: number[] }): string {
  const parts: string[] = [];
  const scannedish = pdf.emptyPages.length;
  if (scannedish && scannedish < pdf.pagesRead) {
    const list = pdf.emptyPages.slice(0, 12).join(', ') + (scannedish > 12 ? ', …' : '');
    parts.push(`${scannedish} of ${pdf.pagesRead} pages have no readable text (scanned or blank: page ${list}) — values printed only on those pages can't be read.`);
  }
  if (pdf.pagesRead < pdf.pages) parts.push(`Only the first ${pdf.pagesRead} of ${pdf.pages} pages were read.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- entry point
/** All requirements found in the document text, in a fixed order. Nothing found → empty array. */
export function extractRequirements(text: string): FoundRequirement[] {
  const t = text.replace(/\r/g, '');
  const rows: (FoundRequirement | null)[] = [
    turnover(t),
    similarContract(t),
    ...keyActivities(t),
    generalExperience(t),
    simpleMoney(t, 'FINANCIAL_RESOURCES', /financial resources|cash[\s-]*flow requirement/i, (n) => `Access to financial resources (cash flow) ≥ ${npr(n)}`, /cash[\s-]*flow|liquid assets|NRs|Rs/i, 1400),
    simpleMoney(t, 'BID_CAPACITY', /(?:required )?bid(?:ding)? capacity/i, (n) => `Bid capacity ≥ ${npr(n)}`, undefined, 700),
    tableAfter(t, /^Personnel Requirements$/i, 'PERSONNEL'),
    tableAfter(t, /^Equipment Requirements$/i, 'EQUIPMENT'),
    completionPeriod(t),
    bidSecurity(t),
    bidValidity(t),
    priceAdjustment(t),
  ];
  return rows.filter((r): r is FoundRequirement => !!r);
}
