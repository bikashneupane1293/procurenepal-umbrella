// =====================================================================
// ProcureNepal — versioned qualification rule sets
// © Cuidado Technology Pvt. Ltd.
//
// Each rule set has an "effectiveFrom" date. A tender uses the rule set that
// was in force on its publication date (or the deadline if no publication
// date), unless the tender names one explicitly (tender.ruleSetId).
//
// Every number here is only a DEFAULT. A tender can override any of them in
// its "criteria" field, and the bid document always wins. Check each tender's
// IFB / Section III before relying on a result. Not legal advice.
// =====================================================================

export type JvSimilarRule = 'ONE_PARTNER' | 'EACH_AND_ONE';
export type JvKeyActivityRule = 'COMBINED' | 'ONE_PARTNER';
export type AwardMethod = 'AVERAGE' | 'LOWEST';

export interface CriteriaDefaults {
  /** Required turnover = multiplier × annualised estimate (when the IFB does not state an amount) */
  turnoverMultiplier: number;
  /** Best N years used for average annual construction turnover */
  turnoverBestYears: number;
  /**
   * How the best-N total is averaged when fewer than N years exist.
   * AVAILABLE_YEARS (default, same as the Phase 5.3 calculator): divide by the years found (max N).
   * FIXED: always divide by N. UNCONFIRMED which one e-GP uses — set per tender if the IFB says.
   */
  turnoverDivisor: 'AVAILABLE_YEARS' | 'FIXED';
  /** Look-back window (fiscal years) for turnover, similar contracts and key activities */
  lookbackYears: number;
  /** Similar contract value = this % of the estimate (when the IFB does not state an amount) */
  similarContractPercent: number;
  /** How many similar contracts are needed */
  similarContractCount: number;
  /** Count only the bidder's JV share of a past JV contract as similar experience.
   *  Default false — project rule (CLAUDE.md #5): JV share applies to turnover only. Set true if the IFB says so. */
  applyJvShareToSimilar: boolean;
  /** Bid capacity = multiplier × A − B */
  bidCapacityMultiplier: number;
  /** Required bid capacity = this % of the estimate (when the IFB does not state an amount) */
  bidCapacityPercent: number;
  /** Bidder must hold FEWER than this many running open-bid contracts */
  maxRunningContracts: number;
  /** Each JV partner must meet this % of the turnover requirement */
  jvMinEachPercent: number;
  /** One JV partner (lead) must meet this % of the turnover requirement */
  jvMinLeadPercent: number;
  /** Maximum number of partners in a JV */
  jvMaxPartners: number;
  /** Similar contract rule for JVs */
  jvSimilarRule: JvSimilarRule;
  /** Key activity rule for JVs */
  jvKeyActivityRule: JvKeyActivityRule;
  /** Count certificates whose document check is still pending (they are flagged) */
  countUnverified: boolean;
  /** Award method — used later by the price scenario tool */
  awardMethod: AwardMethod;
  /** Bids more than this % below the estimate are removed (average-bid method) */
  floorPercentBelowEstimate: number;
}

export interface RuleSet {
  id: string;
  name: string;
  effectiveFrom: string; // ISO date (AD)
  defaults: CriteriaDefaults;
  /**
   * Interim PPMO JV notice: for works above this estimate, a "complex" tender
   * uses EACH_AND_ONE for similar contracts. null = not applicable.
   */
  interimJvThreshold: number | null;
  notes: string[];
  references: string[];
}

const BASE: CriteriaDefaults = {
  turnoverMultiplier: 1.5,
  turnoverBestYears: 3,
  turnoverDivisor: 'AVAILABLE_YEARS',
  lookbackYears: 10,
  similarContractPercent: 40,
  similarContractCount: 1,
  applyJvShareToSimilar: false,
  bidCapacityMultiplier: 5,
  bidCapacityPercent: 100,
  maxRunningContracts: 5,
  jvMinEachPercent: 25,
  jvMinLeadPercent: 40,
  jvMaxPartners: 3,
  jvSimilarRule: 'ONE_PARTNER',
  jvKeyActivityRule: 'COMBINED',
  countUnverified: true,
  awardMethod: 'LOWEST',
  floorPercentBelowEstimate: 30,
};

export const RULE_SETS: RuleSet[] = [
  {
    id: 'PPMO-LEGACY',
    name: 'PPMO Standard Bidding Document (before 2083 changes)',
    effectiveFrom: '2000-01-01',
    defaults: { ...BASE },
    interimJvThreshold: null,
    notes: [
      'Turnover: average of best 3 of last 10 fiscal years, WPI-adjusted, excluding VAT.',
      'JV turnover: all partners combined 100%, each partner 25%, one partner 40%.',
      'JV similar contract: one partner must meet it. JV key activities: all partners combined.',
    ],
    references: [
      'PPMO SBD — Section III Evaluation and Qualification Criteria (ELI, FIN, EXP forms)',
    ],
  },
  {
    id: 'PPMO-2083-INTERIM',
    name: 'PPMO interim JV notice (2083/01/30)',
    effectiveFrom: '2026-05-13',
    defaults: { ...BASE },
    interimJvThreshold: 100_000_000,
    notes: [
      'Works above Rs 10 crore: general works — one JV partner needs a similar contract in 10 years.',
      'Complex works — each partner needs one similar contract and one partner must meet the full requirement.',
      'Applies until the final court verdict. Check the current status before bidding.',
    ],
    references: ['PPMO notice 2083/01/30 (interim, after the Supreme Court order on JVs)'],
  },
  {
    id: 'PPMO-2083-ACT',
    name: 'Public Procurement (Second Amendment) Act 2083',
    effectiveFrom: '2026-07-16',
    defaults: { ...BASE, awardMethod: 'AVERAGE' },
    interimJvThreshold: 100_000_000,
    notes: [
      'Award to the bid closest to the average (not above estimate); bids more than 30% below the estimate are removed.',
      'MDB-funded projects (World Bank / ADB) still use the lowest evaluated bid — set awardMethod per tender.',
      'Interim JV notice rules carried forward until replaced.',
    ],
    references: [
      'Public Procurement (Second Amendment) Act 2083',
      'Public Procurement Rules — 15th and 16th amendments 2083',
    ],
  },
];

export const DISCLAIMER =
  'This result is a guide calculated from the data you entered and the default PPMO rules. ' +
  'The bid document (IFB / Section III) always takes priority. Not legal advice.';

/** Pick the rule set in force on a date, or the one named explicitly. */
export function pickRuleSet(onDate: Date, explicitId?: string | null): RuleSet {
  if (explicitId) {
    const found = RULE_SETS.find((r) => r.id === explicitId);
    if (found) return found;
  }
  const t = onDate.getTime();
  const sorted = [...RULE_SETS].sort(
    (a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
  );
  return sorted.find((r) => new Date(r.effectiveFrom).getTime() <= t) ?? RULE_SETS[0];
}

/** Merge tender overrides on top of the rule set defaults (ignores unknown keys / bad values). */
export function resolveCriteria(
  ruleSet: RuleSet,
  overrides: Partial<CriteriaDefaults> | null | undefined,
): CriteriaDefaults {
  const out: CriteriaDefaults = { ...ruleSet.defaults };
  if (!overrides || typeof overrides !== 'object') return out;
  for (const key of Object.keys(out) as (keyof CriteriaDefaults)[]) {
    const v = (overrides as any)[key];
    if (v === undefined || v === null) continue;
    if (typeof out[key] === 'number' && typeof v === 'number' && isFinite(v) && v >= 0) {
      (out as any)[key] = v;
    } else if (typeof out[key] === 'boolean' && typeof v === 'boolean') {
      (out as any)[key] = v;
    } else if (typeof out[key] === 'string' && typeof v === 'string') {
      (out as any)[key] = v;
    }
  }
  return out;
}
