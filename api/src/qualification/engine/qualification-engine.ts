// =====================================================================
// ProcureNepal — Qualification Engine v2 (Phase 6.4A)
// © Cuidado Technology Pvt. Ltd.
//
// Pure functions only (no database). The service loads data, the engine
// decides. Every check returns a plain-language reason.
//
// Checks for a single bidder:
//   1. LICENSE            – licence valid on the bid deadline
//   2. RUNNING_CONTRACTS  – fewer than N running open-bid contracts (ELI-3)
//   3. TURNOVER           – average annual construction turnover, best 3 of 10 FYs, WPI-adjusted
//   4. BID_CAPACITY       – M × A − B (B = FIN-5 annualised current commitments)
//   5. SIMILAR_CONTRACT   – N completed similar contracts ≥ value, within look-back
//   6. KEY_ACTIVITY       – each required quantity achieved in ONE fiscal year (max FY; no JV share)
//   7. KEY_ACTIVITY_VALUE – legacy value-based key activity (old tender fields)
// JV: combined 100% / each 25% / one 40% turnover; similar = one partner (or each+one);
//     key activities = all partners combined; running contracts + licence = every partner.
// =====================================================================

import {
  CriteriaDefaults,
  DISCLAIMER,
  RuleSet,
  pickRuleSet,
  resolveCriteria,
} from './rule-sets';
import {
  activityMatches,
  fyStart,
  fyStartForDate,
  monthsBetween,
  normUnit,
} from './fiscal-year';

// ---------------------------------------------------------------- types

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_REQUIRED';
export type CheckCode =
  | 'LICENSE'
  | 'RUNNING_CONTRACTS'
  | 'TURNOVER'
  | 'BID_CAPACITY'
  | 'SIMILAR_CONTRACT'
  | 'KEY_ACTIVITY'
  | 'KEY_ACTIVITY_VALUE'
  | 'JV_STRUCTURE';

export interface EngineKeyActivity {
  name: string;
  unit: string;
  fiscalYear: string;
  quantity: number;
}

export interface EngineCertificate {
  id: string;
  certificateId?: string | null;
  projectName: string;
  projectType: string;
  fiscalYear: string;
  contractAmount: number;
  finalAmount?: number | null;
  jvShare: number; // 0–100
  jvName?: string | null;
  completionStatus: string; // in_progress | completed | substantially_completed
  verificationStatus: string; // unverified | verified
  completionDate?: Date | null;
  activities?: string[];
  keyActivities?: EngineKeyActivity[] | null;
  outstandingAmount?: number | null; // for running contracts (FIN-5)
  isOpenBid?: boolean | null; // counts towards the running-contract limit
}

export interface EngineCompany {
  id: string;
  name: string;
  licenseClass?: string | null;
  licenseExpiry?: Date | null;
  certificates: EngineCertificate[];
  annualTurnovers?: { fiscalYear: string; amount: number }[];
}

export interface TenderKeyActivityReq {
  name: string;
  unit: string;
  quantity: number;
}

export interface EngineTender {
  id?: string;
  ifbNumber?: string;
  projectTitle?: string;
  estimateAmount?: number | null; // V, excluding VAT
  contractPeriodMonths?: number | null; // T
  publicationDate?: Date | null;
  deadlineDate?: Date | null;
  projectType?: string | null;
  similarProjectTypes?: string[];
  reqTurnover?: number | null; // explicit amount from IFB
  reqBidCapacity?: number | null;
  reqSimilarValue?: number | null;
  reqSimilarCount?: number | null;
  keyActivityReqs?: TenderKeyActivityReq[] | null;
  legacyActivity?: { name: string; minValue: number } | null;
  isComplexWork?: boolean;
  ruleSetId?: string | null;
  criteria?: Partial<CriteriaDefaults> | null;
}

export interface Check {
  code: CheckCode;
  title: string;
  status: CheckStatus;
  required: number | null;
  actual: number | null;
  unit: string; // 'NPR', 'contracts', 'm3', …
  reason: string;
  jvCanHelp: boolean;
  usesUnverified?: boolean;
  details?: any;
}

export type WpiLookup = (fiscalYear: string) => number | null; // multiplier to today's prices, null = unknown

export interface SingleResult {
  engineVersion: string;
  companyId: string;
  companyName: string;
  result: 'INDIVIDUAL_ELIGIBLE' | 'JV_REQUIRED' | 'NOT_ELIGIBLE';
  summary: string;
  suggestedJvRole: 'LEAD' | 'PARTNER' | null;
  checks: Check[];
  warnings: string[];
  numbers: {
    averageAnnualTurnover: number;
    bidCapacity: number | null;
    currentCommitmentsB: number;
    runningOpenBidContracts: number;
  };
  certificatesUsed: number;
  certificatesPendingDocumentCheck: number;
  ruleSet: { id: string; name: string; effectiveFrom: string; notes: string[] };
  criteria: CriteriaDefaults;
  evaluatedAt: string;
  disclaimer: string;
}

export const ENGINE_VERSION = 'qualification-engine-2.0 (Phase 6.4A)';

const NPR = (n: number) =>
  'Rs ' + Math.round(n).toLocaleString('en-IN');

const QTY = (n: number) =>
  (Math.round(n * 100) / 100).toLocaleString('en-IN');

/** "Best 3-year average" / "Average of 2 available years" */
function avgLabel(t: { yearsUsed: number }, ctx: { criteria: CriteriaDefaults }): string {
  const N = ctx.criteria.turnoverBestYears;
  if (t.yearsUsed >= N) return `Best ${N}-year average`;
  if (t.yearsUsed === 1) return 'Turnover of the 1 available year';
  return `Average of the ${t.yearsUsed} available years`;
}

/** Plain-language failure phrase for the summary line */
function failPhrase(c: Check): string {
  switch (c.code) {
    case 'LICENSE': return 'the contractor licence expires before the bid deadline';
    case 'RUNNING_CONTRACTS': return 'too many running open-bid contracts';
    case 'TURNOVER': return 'turnover';
    case 'BID_CAPACITY': return 'bid capacity';
    case 'SIMILAR_CONTRACT': return 'similar contract experience';
    case 'JV_STRUCTURE': return 'the JV agreement structure';
    default: return c.title.charAt(0).toLowerCase() + c.title.slice(1);
  }
}

// ------------------------------------------------------------ context

interface Ctx {
  tender: EngineTender;
  ruleSet: RuleSet;
  criteria: CriteriaDefaults;
  asOf: Date; // bid deadline (or today)
  currentFy: number;
  oldestFy: number;
  V: number | null;
  requiredTurnover: number | null;
  requiredBidCapacity: number | null;
  requiredSimilarValue: number | null;
  requiredSimilarCount: number;
  similarTypes: string[];
  wpi: WpiLookup;
}

export function buildContext(tender: EngineTender, wpi: WpiLookup, now = new Date()): Ctx {
  const asOf = tender.deadlineDate ?? now;
  const ruleDate = tender.publicationDate ?? tender.deadlineDate ?? now;
  const ruleSet = pickRuleSet(ruleDate, tender.ruleSetId);
  const criteria = resolveCriteria(ruleSet, tender.criteria);

  // Interim JV notice: complex works above the threshold → EACH_AND_ONE (unless tender overrides)
  const V = tender.estimateAmount && tender.estimateAmount > 0 ? tender.estimateAmount : null;
  if (
    ruleSet.interimJvThreshold !== null &&
    tender.isComplexWork &&
    V !== null &&
    V > ruleSet.interimJvThreshold &&
    !(tender.criteria && (tender.criteria as any).jvSimilarRule)
  ) {
    criteria.jvSimilarRule = 'EACH_AND_ONE';
  }

  const T = Math.max(12, tender.contractPeriodMonths ?? 12);
  const requiredTurnover =
    tender.reqTurnover && tender.reqTurnover > 0
      ? tender.reqTurnover
      : V !== null
        ? (criteria.turnoverMultiplier * V * 12) / T
        : null;
  const requiredBidCapacity =
    tender.reqBidCapacity && tender.reqBidCapacity > 0
      ? tender.reqBidCapacity
      : V !== null
        ? (criteria.bidCapacityPercent / 100) * V
        : null;
  const requiredSimilarValue =
    tender.reqSimilarValue && tender.reqSimilarValue > 0
      ? tender.reqSimilarValue
      : V !== null
        ? (criteria.similarContractPercent / 100) * V
        : null;

  const similarTypes =
    tender.similarProjectTypes && tender.similarProjectTypes.length
      ? tender.similarProjectTypes
      : tender.projectType
        ? [tender.projectType]
        : [];

  const currentFy = fyStartForDate(asOf);
  return {
    tender,
    ruleSet,
    criteria,
    asOf,
    currentFy,
    oldestFy: currentFy - criteria.lookbackYears,
    V,
    requiredTurnover,
    requiredBidCapacity,
    requiredSimilarValue,
    requiredSimilarCount: Math.max(1, tender.reqSimilarCount ?? criteria.similarContractCount),
    similarTypes,
    wpi,
  };
}

// ---------------------------------------------------- helper calculations

const isCompleted = (c: EngineCertificate) =>
  c.completionStatus === 'completed' || c.completionStatus === 'substantially_completed';
const isRunning = (c: EngineCertificate) => c.completionStatus === 'in_progress';
const isVerified = (c: EngineCertificate) => c.verificationStatus === 'verified';
const certValue = (c: EngineCertificate) =>
  c.finalAmount && c.finalAmount > 0 ? c.finalAmount : c.contractAmount;
const share = (c: EngineCertificate) => Math.min(100, Math.max(0, Number(c.jvShare ?? 100))) / 100;
const label = (c: EngineCertificate) => `${c.projectName}${c.certificateId ? ` (${c.certificateId})` : ''}`;

function inWindow(ctx: Ctx, fy: string | null | undefined): boolean {
  const s = fyStart(fy ?? '');
  return s !== null && s >= ctx.oldestFy && s <= ctx.currentFy;
}

function wpiFactor(ctx: Ctx, fy: string, warnings: Set<string>): number {
  const f = ctx.wpi(fy);
  if (f === null || !isFinite(f) || f <= 0) {
    warnings.add(`No WPI index for FY ${fy} — amounts for that year are used without price adjustment.`);
    return 1;
  }
  return f;
}

/** Certificates the engine may use (document-check rule applied). */
function usableCerts(ctx: Ctx, company: EngineCompany, warnings: Set<string>) {
  const all = company.certificates ?? [];
  const pending = all.filter((c) => !isVerified(c));
  if (!ctx.criteria.countUnverified) {
    if (pending.length) {
      warnings.add(
        `${pending.length} certificate(s) of ${company.name} are not counted because their document check is pending.`,
      );
    }
    return { certs: all.filter(isVerified), pending: pending.length };
  }
  if (pending.length) {
    warnings.add(
      `${pending.length} certificate(s) of ${company.name} are counted but their document check is still pending — tick "Document checked" after comparing with the original certificate.`,
    );
  }
  return { certs: all, pending: pending.length };
}

export interface TurnoverCalc {
  average: number;
  yearsUsed: number;
  source: 'AUDITED' | 'CERTIFICATES' | 'NONE';
  years: { fiscalYear: string; raw: number; wpiAdjusted: number; used: boolean }[];
  usesUnverified: boolean;
}

/** Average annual construction turnover: best N of last 10 FYs, WPI-adjusted, divided by N. */
export function calcTurnover(
  ctx: Ctx,
  company: EngineCompany,
  certs: EngineCertificate[],
  warnings: Set<string>,
): TurnoverCalc {
  const N = Math.max(1, ctx.criteria.turnoverBestYears);
  const perYear: Record<string, number> = {};
  let source: TurnoverCalc['source'] = 'NONE';
  let usesUnverified = false;

  const audited = (company.annualTurnovers ?? []).filter((t) => inWindow(ctx, t.fiscalYear) && t.amount > 0);
  if (audited.length) {
    source = 'AUDITED';
    for (const t of audited) perYear[t.fiscalYear] = (perYear[t.fiscalYear] ?? 0) + t.amount;
  } else {
    // Estimate from certificates: whole value in the certificate's FY × JV share
    const used = certs.filter((c) => inWindow(ctx, c.fiscalYear));
    if (used.length) {
      source = 'CERTIFICATES';
      warnings.add(
        `${company.name}: audited annual turnover is not entered — turnover is estimated from certificates (each certificate's value × JV share, in its fiscal year). Enter audited turnover for an accurate result.`,
      );
      for (const c of used) {
        perYear[c.fiscalYear] = (perYear[c.fiscalYear] ?? 0) + certValue(c) * share(c);
        if (!isVerified(c)) usesUnverified = true;
      }
    }
  }

  const years = Object.entries(perYear).map(([fy, raw]) => ({
    fiscalYear: fy,
    raw,
    wpiAdjusted: raw * wpiFactor(ctx, fy, warnings),
    used: false,
  }));
  years.sort((a, b) => b.wpiAdjusted - a.wpiAdjusted);
  years.slice(0, N).forEach((y) => (y.used = true));
  const total = years.slice(0, N).reduce((s, y) => s + y.wpiAdjusted, 0);
  const divisor =
    ctx.criteria.turnoverDivisor === 'FIXED' ? N : Math.max(1, Math.min(N, years.length));
  if (years.length > 0 && years.length < N) {
    warnings.add(
      ctx.criteria.turnoverDivisor === 'FIXED'
        ? `${company.name}: only ${years.length} fiscal year(s) of turnover found — the average is divided by ${N} (fixed rule).`
        : `${company.name}: only ${years.length} fiscal year(s) of turnover found — the average is divided by ${years.length}. If the bid document divides by ${N}, set "turnoverDivisor": "FIXED" for this tender.`,
    );
  }
  years.sort((a, b) => (fyStart(b.fiscalYear) ?? 0) - (fyStart(a.fiscalYear) ?? 0));
  return { average: total / divisor, yearsUsed: Math.min(N, years.length), source, years, usesUnverified };
}

export interface CommitmentCalc {
  B: number;
  runningOpenBid: number;
  running: {
    project: string;
    outstanding: number | null;
    remainingMonths: number;
    annualValue: number;
    openBid: boolean;
  }[];
}

/** FIN-5: annual value of each running contract = outstanding × 12 ÷ remaining months (min 12). */
export function calcCommitments(ctx: Ctx, company: EngineCompany, warnings: Set<string>): CommitmentCalc {
  const running = (company.certificates ?? []).filter(isRunning);
  let B = 0;
  let openBid = 0;
  const rows: CommitmentCalc['running'] = [];
  for (const c of running) {
    const isOpen = c.isOpenBid !== false;
    if (isOpen) openBid++;
    let outstanding = c.outstandingAmount ?? null;
    if (outstanding === null) {
      warnings.add(
        `${company.name}: running contract "${c.projectName}" has no outstanding (remaining) amount — it is treated as 0 in bid capacity. Enter the remaining work value.`,
      );
    }
    const own = (outstanding ?? 0) * share(c);
    let months = 12;
    if (c.completionDate) {
      const m = monthsBetween(ctx.asOf, c.completionDate);
      months = m <= 0 ? 12 : Math.max(12, m); // passed → 12; minimum 12
    }
    const annual = (own * 12) / months;
    B += annual;
    rows.push({
      project: label(c),
      outstanding,
      remainingMonths: Math.round(months * 10) / 10,
      annualValue: annual,
      openBid: isOpen,
    });
  }
  return { B, runningOpenBid: openBid, running: rows };
}

/** Similar completed contracts in the look-back window with their counted (WPI-adjusted) value. */
export function similarCandidates(ctx: Ctx, certs: EngineCertificate[], warnings: Set<string>) {
  return certs
    .filter(isCompleted)
    .filter((c) => (ctx.similarTypes.length ? ctx.similarTypes.includes(c.projectType) : true))
    .filter((c) => {
      if (c.completionDate) {
        const fy = fyStartForDate(c.completionDate);
        return fy >= ctx.oldestFy && fy <= ctx.currentFy;
      }
      return inWindow(ctx, c.fiscalYear);
    })
    .map((c) => {
      const fy = c.fiscalYear;
      const adjusted = certValue(c) * wpiFactor(ctx, fy, warnings);
      const counted = ctx.criteria.applyJvShareToSimilar ? adjusted * share(c) : adjusted;
      return { cert: c, project: label(c), fiscalYear: fy, jvShare: share(c) * 100, adjusted, counted };
    })
    .sort((a, b) => b.counted - a.counted);
}

/** Quantity of an activity per fiscal year (no JV share — PPMO rule). */
export function activityPerYear(
  ctx: Ctx,
  certs: EngineCertificate[],
  req: TenderKeyActivityReq,
  warnings: Set<string>,
  who: string,
) {
  const perYear: Record<string, number> = {};
  const sources: { project: string; fiscalYear: string; quantity: number; unverified: boolean }[] = [];
  const reqUnit = normUnit(req.unit);
  for (const c of certs) {
    for (const a of c.keyActivities ?? []) {
      if (!activityMatches(req.name, a.name)) continue;
      if (normUnit(a.unit) !== reqUnit) {
        warnings.add(
          `${who}: "${a.name}" in ${c.projectName} is in "${a.unit}" but the tender asks for "${req.unit}" — not counted.`,
        );
        continue;
      }
      if (!inWindow(ctx, a.fiscalYear)) continue;
      const q = Number(a.quantity) || 0;
      perYear[a.fiscalYear] = (perYear[a.fiscalYear] ?? 0) + q;
      sources.push({ project: label(c), fiscalYear: a.fiscalYear, quantity: q, unverified: !isVerified(c) });
    }
  }
  return { perYear, sources };
}

function maxYear(perYear: Record<string, number>): { fy: string | null; qty: number } {
  let fy: string | null = null;
  let qty = 0;
  for (const [y, q] of Object.entries(perYear)) {
    if (q > qty) {
      qty = q;
      fy = y;
    }
  }
  return { fy, qty };
}

// --------------------------------------------------------- single bidder

export function evaluateSingle(
  tender: EngineTender,
  company: EngineCompany,
  wpi: WpiLookup,
  now = new Date(),
): SingleResult {
  const ctx = buildContext(tender, wpi, now);
  const warnings = new Set<string>();
  const checks: Check[] = [];
  const { certs, pending } = usableCerts(ctx, company, warnings);

  // 1. LICENSE
  if (company.licenseExpiry) {
    const ok = company.licenseExpiry.getTime() >= ctx.asOf.getTime();
    checks.push({
      code: 'LICENSE',
      title: 'Contractor licence valid',
      status: ok ? 'PASS' : 'FAIL',
      required: null,
      actual: null,
      unit: 'date',
      reason: ok
        ? `Licence${company.licenseClass ? ` (Class ${company.licenseClass})` : ''} is valid until ${company.licenseExpiry.toISOString().slice(0, 10)}, after the bid deadline.`
        : `Licence expired on ${company.licenseExpiry.toISOString().slice(0, 10)}, before the bid deadline ${ctx.asOf.toISOString().slice(0, 10)}. Renew it before bidding.`,
      jvCanHelp: false,
    });
  } else {
    checks.push({
      code: 'LICENSE',
      title: 'Contractor licence valid',
      status: 'WARN',
      required: null,
      actual: null,
      unit: 'date',
      reason: 'Licence expiry date is not entered for this company — add it in Companies.',
      jvCanHelp: false,
    });
  }

  // 2. RUNNING CONTRACTS (ELI-3)
  const commit = calcCommitments(ctx, company, warnings);
  const maxRun = ctx.criteria.maxRunningContracts;
  {
    const ok = commit.runningOpenBid < maxRun;
    checks.push({
      code: 'RUNNING_CONTRACTS',
      title: `Fewer than ${maxRun} running open-bid contracts`,
      status: ok ? 'PASS' : 'FAIL',
      required: maxRun - 1,
      actual: commit.runningOpenBid,
      unit: 'contract(s)',
      reason: ok
        ? `${commit.runningOpenBid} running open-bid contract(s) — limit is ${maxRun - 1}.`
        : `${commit.runningOpenBid} running open-bid contracts — a bidder may not already hold ${maxRun}. A JV cannot fix this; every partner must meet it. (Contracts excluded by the bid document can be marked "not open bid".)`,
      jvCanHelp: false,
      details: { running: commit.running },
    });
  }

  // 3. TURNOVER
  const turnover = calcTurnover(ctx, company, certs, warnings);
  if (ctx.requiredTurnover === null) {
    checks.push({
      code: 'TURNOVER',
      title: 'Average annual construction turnover',
      status: 'NOT_REQUIRED',
      required: null,
      actual: turnover.average,
      unit: 'NPR',
      reason: 'No turnover requirement — enter the required turnover or the cost estimate in the tender.',
      jvCanHelp: false,
      details: { source: turnover.source, years: turnover.years },
    });
  } else {
    const ok = turnover.average >= ctx.requiredTurnover;
    const pct = (turnover.average / ctx.requiredTurnover) * 100;
    checks.push({
      code: 'TURNOVER',
      title: 'Average annual construction turnover',
      status: ok ? 'PASS' : 'FAIL',
      required: ctx.requiredTurnover,
      actual: turnover.average,
      unit: 'NPR',
      reason: ok
        ? `${avgLabel(turnover, ctx)} ${NPR(turnover.average)} meets the required ${NPR(ctx.requiredTurnover)} (${pct.toFixed(0)}%).`
        : turnover.yearsUsed === 0
          ? `No turnover found in the last ${ctx.criteria.lookbackYears} fiscal years — enter audited turnover on the Companies page (required ${NPR(ctx.requiredTurnover)}).`
          : `${avgLabel(turnover, ctx)} ${NPR(turnover.average)} is ${pct.toFixed(0)}% of the required ${NPR(ctx.requiredTurnover)} — short by ${NPR(ctx.requiredTurnover - turnover.average)}.`,
      jvCanHelp: true,
      usesUnverified: turnover.usesUnverified,
      details: {
        source: turnover.source,
        years: turnover.years,
        basis: ctx.tender.reqTurnover
          ? 'Amount stated in the tender'
          : `${ctx.criteria.turnoverMultiplier} × estimate × 12 ÷ ${Math.max(12, ctx.tender.contractPeriodMonths ?? 12)} months`,
      },
    });
  }

  // 4. BID CAPACITY
  const capacity = ctx.criteria.bidCapacityMultiplier * turnover.average - commit.B;
  if (ctx.requiredBidCapacity === null) {
    checks.push({
      code: 'BID_CAPACITY',
      title: 'Bid capacity',
      status: 'NOT_REQUIRED',
      required: null,
      actual: capacity,
      unit: 'NPR',
      reason: 'No bid capacity requirement — enter the required bid capacity or the cost estimate in the tender.',
      jvCanHelp: false,
    });
  } else {
    const ok = capacity >= ctx.requiredBidCapacity;
    checks.push({
      code: 'BID_CAPACITY',
      title: 'Bid capacity',
      status: ok ? 'PASS' : 'FAIL',
      required: ctx.requiredBidCapacity,
      actual: capacity,
      unit: 'NPR',
      reason:
        `${ctx.criteria.bidCapacityMultiplier} × A (${NPR(turnover.average)}) − B (${NPR(commit.B)}) = ${NPR(capacity)}` +
        (ok
          ? ` — meets the required ${NPR(ctx.requiredBidCapacity)}.`
          : ` — below the required ${NPR(ctx.requiredBidCapacity)} by ${NPR(ctx.requiredBidCapacity - capacity)}.`),
      jvCanHelp: true,
      usesUnverified: turnover.usesUnverified,
      details: {
        formula: 'M × A − B',
        M: ctx.criteria.bidCapacityMultiplier,
        A: turnover.average,
        B: commit.B,
        fin5: commit.running,
        note: 'Check the multiplier against the bid document (ELI/FIN form).',
      },
    });
  }

  // 5. SIMILAR CONTRACT
  const similar = similarCandidates(ctx, certs, warnings);
  if (ctx.requiredSimilarValue === null) {
    checks.push({
      code: 'SIMILAR_CONTRACT',
      title: 'Similar contract experience',
      status: 'NOT_REQUIRED',
      required: null,
      actual: similar[0]?.counted ?? null,
      unit: 'NPR',
      reason: 'No similar contract requirement — enter the value or the cost estimate in the tender.',
      jvCanHelp: false,
    });
  } else {
    const req = ctx.requiredSimilarValue;
    const qualifying = similar.filter((s) => s.counted >= req);
    const ok = qualifying.length >= ctx.requiredSimilarCount;
    const usedUnverified = qualifying.slice(0, ctx.requiredSimilarCount).some((s) => !isVerified(s.cert));
    const types = ctx.similarTypes.length ? ctx.similarTypes.join('/') : 'any type';
    checks.push({
      code: 'SIMILAR_CONTRACT',
      title: 'Similar contract experience',
      status: ok ? 'PASS' : 'FAIL',
      required: req,
      actual: similar[0]?.counted ?? 0,
      unit: 'NPR',
      reason: ok
        ? `${qualifying.length} completed ${types} contract(s) of at least ${NPR(req)} in the last ${ctx.criteria.lookbackYears} years — best: ${qualifying[0].project} ${NPR(qualifying[0].counted)}.`
        : similar.length
          ? `Needs ${ctx.requiredSimilarCount} completed ${types} contract(s) of at least ${NPR(req)}; found ${qualifying.length}. Largest is ${similar[0].project} at ${NPR(similar[0].counted)}.`
          : `No completed ${types} contract in the last ${ctx.criteria.lookbackYears} years.`,
      jvCanHelp: true,
      usesUnverified: usedUnverified,
      details: {
        requiredCount: ctx.requiredSimilarCount,
        applyJvShare: ctx.criteria.applyJvShareToSimilar,
        candidates: similar.slice(0, 10).map((s) => ({
          project: s.project,
          fiscalYear: s.fiscalYear,
          jvShare: s.jvShare,
          wpiAdjusted: s.adjusted,
          counted: s.counted,
          meets: s.counted >= req,
        })),
      },
    });
  }

  // 6. KEY ACTIVITIES (quantities — max single FY, no JV share)
  for (const req of ctx.tender.keyActivityReqs ?? []) {
    if (!req?.name || !(req.quantity > 0)) continue;
    const { perYear, sources } = activityPerYear(ctx, certs, req, warnings, company.name);
    const best = maxYear(perYear);
    const ok = best.qty >= req.quantity;
    const usedUnverified = sources.some((s) => s.fiscalYear === best.fy && s.unverified);
    checks.push({
      code: 'KEY_ACTIVITY',
      title: `Key activity: ${req.name}`,
      status: ok ? 'PASS' : 'FAIL',
      required: req.quantity,
      actual: best.qty,
      unit: req.unit,
      reason: ok
        ? `${QTY(best.qty)} ${req.unit} done in FY ${best.fy} meets the required ${QTY(req.quantity)} ${req.unit} (single fiscal year).`
        : best.fy
          ? `Best fiscal year is ${best.fy} with ${QTY(best.qty)} ${req.unit} — required ${QTY(req.quantity)} ${req.unit} in one fiscal year (short by ${QTY(req.quantity - best.qty)}).`
          : `No "${req.name}" (${req.unit}) found in the Key Activities of any certificate in the last ${ctx.criteria.lookbackYears} years.`,
      jvCanHelp: true,
      usesUnverified: usedUnverified,
      details: { perYear, bestFiscalYear: best.fy, sources, note: 'JV share is not applied to key activities.' },
    });
  }

  // 7. LEGACY value-based key activity (old tender fields reqActivity + reqMinProduction)
  if (ctx.tender.legacyActivity && ctx.tender.legacyActivity.name && ctx.tender.legacyActivity.minValue > 0) {
    const la = ctx.tender.legacyActivity;
    const perYear: Record<string, number> = {};
    for (const c of certs) {
      const has =
        (c.activities ?? []).some((a) => activityMatches(la.name, a)) ||
        (c.keyActivities ?? []).some((a) => activityMatches(la.name, a.name));
      if (!has || !inWindow(ctx, c.fiscalYear)) continue;
      perYear[c.fiscalYear] = (perYear[c.fiscalYear] ?? 0) + certValue(c);
    }
    const best = maxYear(perYear);
    const ok = best.qty >= la.minValue;
    checks.push({
      code: 'KEY_ACTIVITY_VALUE',
      title: `Key activity value: ${la.name}`,
      status: ok ? 'PASS' : 'FAIL',
      required: la.minValue,
      actual: best.qty,
      unit: 'NPR',
      reason: ok
        ? `Contracts with "${la.name}" in FY ${best.fy} total ${NPR(best.qty)} — meets ${NPR(la.minValue)}.`
        : `Best fiscal year for "${la.name}" totals ${NPR(best.qty)} — required ${NPR(la.minValue)}.`,
      jvCanHelp: true,
      details: { perYear, bestFiscalYear: best.fy, note: 'Maximum single fiscal year, JV share not applied.' },
    });
  }

  // ---- decision
  const hardFail = checks.filter((c) => c.status === 'FAIL' && !c.jvCanHelp);
  const softFail = checks.filter((c) => c.status === 'FAIL' && c.jvCanHelp);
  let result: SingleResult['result'];
  let suggestedJvRole: SingleResult['suggestedJvRole'] = null;
  let summary: string;

  const turnoverPct =
    ctx.requiredTurnover && ctx.requiredTurnover > 0 ? (turnover.average / ctx.requiredTurnover) * 100 : 100;

  if (hardFail.length) {
    result = 'NOT_ELIGIBLE';
    summary = `Not eligible: ${hardFail.map(failPhrase).join('; ')}. A JV cannot fix this.`;
  } else if (!softFail.length) {
    result = 'INDIVIDUAL_ELIGIBLE';
    const anyRequirement = checks.some(
      (c) => c.required !== null && c.code !== 'LICENSE' && c.code !== 'RUNNING_CONTRACTS',
    );
    summary = anyRequirement
      ? 'Meets every entered requirement as a single bidder.'
      : 'No turnover, similar contract or key activity requirement is entered for this tender yet — only the licence and running contracts were checked.';
  } else if (turnoverPct >= ctx.criteria.jvMinEachPercent) {
    result = 'JV_REQUIRED';
    suggestedJvRole = turnoverPct >= ctx.criteria.jvMinLeadPercent ? 'LEAD' : 'PARTNER';
    summary =
      `Needs a JV partner for: ${softFail.map(failPhrase).join(', ')}. ` +
      (suggestedJvRole === 'LEAD'
        ? `Turnover is ${turnoverPct.toFixed(0)}% of the requirement, so this company can be the lead partner (needs ${ctx.criteria.jvMinLeadPercent}%).`
        : `Turnover is ${turnoverPct.toFixed(0)}% of the requirement — enough to be a partner (${ctx.criteria.jvMinEachPercent}%) but not the lead (${ctx.criteria.jvMinLeadPercent}%).`);
  } else {
    result = 'NOT_ELIGIBLE';
    summary = `Not eligible: turnover is only ${turnoverPct.toFixed(0)}% of the requirement — every JV partner needs at least ${ctx.criteria.jvMinEachPercent}%.`;
  }

  const anyUnverifiedPass = checks.some((c) => c.status === 'PASS' && c.usesUnverified);
  if (anyUnverifiedPass) {
    warnings.add('Some passes depend on certificates whose document check is pending — verify them before bidding.');
  }

  return {
    engineVersion: ENGINE_VERSION,
    companyId: company.id,
    companyName: company.name,
    result,
    summary,
    suggestedJvRole,
    checks,
    warnings: [...warnings],
    numbers: {
      averageAnnualTurnover: turnover.average,
      bidCapacity: ctx.requiredBidCapacity === null && ctx.V === null ? null : capacity,
      currentCommitmentsB: commit.B,
      runningOpenBidContracts: commit.runningOpenBid,
    },
    certificatesUsed: certs.length,
    certificatesPendingDocumentCheck: pending,
    ruleSet: {
      id: ctx.ruleSet.id,
      name: ctx.ruleSet.name,
      effectiveFrom: ctx.ruleSet.effectiveFrom,
      notes: ctx.ruleSet.notes,
    },
    criteria: ctx.criteria,
    evaluatedAt: now.toISOString(),
    disclaimer: DISCLAIMER,
  };
}

// ------------------------------------------------------------------ JV

export interface JvPartnerInput {
  company: EngineCompany;
  share: number; // % in the proposed JV agreement
  isLead?: boolean;
}

export interface JvResult {
  engineVersion: string;
  result: 'JV_ELIGIBLE' | 'JV_NOT_ELIGIBLE';
  summary: string;
  partners: {
    companyId: string;
    companyName: string;
    share: number;
    isLead: boolean;
    averageAnnualTurnover: number;
    bidCapacity: number;
    runningOpenBidContracts: number;
  }[];
  checks: Check[];
  warnings: string[];
  ruleSet: { id: string; name: string; effectiveFrom: string; notes: string[] };
  criteria: CriteriaDefaults;
  evaluatedAt: string;
  disclaimer: string;
}

export function evaluateJv(
  tender: EngineTender,
  partnersIn: JvPartnerInput[],
  wpi: WpiLookup,
  now = new Date(),
): JvResult {
  const ctx = buildContext(tender, wpi, now);
  const c = ctx.criteria;
  const warnings = new Set<string>();
  const checks: Check[] = [];

  const partners = [...partnersIn];
  if (!partners.some((p) => p.isLead) && partners.length) {
    // default lead = biggest share
    const lead = partners.reduce((a, b) => (b.share > a.share ? b : a));
    lead.isLead = true;
  }

  const calc = partners.map((p) => {
    const u = usableCerts(ctx, p.company, warnings);
    const t = calcTurnover(ctx, p.company, u.certs, warnings);
    const cm = calcCommitments(ctx, p.company, warnings);
    return {
      p,
      certs: u.certs,
      turnover: t,
      commit: cm,
      capacity: c.bidCapacityMultiplier * t.average - cm.B,
    };
  });

  // JV structure
  {
    const total = partners.reduce((s, p) => s + p.share, 0);
    const problems: string[] = [];
    let status: CheckStatus = 'PASS';
    if (partners.length < 2) {
      problems.push('a JV needs at least 2 partners');
      status = 'FAIL';
    }
    if (partners.length > c.jvMaxPartners) {
      problems.push(`maximum ${c.jvMaxPartners} partners`);
      status = 'FAIL';
    }
    if (Math.abs(total - 100) > 0.01) {
      problems.push(`shares add up to ${total}% (must be 100%)`);
      status = 'FAIL';
    }
    const ids = new Set(partners.map((p) => p.company.id));
    if (ids.size !== partners.length) {
      problems.push('the same company is listed twice');
      status = 'FAIL';
    }
    const lead = partners.find((p) => p.isLead);
    if (status !== 'FAIL' && lead && partners.some((p) => p !== lead && p.share > lead.share)) {
      problems.push('another partner has a bigger share than the lead partner');
      status = 'WARN';
    }
    checks.push({
      code: 'JV_STRUCTURE',
      title: 'JV agreement structure',
      status,
      required: 100,
      actual: total,
      unit: '%',
      reason: problems.length
        ? `JV structure: ${problems.join('; ')}.`
        : `${partners.length} partners, shares ${partners.map((p) => p.share + '%').join(' / ')} = 100%. Lead: ${lead?.company.name}.`,
      jvCanHelp: false,
    });
  }

  // Licence + running contracts — every partner
  for (const x of calc) {
    const lic = x.p.company.licenseExpiry;
    if (lic && lic.getTime() < ctx.asOf.getTime()) {
      checks.push({
        code: 'LICENSE',
        title: `Licence valid — ${x.p.company.name}`,
        status: 'FAIL',
        required: null,
        actual: null,
        unit: 'date',
        reason: `${x.p.company.name}'s licence expired on ${lic.toISOString().slice(0, 10)}.`,
        jvCanHelp: false,
      });
    } else if (!lic) {
      warnings.add(`${x.p.company.name}: licence expiry date is not entered.`);
    }
  }
  {
    const failing = calc.filter((x) => x.commit.runningOpenBid >= c.maxRunningContracts);
    checks.push({
      code: 'RUNNING_CONTRACTS',
      title: `Every partner has fewer than ${c.maxRunningContracts} running open-bid contracts`,
      status: failing.length ? 'FAIL' : 'PASS',
      required: c.maxRunningContracts - 1,
      actual: Math.max(0, ...calc.map((x) => x.commit.runningOpenBid)),
      unit: 'contract(s)',
      reason: failing.length
        ? `${failing.map((x) => `${x.p.company.name} (${x.commit.runningOpenBid})`).join(', ')} already hold ${c.maxRunningContracts} or more running open-bid contracts.`
        : calc.map((x) => `${x.p.company.name}: ${x.commit.runningOpenBid}`).join(', ') + ' running open-bid contract(s).',
      jvCanHelp: false,
    });
  }

  // Turnover: combined 100%, each 25%, one (lead) 40%
  if (ctx.requiredTurnover !== null) {
    const R = ctx.requiredTurnover;
    const combined = calc.reduce((s, x) => s + x.turnover.average, 0);
    const lead = calc.find((x) => x.p.isLead)!;
    const problems: string[] = [];
    if (combined < R) problems.push(`combined ${NPR(combined)} is below ${NPR(R)}`);
    for (const x of calc) {
      if (x.turnover.average < (c.jvMinEachPercent / 100) * R) {
        problems.push(
          `${x.p.company.name} has ${((x.turnover.average / R) * 100).toFixed(0)}% (each partner needs ${c.jvMinEachPercent}%)`,
        );
      }
    }
    const anyLeadOk = calc.some((x) => x.turnover.average >= (c.jvMinLeadPercent / 100) * R);
    if (!anyLeadOk) problems.push(`no partner reaches ${c.jvMinLeadPercent}%`);
    else if (lead && lead.turnover.average < (c.jvMinLeadPercent / 100) * R) {
      warnings.add(
        `The lead partner ${lead.p.company.name} is below ${c.jvMinLeadPercent}% of the turnover requirement — make the partner that reaches ${c.jvMinLeadPercent}% the lead.`,
      );
    }
    checks.push({
      code: 'TURNOVER',
      title: `Turnover (combined 100%, each ${c.jvMinEachPercent}%, one ${c.jvMinLeadPercent}%)`,
      status: problems.length ? 'FAIL' : 'PASS',
      required: R,
      actual: combined,
      unit: 'NPR',
      reason: problems.length
        ? `Turnover: ${problems.join('; ')}.`
        : `Combined ${NPR(combined)} meets ${NPR(R)}; ` +
          calc.map((x) => `${x.p.company.name} ${((x.turnover.average / R) * 100).toFixed(0)}%`).join(', ') +
          '.',
      jvCanHelp: false,
      usesUnverified: calc.some((x) => x.turnover.usesUnverified),
      details: calc.map((x) => ({
        company: x.p.company.name,
        average: x.turnover.average,
        percentOfRequired: (x.turnover.average / R) * 100,
        source: x.turnover.source,
      })),
    });
  }

  // Bid capacity: combined
  if (ctx.requiredBidCapacity !== null) {
    const combined = calc.reduce((s, x) => s + x.capacity, 0);
    const ok = combined >= ctx.requiredBidCapacity;
    checks.push({
      code: 'BID_CAPACITY',
      title: 'Bid capacity (partners combined)',
      status: ok ? 'PASS' : 'FAIL',
      required: ctx.requiredBidCapacity,
      actual: combined,
      unit: 'NPR',
      reason:
        calc.map((x) => `${x.p.company.name} ${NPR(x.capacity)}`).join(' + ') +
        ` = ${NPR(combined)}` +
        (ok ? ` — meets ${NPR(ctx.requiredBidCapacity)}.` : ` — below ${NPR(ctx.requiredBidCapacity)}.`),
      jvCanHelp: false,
    });
  }

  // Similar contract
  if (ctx.requiredSimilarValue !== null) {
    const req = ctx.requiredSimilarValue;
    const per = calc.map((x) => {
      const cands = similarCandidates(ctx, x.certs, warnings);
      return {
        x,
        cands,
        meetsFull: cands.filter((s) => s.counted >= req).length >= ctx.requiredSimilarCount,
        hasAny: cands.length > 0,
      };
    });
    const fullMeeters = per.filter((p) => p.meetsFull);
    let ok: boolean;
    let reason: string;
    if (c.jvSimilarRule === 'EACH_AND_ONE') {
      const missing = per.filter((p) => !p.hasAny);
      ok = fullMeeters.length > 0 && missing.length === 0;
      reason = ok
        ? `Every partner has a similar contract and ${fullMeeters[0].x.p.company.name} meets the full ${NPR(req)} requirement (complex works rule).`
        : [
            fullMeeters.length ? '' : `no partner alone has a similar contract of ${NPR(req)}`,
            missing.length ? `${missing.map((m) => m.x.p.company.name).join(', ')} has no similar contract` : '',
          ]
            .filter(Boolean)
            .join('; ') + ' (complex works rule: each partner needs one similar contract, one partner the full value).';
    } else {
      ok = fullMeeters.length > 0;
      reason = ok
        ? `${fullMeeters[0].x.p.company.name} alone meets the similar contract requirement of ${NPR(req)} (one partner rule).`
        : `No single partner has ${ctx.requiredSimilarCount} similar contract(s) of at least ${NPR(req)} — the bid document requires one partner to meet it alone.`;
    }
    checks.push({
      code: 'SIMILAR_CONTRACT',
      title: c.jvSimilarRule === 'EACH_AND_ONE' ? 'Similar contract (each partner + one in full)' : 'Similar contract (one partner)',
      status: ok ? 'PASS' : 'FAIL',
      required: req,
      actual: Math.max(0, ...per.map((p) => p.cands[0]?.counted ?? 0)),
      unit: 'NPR',
      reason,
      jvCanHelp: false,
      details: per.map((p) => ({
        company: p.x.p.company.name,
        best: p.cands[0] ? { project: p.cands[0].project, counted: p.cands[0].counted } : null,
        meetsFull: p.meetsFull,
      })),
    });
  }

  // Key activities
  for (const req of ctx.tender.keyActivityReqs ?? []) {
    if (!req?.name || !(req.quantity > 0)) continue;
    const per = calc.map((x) => ({
      x,
      ...activityPerYear(ctx, x.certs, req, warnings, x.p.company.name),
    }));
    let ok: boolean;
    let actual: number;
    let reason: string;
    if (c.jvKeyActivityRule === 'ONE_PARTNER') {
      const bests = per.map((p) => ({ name: p.x.p.company.name, ...maxYear(p.perYear) }));
      const top = bests.reduce((a, b) => (b.qty > a.qty ? b : a), bests[0]);
      actual = top?.qty ?? 0;
      ok = actual >= req.quantity;
      reason = ok
        ? `${top.name} alone did ${QTY(actual)} ${req.unit} in FY ${top.fy} (required ${QTY(req.quantity)}).`
        : `No single partner reaches ${QTY(req.quantity)} ${req.unit} in one fiscal year (best: ${top?.name ?? '-'} ${QTY(actual)}).`;
    } else {
      const combined: Record<string, number> = {};
      for (const p of per) for (const [fy, q] of Object.entries(p.perYear)) combined[fy] = (combined[fy] ?? 0) + q;
      const best = maxYear(combined);
      actual = best.qty;
      ok = actual >= req.quantity;
      reason = ok
        ? `All partners together did ${QTY(actual)} ${req.unit} in FY ${best.fy} — meets ${QTY(req.quantity)} ${req.unit}.`
        : `All partners together reach ${QTY(actual)} ${req.unit} at best (FY ${best.fy ?? '-'}) — required ${QTY(req.quantity)} ${req.unit} in one fiscal year.`;
    }
    checks.push({
      code: 'KEY_ACTIVITY',
      title: `Key activity: ${req.name}${c.jvKeyActivityRule === 'COMBINED' ? ' (partners combined)' : ' (one partner)'}`,
      status: ok ? 'PASS' : 'FAIL',
      required: req.quantity,
      actual,
      unit: req.unit,
      reason,
      jvCanHelp: false,
      details: per.map((p) => ({ company: p.x.p.company.name, perYear: p.perYear })),
    });
  }

  const fails = checks.filter((x) => x.status === 'FAIL');
  const result: JvResult['result'] = fails.length ? 'JV_NOT_ELIGIBLE' : 'JV_ELIGIBLE';
  const summary = fails.length
    ? `This JV does not qualify: ${fails.map(failPhrase).join('; ')}.`
    : `This JV meets every entered requirement (${calc.map((x) => `${x.p.company.name} ${x.p.share}%`).join(' + ')}).`;

  return {
    engineVersion: ENGINE_VERSION,
    result,
    summary,
    partners: calc.map((x) => ({
      companyId: x.p.company.id,
      companyName: x.p.company.name,
      share: x.p.share,
      isLead: !!x.p.isLead,
      averageAnnualTurnover: x.turnover.average,
      bidCapacity: x.capacity,
      runningOpenBidContracts: x.commit.runningOpenBid,
    })),
    checks,
    warnings: [...warnings],
    ruleSet: {
      id: ctx.ruleSet.id,
      name: ctx.ruleSet.name,
      effectiveFrom: ctx.ruleSet.effectiveFrom,
      notes: ctx.ruleSet.notes,
    },
    criteria: c,
    evaluatedAt: now.toISOString(),
    disclaimer: DISCLAIMER,
  };
}

// ------------------------------------------------------ partner finder

export interface PartnerSuggestion {
  partnerId: string;
  partnerName: string;
  lead: string;
  shares: { lead: number; partner: number };
  result: JvResult['result'];
  passed: number;
  failed: number;
  combinedTurnover: number;
  summary: string;
}

/**
 * Try the base company with every other company (2-partner JV), both ways
 * round, with a 60/40 split. Ranks qualifying pairs first.
 */
export function findJvPartners(
  tender: EngineTender,
  base: EngineCompany,
  others: EngineCompany[],
  wpi: WpiLookup,
  now = new Date(),
): PartnerSuggestion[] {
  const out: PartnerSuggestion[] = [];
  for (const other of others) {
    if (other.id === base.id) continue;
    const options = [
      evaluateJv(tender, [{ company: base, share: 60, isLead: true }, { company: other, share: 40 }], wpi, now),
      evaluateJv(tender, [{ company: other, share: 60, isLead: true }, { company: base, share: 40 }], wpi, now),
    ];
    const score = (r: JvResult) => r.checks.filter((c) => c.status === 'PASS').length;
    const best = options.sort(
      (a, b) =>
        (a.result === 'JV_ELIGIBLE' ? 0 : 1) - (b.result === 'JV_ELIGIBLE' ? 0 : 1) || score(b) - score(a),
    )[0];
    const lead = best.partners.find((p) => p.isLead)!;
    out.push({
      partnerId: other.id,
      partnerName: other.name,
      lead: lead.companyName,
      shares: { lead: 60, partner: 40 },
      result: best.result,
      passed: score(best),
      failed: best.checks.filter((c) => c.status === 'FAIL').length,
      combinedTurnover: best.partners.reduce((s, p) => s + p.averageAnnualTurnover, 0),
      summary: best.summary,
    });
  }
  return out.sort(
    (a, b) =>
      (a.result === 'JV_ELIGIBLE' ? 0 : 1) - (b.result === 'JV_ELIGIBLE' ? 0 : 1) ||
      a.failed - b.failed ||
      b.combinedTurnover - a.combinedTurnover,
  );
}
