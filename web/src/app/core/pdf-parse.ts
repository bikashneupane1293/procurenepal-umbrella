// Reads tender notices (IFB) and experience certificates from PDF TEXT and suggests form values.
// Pure functions (no browser) — tested in Node. Every value is a suggestion the user reviews.
// © Cuidado Technology Pvt. Ltd.
import { bsToAd, fiscalYearOf } from './nepali-date';

export interface Found<T = any> { value: T; line: string; }
export type Suggestions = Record<string, Found>;
export interface FoundActivity { name: string; unit: string; quantity: number; line: string; }

// ---------------------------------------------------------------- numbers & dates
/** "NRs. 55,25,00,000.00" → 552500000 · "63 crore" → 630000000 · "5.5 lakh" → 550000 */
export function parseAmount(s: string): number | null {
  const m = String(s).match(/([\d][\d,]*(?:\.\d+)?)\s*(crore|cr\.?|lakhs?|lacs?|million|mn)?\b/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit.startsWith('cr')) n *= 1e7;
  else if (unit.startsWith('la')) n *= 1e5;
  else if (unit.startsWith('mi') || unit === 'mn') n *= 1e6;
  return Math.round(n * 100) / 100;
}

/** Money after a label: needs Rs/NRs before it or crore/lakh after it (so "One (1)" is not read as money). */
function moneyIn(text: string): number | null {
  const m =
    text.match(/(?:N?Rs\.?|NPR)\s*:?\s*([\d][\d,]*(?:\.\d+)?\s*(?:crore|cr\.?|lakhs?|lacs?|million)?)/i) ??
    text.match(/([\d][\d,]*(?:\.\d+)?\s*(?:crore|lakhs?|lacs?))\b/i);
  return m ? parseAmount(m[1]) : null;
}

/** First date in text → AD 'YYYY-MM-DD'. BS if the year is 2040 or later. */
export function dateIn(text: string): string | null {
  let m = text.match(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
  if (m) {
    const y = +m[1];
    if (y >= 2040) return bsToAd(`${m[1]}/${m[2]}/${m[3]}`) || null;
    return valid(y, +m[2], +m[3]);
  }
  m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
  if (m) {
    const y = +m[3];
    if (y >= 2040) return bsToAd(`${m[3]}/${m[2]}/${m[1]}`) || null;
    return valid(y, +m[2], +m[1]);
  }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- line helpers
export function toLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
/** First line matching label; returns the line and the text after the label (plus the next line for wrapped values). */
function find(lines: string[], label: RegExp): { line: string; rest: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (m) {
      const rest = lines[i].slice((m.index ?? 0) + m[0].length);
      return { line: lines[i], rest: rest + ' ' + (lines[i + 1] ?? '') };
    }
  }
  return null;
}
const afterColon = (s: string) => s.replace(/^\s*[:\-–.]*\s*/, '').trim();

// ---------------------------------------------------------------- key activities
const UNIT = String.raw`(m3|m³|cum|cu\.?\s?m|m2|m²|sq\.?\s?m|sqm|kg|kgs|mt|ton|tons|tonnes?|nos?\.?|numbers?|km|rm|rmt|ltrs?|l)`;
const ACT_RE = new RegExp(String.raw`^[\s\-•*·\d.)(a-z]{0,6}?\s*([A-Za-z][A-Za-z0-9 &/,()'.\-]*?[A-Za-z0-9)])\s*[:\-–=]?\s*([\d][\d,]*(?:\.\d+)?)\s*${UNIT}\.?\s*$`, 'i');

const NORM_UNIT: Record<string, string> = { 'm³': 'm3', cum: 'm3', 'cu.m': 'm3', 'cu m': 'm3', 'cu.m.': 'm3', 'm²': 'm2', sqm: 'm2', 'sq.m': 'm2', 'sq m': 'm2', mt: 'MT', ton: 'MT', tons: 'MT', tonne: 'MT', tonnes: 'MT', no: 'Nos', 'no.': 'Nos', nos: 'Nos', 'nos.': 'Nos', number: 'Nos', numbers: 'Nos', kgs: 'kg', rmt: 'RM', rm: 'RM' };

export function findActivities(lines: string[], header = /key activit|major (items|activit)|construction experience|quantit(y|ies) of work|items of work/i): FoundActivity[] {
  let start = lines.findIndex((l) => header.test(l));
  if (start < 0) start = 0;
  const out: FoundActivity[] = [];
  for (const line of lines.slice(start)) {
    const m = line.match(ACT_RE);
    if (!m) continue;
    const name = m[1].replace(/^(and|of)\s+/i, '').trim();
    if (/^(rs|nrs|npr|contract|amount|period|date|turnover|capacity)\b/i.test(name)) continue;
    const u = m[3].toLowerCase().replace(/\s+/g, ' ');
    out.push({ name, unit: NORM_UNIT[u] ?? m[3], quantity: Number(m[2].replace(/,/g, '')), line });
  }
  return out;
}

// ---------------------------------------------------------------- tender notice (IFB)
export function parseTenderText(text: string): { fields: Suggestions; activities: FoundActivity[] } {
  const lines = toLines(text);
  const f: Suggestions = {};
  const put = (key: string, value: any, line: string) => { if (value !== null && value !== undefined && value !== '' && !(key in f)) f[key] = { value, line }; };

  const ifb = find(lines, /\b(IFB|Bid|Contract Identification|Invitation)\s*(No|Number)\.?/i);
  if (ifb) put('ifbNumber', afterColon(ifb.rest).split(/\s{2,}|\s(?=Date)|,/)[0].split(' ')[0], ifb.line);
  const title = find(lines, /\b(Name of (the )?(Work|Project|Contract)|Project Name|Name of Assignment)\b/i);
  if (title) put('projectTitle', afterColon(title.line.slice(title.line.search(/:|–|-/) + 1)) || afterColon(title.rest), title.line);
  const pe = lines.find((l) => /(Municipality|Rural Municipality|Department of|Office of|Division|Authority|Board|Ministry|Project Directorate|Project Office)/i.test(l));
  if (pe) put('procuringEntity', pe.replace(/^(Government of Nepal[,\s]*)/i, '').trim(), pe);

  const est = find(lines, /\b(Cost Estimate|Estimated (Cost|Amount)|Engineer'?s Estimate|Estimate[d]? Value)\b/i);
  if (est) put('boqAmount', moneyIn(est.rest), est.line);
  const per = find(lines, /\b(Contract|Completion|Construction) Period\b|\bTime for Completion\b/i);
  if (per) {
    const m = per.rest.match(/(\d+)\s*(months?|days?|years?)/i);
    if (m) {
      const n = +m[1];
      const u = m[2].toLowerCase();
      put('contractPeriodMonths', u.startsWith('d') ? Math.max(1, Math.round(n / 30)) : u.startsWith('y') ? n * 12 : n, per.line);
    }
  }
  const dl = find(lines, /\b(last date|deadline|bid submission|submission of bids?)\b/i);
  if (dl) put('deadlineDate', dateIn(dl.rest) ?? dateIn(dl.line), dl.line);
  const pub = find(lines, /\b(date of (first )?publication|published on|publication date)\b/i);
  if (pub) put('publicationDate', dateIn(pub.rest) ?? dateIn(pub.line), pub.line);

  const to = find(lines, /\bAverage Annual (Construction )?Turnover\b/i);
  if (to) put('reqTurnover', moneyIn(to.rest), to.line);
  const bc = find(lines, /\bbid(ding)? capacity\b/i);
  if (bc) put('reqBidCapacity', moneyIn(bc.rest), bc.line);
  // Similar contract: look in the similar-contract line and the next 2 lines
  const si = lines.findIndex((l) => /\bsimilar (contract|nature|work)/i.test(l));
  if (si >= 0) {
    const block = lines.slice(si, si + 3).join(' ');
    put('reqSimilarValue', moneyIn(block.replace(/one\s*\(\s*1\s*\)/i, '')), lines[si]);
    const c = block.match(/at least\s+(one|two|three|four|five|\d+)/i);
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    if (c) put('reqSimilarCount', words[c[1].toLowerCase()] ?? Number(c[1]), lines[si]);
  }
  const bs = find(lines, /\b(Bid Security|Bid Bond|Earnest Money)\b/i);
  if (bs) put('bidSecurityAmount', moneyIn(bs.rest), bs.line);
  const bv = find(lines, /\bBid Validity\b|\bbids? (shall )?(be |remain )?valid\b/i);
  if (bv) {
    const m = bv.rest.match(/(\d+)\s*days/i) ?? bv.line.match(/(\d+)\s*days/i);
    if (m) put('bidValidityDays', Number(m[1]), bv.line);
  }
  const type = guessType(text);
  if (type) put('projectType', type.value, type.line);

  return { fields: f, activities: findActivities(lines) };
}

// ---------------------------------------------------------------- bank guarantee (bid / performance security)
export function parseGuaranteeText(text: string): { fields: Suggestions; activities: FoundActivity[] } {
  const lines = toLines(text);
  const f: Suggestions = {};
  const put = (key: string, value: any, line: string) => { if (value !== null && value !== undefined && value !== '' && !(key in f)) f[key] = { value, line }; };
  const bank = lines.find((l) => /\b(Bank|Bikas Bank|Finance)\b.*\b(Ltd|Limited)\.?/i.test(l)) ?? lines.find((l) => /\bBank\b/i.test(l));
  if (bank) put('bidSecurityBank', bank.replace(/^(issued by|issuing bank)\s*[:\-]?\s*/i, '').trim(), bank);
  const ref = find(lines, /\b(Guarantee|Bond|BG|Reference|Ref\.?)\s*(No|Number|#)\.?/i);
  if (ref) put('bidSecurityRef', afterColon(ref.rest).split(' ')[0], ref.line);
  const amt = find(lines, /\b(Guarantee Amount|Amount of Guarantee|sum of|Amount)\b/i);
  if (amt) put('bidSecurityAmount', moneyIn(amt.rest) ?? moneyIn(amt.line), amt.line);
  const iss = find(lines, /\b(Date of Issue|Issue Date|Issued on|Date)\b/i);
  if (iss) put('bidSecurityIssueDate', dateIn(iss.rest) ?? dateIn(iss.line), iss.line);
  const exp = find(lines, /\b(valid (up ?to|until|till)|validity|expiry date|expires on|date of expiry)\b/i);
  if (exp) put('bidSecurityExpiry', dateIn(exp.rest) ?? dateIn(exp.line), exp.line);
  if (/advance (payment )?(security|guarantee|bond)/i.test(text)) put('guaranteeKind', 'ADVANCE', 'advance payment guarantee');
  else if (/performance (security|guarantee|bond)/i.test(text)) put('guaranteeKind', 'PERFORMANCE', 'performance guarantee');
  else if (/retention (money )?(security|guarantee|bond)/i.test(text)) put('guaranteeKind', 'RETENTION', 'retention money guarantee');
  else if (/bid (security|guarantee|bond)/i.test(text)) put('guaranteeKind', 'BID', 'bid guarantee');
  return { fields: f, activities: [] };
}

// ---------------------------------------------------------------- experience certificate
export function parseCertificateText(text: string): { fields: Suggestions; activities: FoundActivity[] } {
  const lines = toLines(text);
  const f: Suggestions = {};
  const put = (key: string, value: any, line: string) => { if (value !== null && value !== undefined && value !== '' && !(key in f)) f[key] = { value, line }; };

  const no = find(lines, /\b(Contract|Agreement|Certificate)\s*(No|Number)\.?/i);
  if (no) put('certificateId', afterColon(no.rest).split(' ')[0], no.line);
  const title = find(lines, /\b(Name of (the )?(Work|Project|Contract)|Project Name)\b/i);
  if (title) put('projectName', afterColon(title.line.slice(title.line.search(/:|–|-/) + 1)), title.line);
  const emp = lines.find((l) => /(Department of|Municipality|Division|Office|Authority|Board|Ministry|Project Directorate)/i.test(l) && !/^this is to certify/i.test(l));
  if (emp) put('employerName', emp.replace(/^(Government of Nepal[,\s]*)/i, '').trim(), emp);

  const ca = find(lines, /\b(Contract (Amount|Price|Value)|Agreement Amount|Original Contract)\b/i);
  if (ca) put('contractAmount', moneyIn(ca.rest), ca.line);
  const fa = find(lines, /\b(Final (Bill )?(Amount|Value|Contract)|Completed (Amount|Value)|Work done amount|Total (Bill|Payment) (Amount)?)\b/i);
  if (fa) put('finalAmount', moneyIn(fa.rest), fa.line);
  const pa = find(lines, /\bPrice Adjustment\b/i);
  if (pa) put('priceAdjustment', moneyIn(pa.rest), pa.line);
  const sd = find(lines, /\b(Date of (Commencement|Start)|Commencement Date|Start(ing)? Date|Work Started)\b/i);
  if (sd) put('startDate', dateIn(sd.rest) ?? dateIn(sd.line), sd.line);
  const cd = find(lines, /\b(Date of (Completion|Substantial Completion)|(Actual )?Completion Date|Completed on)\b/i);
  if (cd) put('completionDate', dateIn(cd.rest) ?? dateIn(cd.line), cd.line);
  if (f['completionDate']) put('fiscalYear', fiscalYearOf(f['completionDate'].value), f['completionDate'].line);
  const jv = find(lines, /\b(JV|Joint Venture)\s*(Share|Participation|%)/i);
  if (jv) {
    const m = jv.rest.match(/(\d+(?:\.\d+)?)\s*%?/);
    if (m && +m[1] > 0 && +m[1] <= 100) put('jvShare', +m[1], jv.line);
  }
  if (/substantial(ly)? complet/i.test(text)) put('completionStatus', 'substantially_completed', 'substantially completed');
  else if (/\bcomplet(ed|ion)\b/i.test(text)) put('completionStatus', 'completed', 'completed');
  const type = guessType(text);
  if (type) put('projectType', type.value, type.line);

  return { fields: f, activities: findActivities(lines) };
}

function guessType(text: string): Found | null {
  const t = text.toLowerCase();
  const score = (words: string[]) => words.reduce((s, w) => s + (t.split(w).length - 1), 0);
  const s: [string, number][] = [
    ['BRIDGE', score(['bridge', 'pul '])],
    ['ROAD', score(['road', 'highway', 'pavement', 'asphalt', 'blacktop', 'dbst'])],
    ['IRRIGATION', score(['irrigation', 'canal', 'headworks', 'river training', 'embankment'])],
    ['BUILDING', score(['building', 'park', 'hospital', 'school', 'block', 'office building', 'housing'])],
  ];
  s.sort((a, b) => b[1] - a[1]);
  return s[0][1] > 0 ? { value: s[0][0], line: `keyword count: ${s[0][0].toLowerCase()} (${s[0][1]})` } : null;
}

// ---------------------------------------------------------------- Task 5: bid readiness checklist
// A plain keyword scan over the whole bid document — it only tells you whether a common
// document / requirement is mentioned somewhere in the text. It is a packing aid, not a
// compliance check: every row must be verified by the person against the actual document.
export interface ChecklistItem { key: string; label: string; found: boolean; line: string; }

const CHECKLIST: { key: string; label: string; re: RegExp }[] = [
  { key: 'bidSecurity', label: 'Bid security / bid bond', re: /\bbid (security|bond)\b|\bearnest money\b/i },
  { key: 'bidForm', label: 'Bid form (letter of bid)', re: /\bform of bid\b|\bletter of bid\b|\bbid form\b/i },
  { key: 'priceSchedule', label: 'Price schedule / BOQ', re: /\bprice schedule\b|\bbill of quantities\b|\bBOQ\b/i },
  { key: 'poa', label: 'Power of attorney', re: /\bpower of attorney\b/i },
  { key: 'registration', label: 'Firm / company registration certificate', re: /\b(firm|company) registration\b|\bregistration certificate\b/i },
  { key: 'panVat', label: 'PAN / VAT registration', re: /\bPAN\b.{0,15}\bVAT\b|\bVAT registration\b|\bpermanent account number\b/i },
  { key: 'taxClearance', label: 'Tax clearance certificate', re: /\btax clearance\b/i },
  { key: 'jvAgreement', label: 'Joint venture agreement (if a JV)', re: /\bjoint venture agreement\b|\bJV agreement\b/i },
  { key: 'experience', label: 'Experience / completion certificates of similar work', re: /\bcompletion certificate\b|\bexperience certificate\b|\bsimilar (nature|contract|work)\b/i },
  { key: 'financials', label: 'Audited financial statements / balance sheet', re: /\baudited (financial|balance)\b|\bbalance sheet\b|\bfinancial statement/i },
  { key: 'equipment', label: 'Equipment ownership / lease or hire agreement', re: /\bequipment\b.{0,30}\b(owned|own|lease|hire)\b/i },
  { key: 'personnel', label: 'Key personnel — CVs / qualifications', re: /\bkey personnel\b|\bcurriculum vitae\b|\bCV of\b/i },
  { key: 'litigation', label: 'Litigation history declaration', re: /\blitigation history\b|\bpending litigation\b/i },
  { key: 'methodology', label: 'Methodology / work programme', re: /\bmethodology\b|\bwork programme\b|\bwork schedule\b/i },
  { key: 'qualInfo', label: 'Qualification information form', re: /\bqualification information\b/i },
  { key: 'bidValidity', label: 'Bid validity period stated', re: /\bbid validity\b|\bbids? shall remain valid\b/i },
  { key: 'noConflict', label: 'Eligibility / no conflict-of-interest declaration', re: /\bconflict of interest\b|\beligibility\b.{0,20}\bdeclaration\b/i },
];

export function findDocumentChecklist(text: string): ChecklistItem[] {
  return CHECKLIST.map((c) => {
    const m = text.match(c.re);
    const idx = m?.index ?? -1;
    const line = idx >= 0 ? text.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ').trim() : '';
    return { key: c.key, label: c.label, found: !!m, line };
  });
}

// ---------------------------------------------------------------- Task 5b: named clauses + clause-21 checklist + VAT
// Feedback from real bid documents: the generic checklist above is a guess; a real Standard
// Bidding Document (SBD) already lists exactly what it wants, in ITB Clause 21 "Sealing and
// Marking of Bids" (Section I), and the Bid Data Sheet (Section II) fills in specific ITB/GCC
// clause numbers. Reading those directly is far more reliable than guessing — still a reading
// aid, every clause found must be read in full in the actual document before you rely on it.
export interface ClauseFind { ref: string; title: string; found: boolean; text: string; }

const KEY_CLAUSES: { ref: string; title: string; re: RegExp }[] = [
  { ref: 'ITB 1.1', title: 'Scope of bid / source of funds (Section II: Bid Data Sheet)', re: /\bITB\s*1\.1\b/i },
  { ref: 'ITB 2.1', title: 'Eligible bidders (Section II: Bid Data Sheet)', re: /\bITB\s*2\.1\b/i },
  { ref: 'ITB 2.2', title: 'Eligible bidders — 2.2', re: /\bITB\s*2\.2\b/i },
  { ref: 'ITB 2.3', title: 'Eligible bidders — 2.3', re: /\bITB\s*2\.3\b/i },
  { ref: 'ITB 2.4', title: 'Eligible bidders — 2.4', re: /\bITB\s*2\.4\b/i },
  { ref: 'ITB 19.1', title: 'Bid security (Section II: Bid Data Sheet)', re: /\bITB\s*19\.1\b/i },
  { ref: 'GCC 1.1(u)', title: 'Definitions — GCC 1.1(u)', re: /\bGCC\s*1\.1\s*\(\s*u\s*\)|\b1\.1\s*\(\s*u\s*\)/i },
];

/** Looks only for these specific clause references and returns the text right after each one is mentioned. */
export function findKeyClauses(text: string): ClauseFind[] {
  return KEY_CLAUSES.map((c) => {
    const m = text.match(c.re);
    if (!m || m.index == null) return { ref: c.ref, title: c.title, found: false, text: '' };
    const excerpt = text.slice(m.index, m.index + 420).replace(/\s+/g, ' ').trim();
    return { ref: c.ref, title: c.title, found: true, text: excerpt };
  });
}

/** The real checklist — straight from this document's own Clause 21 "Sealing and Marking of Bids", not a guess. */
export function checklistFromClause21(text: string): ChecklistItem[] | null {
  const m = text.match(/\b(ITB\s*)?21\s*[.:]?\s*Sealing (and|&) Marking of Bid/i);
  if (!m || m.index == null) return null;
  let block = text.slice(m.index, m.index + 5000);
  const nextClause = block.slice(20).search(/\n\s*22\s*[.:]\s*[A-Z]/);
  if (nextClause >= 0) block = block.slice(0, nextClause + 20);

  const items: ChecklistItem[] = [];
  const subRe = /\(([a-z])\)\s*([\s\S]+?)(?=\([a-z]\)|$)/g;
  let mm: RegExpExecArray | null;
  while ((mm = subRe.exec(block))) {
    const label = mm[2].replace(/\s+/g, ' ').trim().replace(/[;.,]$/, '');
    if (label.length > 3 && label.length < 240) items.push({ key: 'clause21-' + mm[1], label, found: true, line: `Clause 21 (${mm[1]})` });
  }
  return items.length ? items : null;
}

/**
 * PPMO cost estimates (BOQ / Engineer's estimate) are normally prepared exclusive of VAT — VAT is
 * added on top of the contract price, not built into the estimate used for bid-capacity / turnover
 * checks. If the document itself says the figure is VAT-inclusive, this divides by 1.13 (13% VAT)
 * to recover the pre-VAT figure instead. Always shown with its reasoning so it can be checked.
 */
export function estimateExcludingVat(rawEstimate: number | null, nearText: string): { value: number | null; note: string } {
  if (rawEstimate == null) return { value: null, note: '' };
  const inclusive = /\b(incl(uding|usive)\s+of\s+VAT|VAT\s+included|with\s+VAT)\b/i.test(nearText);
  const exclusive = /\b(excl(uding|usive)\s+of\s+VAT|VAT\s+excluded|before\s+VAT|without\s+VAT)\b/i.test(nearText);
  if (exclusive) return { value: rawEstimate, note: 'The document states this estimate excludes VAT — used as read.' };
  if (inclusive) return { value: Math.round((rawEstimate / 1.13) * 100) / 100, note: 'The document states this estimate includes VAT — divided by 1.13 (PPMO 13% VAT) to get the amount excluding VAT.' };
  return { value: rawEstimate, note: 'VAT treatment is not stated near the estimate — PPMO cost estimates are normally prepared excluding VAT, so this is used as read. Verify against the document.' };
}
