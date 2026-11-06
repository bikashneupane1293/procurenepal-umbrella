import {
  EngineCertificate,
  EngineCompany,
  EngineTender,
  WpiLookup,
  evaluateJv,
  evaluateSingle,
  findJvPartners,
  calcCommitments,
  buildContext,
} from './qualification-engine';
import { pickRuleSet, resolveCriteria, RULE_SETS } from './rule-sets';
import { activityMatches, fyStart, fyStartForDate, normUnit } from './fiscal-year';

// WPI table identical to src/wpi/wpi.service.ts
const TABLE: Record<string, number> = {
  '2081/82': 156.8, '2080/81': 150.7, '2079/80': 145.1, '2078/79': 133.7,
  '2077/78': 122.2, '2076/77': 113.5, '2075/76': 106.2, '2074/75': 100.0, '2073/74': 98.3,
};
const wpi: WpiLookup = (fy) => {
  if (TABLE[fy]) return 156.8 / TABLE[fy];
  const s = fyStart(fy);
  return s !== null && s >= 2081 ? 1 : null;
};
const NOW = new Date('2026-11-06T00:00:00Z');
let seq = 0;
const cert = (o: Partial<EngineCertificate>): EngineCertificate => ({
  id: 'c' + ++seq,
  certificateId: 'CERT-' + seq,
  projectName: 'Project ' + seq,
  projectType: 'ROAD',
  fiscalYear: '2080/81',
  contractAmount: 0,
  jvShare: 100,
  completionStatus: 'completed',
  verificationStatus: 'verified',
  keyActivities: [],
  ...o,
});
const company = (o: Partial<EngineCompany>): EngineCompany => ({
  id: 'co' + ++seq,
  name: 'Company ' + seq,
  licenseClass: 'A',
  licenseExpiry: new Date('2028-01-01'),
  certificates: [],
  annualTurnovers: [],
  ...o,
});
const tender = (o: Partial<EngineTender> = {}): EngineTender => ({
  estimateAmount: 400_000_000,
  contractPeriodMonths: 24,
  publicationDate: new Date('2026-11-01'),
  deadlineDate: new Date('2026-12-01'),
  projectType: 'ROAD',
  ...o,
});
const check = (r: { checks: any[] }, code: string) => r.checks.find((c) => c.code === code);

describe('fiscal-year helpers', () => {
  it('parses and maps fiscal years', () => {
    expect(fyStart('2081/82')).toBe(2081);
    expect(fyStart('2081-82')).toBe(2081);
    expect(fyStart('81/82')).toBeNull();
    expect(fyStart('')).toBeNull();
    expect(fyStartForDate(new Date('2026-07-15'))).toBe(2082); // still FY 2082/83
    expect(fyStartForDate(new Date('2026-07-16'))).toBe(2083); // Shrawan 1 → FY 2083/84
    expect(fyStartForDate(new Date('2026-11-06'))).toBe(2083);
  });
  it('normalises units and activity names', () => {
    expect(normUnit('Cu.m')).toBe('m3');
    expect(normUnit('cum')).toBe('m3');
    expect(normUnit('m³')).toBe('m3');
    expect(normUnit('Sq.m')).toBe('m2');
    expect(normUnit('MT')).toBe('t');
    expect(normUnit('Nos.')).toBe('nos');
    expect(activityMatches('Asphalt concrete', 'ASPHALT CONCRETE (AC)')).toBe(true);
    expect(activityMatches('Asphalt concrete', 'Gabion wall')).toBe(false);
  });
});

describe('rule sets', () => {
  it('picks the rule set in force on the publication date', () => {
    expect(pickRuleSet(new Date('2025-01-01')).id).toBe('PPMO-LEGACY');
    expect(pickRuleSet(new Date('2026-06-01')).id).toBe('PPMO-2083-INTERIM');
    expect(pickRuleSet(new Date('2026-08-01')).id).toBe('PPMO-2083-ACT');
    expect(pickRuleSet(new Date('2026-08-01'), 'PPMO-LEGACY').id).toBe('PPMO-LEGACY');
    expect(pickRuleSet(new Date('2026-08-01'), 'UNKNOWN').id).toBe('PPMO-2083-ACT');
  });
  it('applies valid overrides and ignores invalid ones', () => {
    const c = resolveCriteria(RULE_SETS[2], {
      turnoverMultiplier: 1.0,
      maxRunningContracts: -3 as any,
      countUnverified: 'yes' as any,
      jvSimilarRule: 'EACH_AND_ONE',
    });
    expect(c.turnoverMultiplier).toBe(1.0);
    expect(c.maxRunningContracts).toBe(5);
    expect(c.countUnverified).toBe(true);
    expect(c.jvSimilarRule).toBe('EACH_AND_ONE');
  });
  it('2083 Act rule set defaults to average-bid award', () => {
    expect(RULE_SETS.find((r) => r.id === 'PPMO-2083-ACT')!.defaults.awardMethod).toBe('AVERAGE');
    expect(RULE_SETS.find((r) => r.id === 'PPMO-LEGACY')!.defaults.awardMethod).toBe('LOWEST');
  });
});

describe('single bidder — turnover', () => {
  it('reproduces the Phase 5.3 logged test (83.9M × 30% JV, 2078/79 → 29,518,157)', () => {
    const co = company({
      certificates: [cert({ contractAmount: 83_898_334, jvShare: 30, projectType: 'BUILDING', fiscalYear: '2078/79' })],
    });
    const r = evaluateSingle(
      { reqTurnover: 50_000_000, deadlineDate: new Date('2026-10-25'), publicationDate: new Date('2025-10-01') },
      co, wpi, NOW,
    );
    const t = check(r, 'TURNOVER');
    expect(Math.round(t.actual)).toBe(29_518_157);
    expect(t.status).toBe('FAIL');
    expect(t.details.source).toBe('CERTIFICATES');
    expect(r.result).toBe('JV_REQUIRED'); // 59% ≥ 40% → lead
    expect(r.suggestedJvRole).toBe('LEAD');
  });

  it('uses audited turnover, best 3 of the last 10 years, WPI-adjusted', () => {
    const co = company({
      annualTurnovers: [
        { fiscalYear: '2081/82', amount: 300e6 },
        { fiscalYear: '2080/81', amount: 250e6 },
        { fiscalYear: '2079/80', amount: 200e6 },
        { fiscalYear: '2078/79', amount: 100e6 },
        { fiscalYear: '2070/71', amount: 999e6 }, // outside the 10-year window
      ],
    });
    const r = evaluateSingle(tender(), co, wpi, NOW);
    const t = check(r, 'TURNOVER');
    const expected = (300e6 + 250e6 * (156.8 / 150.7) + 200e6 * (156.8 / 145.1)) / 3;
    expect(t.actual).toBeCloseTo(expected, 0);
    expect(t.required).toBe(300e6); // 1.5 × 400M × 12 / 24
    expect(t.details.source).toBe('AUDITED');
    expect(t.details.years.filter((y: any) => y.used)).toHaveLength(3);
  });

  it('boundary: exactly equal to the requirement passes', () => {
    const co = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 300e6 }] });
    const r = evaluateSingle(tender(), co, wpi, NOW);
    expect(check(r, 'TURNOVER').status).toBe('PASS');
    const r2 = evaluateSingle(tender(), company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 299_999_999 }] }), wpi, NOW);
    expect(check(r2, 'TURNOVER').status).toBe('FAIL');
  });

  it('FIXED divisor divides by 3 even with fewer years', () => {
    const co = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 300e6 }] });
    const r = evaluateSingle(tender({ criteria: { turnoverDivisor: 'FIXED' } }), co, wpi, NOW);
    expect(check(r, 'TURNOVER').actual).toBeCloseTo(100e6, 0);
    expect(r.warnings.join(' ')).toMatch(/divided by 3/);
  });

  it('explicit IFB turnover amount overrides the formula; contract period under 12 months counts as 12', () => {
    const r = evaluateSingle(tender({ reqTurnover: 63e7 }), company({}), wpi, NOW);
    expect(check(r, 'TURNOVER').required).toBe(63e7);
    const r2 = evaluateSingle(tender({ contractPeriodMonths: 6 }), company({}), wpi, NOW);
    expect(check(r2, 'TURNOVER').required).toBe(600e6); // 1.5 × 400M × 12/12
  });

  it('turnover below 25% → NOT_ELIGIBLE (cannot join a JV)', () => {
    const co = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 60e6 }] }); // 20%
    const r = evaluateSingle(tender(), co, wpi, NOW);
    expect(r.result).toBe('NOT_ELIGIBLE');
    expect(r.summary).toMatch(/only 20%/);
  });

  it('turnover between 25% and 40% → JV_REQUIRED as PARTNER', () => {
    const co = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 90e6 }] }); // 30%
    const r = evaluateSingle(tender(), co, wpi, NOW);
    expect(r.result).toBe('JV_REQUIRED');
    expect(r.suggestedJvRole).toBe('PARTNER');
  });

  it('unknown WPI year → amount used unadjusted with a warning', () => {
    const co = company({ annualTurnovers: [{ fiscalYear: '2072/73', amount: 10e6 }] });
    const r = evaluateSingle(tender({ criteria: { lookbackYears: 12 } }), co, wpi, NOW);
    expect(check(r, 'TURNOVER').actual).toBeCloseTo(10e6, 0);
    expect(r.warnings.join(' ')).toMatch(/No WPI index for FY 2072\/73/);
  });
});

describe('single bidder — bid capacity and FIN-5', () => {
  const runningCo = () =>
    company({
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 100e6 }],
      certificates: [
        // 60M outstanding, 11 months left → minimum 12 months → 60M a year
        cert({ completionStatus: 'in_progress', outstandingAmount: 60e6, completionDate: new Date('2027-11-01') }),
        // 48M outstanding, 24 months left → 24M a year
        cert({ completionStatus: 'in_progress', outstandingAmount: 48e6, completionDate: new Date('2028-12-01') }),
        // completion date passed → 12 months → 10M; JV share 50% → 5M
        cert({ completionStatus: 'in_progress', outstandingAmount: 10e6, jvShare: 50, completionDate: new Date('2025-01-01') }),
      ],
    });

  it('B = Σ outstanding × share × 12 ÷ max(12, remaining months)', () => {
    const ctx = buildContext(tender(), wpi, NOW);
    const cm = calcCommitments(ctx, runningCo(), new Set());
    expect(cm.B).toBeCloseTo(60e6 + 24e6 + 5e6, 0);
    expect(cm.running.map((r) => r.remainingMonths)).toEqual([12, 24, 12]);
  });

  it('capacity = 5 × A − B against 100% of the estimate', () => {
    const r = evaluateSingle(tender(), runningCo(), wpi, NOW);
    const b = check(r, 'BID_CAPACITY');
    expect(b.actual).toBeCloseTo(5 * 100e6 - 89e6, 0);
    expect(b.required).toBe(400e6);
    expect(b.status).toBe('PASS');
    expect(b.reason).toMatch(/5 × A/);
  });

  it('multiplier and required % are configurable; explicit IFB amount wins', () => {
    const r = evaluateSingle(tender({ criteria: { bidCapacityMultiplier: 2, bidCapacityPercent: 80 } }), runningCo(), wpi, NOW);
    const b = check(r, 'BID_CAPACITY');
    expect(b.actual).toBeCloseTo(200e6 - 89e6, 0);
    expect(b.required).toBe(320e6);
    expect(b.status).toBe('FAIL');
    const r2 = evaluateSingle(tender({ reqBidCapacity: 55e7 }), runningCo(), wpi, NOW);
    expect(check(r2, 'BID_CAPACITY').required).toBe(55e7);
  });

  it('missing outstanding amount is treated as 0 with a warning', () => {
    const co = company({ certificates: [cert({ completionStatus: 'in_progress', projectName: 'No Outstanding' })] });
    const r = evaluateSingle(tender(), co, wpi, NOW);
    expect(r.numbers.currentCommitmentsB).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/No Outstanding.*no outstanding/);
  });
});

describe('single bidder — running contracts (five-contract limit)', () => {
  const withRunning = (n: number, extra: Partial<EngineCertificate> = {}) =>
    company({
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 999e6 }],
      certificates: Array.from({ length: n }, () => cert({ completionStatus: 'in_progress', outstandingAmount: 0, ...extra })),
    });

  it('4 running → PASS, 5 running → FAIL and NOT_ELIGIBLE (JV cannot fix)', () => {
    expect(check(evaluateSingle(tender(), withRunning(4), wpi, NOW), 'RUNNING_CONTRACTS').status).toBe('PASS');
    const r = evaluateSingle(tender(), withRunning(5), wpi, NOW);
    expect(check(r, 'RUNNING_CONTRACTS').status).toBe('FAIL');
    expect(r.result).toBe('NOT_ELIGIBLE');
    expect(r.summary).toMatch(/JV cannot fix/);
  });

  it('contracts marked "not open bid" are excluded; completed contracts never count', () => {
    const co = withRunning(5, { isOpenBid: false });
    co.certificates.push(...Array.from({ length: 3 }, () => cert({ completionStatus: 'completed' })));
    expect(check(evaluateSingle(tender(), co, wpi, NOW), 'RUNNING_CONTRACTS').actual).toBe(0);
  });
});

describe('single bidder — similar contract', () => {
  it('needs a completed similar-type contract ≥ 40% of the estimate, WPI-adjusted', () => {
    const co = company({
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 999e6 }],
      certificates: [
        cert({ contractAmount: 155e6, fiscalYear: '2080/81' }), // ×1.0405 = 161.3M ≥ 160M
        cert({ contractAmount: 500e6, projectType: 'BUILDING' }), // wrong type
        cert({ contractAmount: 500e6, completionStatus: 'in_progress', outstandingAmount: 0 }), // not completed
      ],
    });
    const r = evaluateSingle(tender(), co, wpi, NOW);
    const s = check(r, 'SIMILAR_CONTRACT');
    expect(s.required).toBe(160e6);
    expect(s.status).toBe('PASS');
    expect(s.details.candidates).toHaveLength(1);
  });

  it('JV share is NOT applied by default (CLAUDE.md rule 5) but can be switched on', () => {
    const co = company({ certificates: [cert({ contractAmount: 200e6, jvShare: 50, fiscalYear: '2081/82' })] });
    expect(check(evaluateSingle(tender(), co, wpi, NOW), 'SIMILAR_CONTRACT').status).toBe('PASS');
    const r = evaluateSingle(tender({ criteria: { applyJvShareToSimilar: true } }), co, wpi, NOW);
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('FAIL');
    expect(check(r, 'SIMILAR_CONTRACT').actual).toBeCloseTo(100e6, 0);
  });

  it('final amount is used when present; contracts older than the look-back are ignored', () => {
    const co = company({
      certificates: [
        cert({ contractAmount: 100e6, finalAmount: 170e6, fiscalYear: '2081/82' }),
        cert({ contractAmount: 900e6, fiscalYear: '2070/71' }),
      ],
    });
    const s = check(evaluateSingle(tender(), co, wpi, NOW), 'SIMILAR_CONTRACT');
    expect(s.actual).toBe(170e6);
    expect(s.details.candidates).toHaveLength(1);
  });

  it('requires the stated number of contracts', () => {
    const co = company({ certificates: [cert({ contractAmount: 200e6, fiscalYear: '2081/82' })] });
    const s = check(evaluateSingle(tender({ reqSimilarCount: 2 }), co, wpi, NOW), 'SIMILAR_CONTRACT');
    expect(s.status).toBe('FAIL');
    expect(s.reason).toMatch(/Needs 2/);
  });
});

describe('single bidder — key activities by fiscal year', () => {
  const kaTender = tender({ keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1200 }] });

  it('uses the MAX single fiscal year (summed across certificates), not an average, and no JV share', () => {
    const co = company({
      certificates: [
        cert({ jvShare: 30, keyActivities: [
          { name: 'Asphalt Concrete', unit: 'cum', fiscalYear: '2080/81', quantity: 900 },
          { name: 'asphalt concrete', unit: 'm3', fiscalYear: '2079/80', quantity: 1100 },
        ] }),
        cert({ keyActivities: [{ name: 'Asphalt concrete (AC)', unit: 'Cu.m', fiscalYear: '2080/81', quantity: 300 }] }),
      ],
    });
    const k = check(evaluateSingle(kaTender, co, wpi, NOW), 'KEY_ACTIVITY');
    expect(k.actual).toBe(1200);
    expect(k.details.bestFiscalYear).toBe('2080/81');
    expect(k.status).toBe('PASS');
  });

  it('different units are not counted and are reported', () => {
    const co = company({
      certificates: [cert({ keyActivities: [{ name: 'Asphalt concrete', unit: 'm2', fiscalYear: '2080/81', quantity: 5000 }] })],
    });
    const r = evaluateSingle(kaTender, co, wpi, NOW);
    expect(check(r, 'KEY_ACTIVITY').actual).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/is in "m2" but the tender asks for "m3"/);
  });

  it('explains when nothing matches', () => {
    const k = check(evaluateSingle(kaTender, company({}), wpi, NOW), 'KEY_ACTIVITY');
    expect(k.status).toBe('FAIL');
    expect(k.reason).toMatch(/No "Asphalt concrete" \(m3\) found/);
  });

  it('legacy value-based key activity still works (MAX year, no JV share)', () => {
    const co = company({
      certificates: [
        cert({ contractAmount: 40e6, jvShare: 30, fiscalYear: '2080/81', activities: ['Road'] }),
        cert({ contractAmount: 30e6, fiscalYear: '2080/81', activities: ['Road'] }),
        cert({ contractAmount: 50e6, fiscalYear: '2079/80', activities: ['Road'] }),
      ],
    });
    const k = check(
      evaluateSingle(tender({ legacyActivity: { name: 'Road', minValue: 60e6 } }), co, wpi, NOW),
      'KEY_ACTIVITY_VALUE',
    );
    expect(k.actual).toBe(70e6);
    expect(k.status).toBe('PASS');
  });
});

describe('single bidder — documents, licence, missing information', () => {
  it('flags passes that depend on unverified certificates', () => {
    const co = company({ certificates: [cert({ contractAmount: 200e6, fiscalYear: '2081/82', verificationStatus: 'unverified' })] });
    const r = evaluateSingle(tender(), co, wpi, NOW);
    expect(check(r, 'SIMILAR_CONTRACT').usesUnverified).toBe(true);
    expect(r.certificatesPendingDocumentCheck).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/document check is still pending/);
  });

  it('countUnverified=false excludes unverified certificates', () => {
    const co = company({ certificates: [cert({ contractAmount: 200e6, fiscalYear: '2081/82', verificationStatus: 'unverified' })] });
    const r = evaluateSingle(tender({ criteria: { countUnverified: false } }), co, wpi, NOW);
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('FAIL');
    expect(r.certificatesUsed).toBe(0);
  });

  it('expired licence → NOT_ELIGIBLE; missing licence → warning only', () => {
    const r = evaluateSingle(tender(), company({ licenseExpiry: new Date('2026-11-30') }), wpi, NOW);
    expect(check(r, 'LICENSE').status).toBe('FAIL');
    expect(r.result).toBe('NOT_ELIGIBLE');
    const r2 = evaluateSingle(tender(), company({ licenseExpiry: null }), wpi, NOW);
    expect(check(r2, 'LICENSE').status).toBe('WARN');
  });

  it('summaries use plain failure phrases and honest year counts', () => {
    const r = evaluateSingle(tender(), company({ licenseExpiry: new Date('2026-11-30') }), wpi, NOW);
    expect(r.summary).toBe('Not eligible: the contractor licence expires before the bid deadline. A JV cannot fix this.');
    const two = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 100e6 }, { fiscalYear: '2080/81', amount: 100e6 }] });
    expect(check(evaluateSingle(tender(), two, wpi, NOW), 'TURNOVER').reason).toMatch(/^Average of the 2 available years/);
    expect(check(evaluateSingle(tender(), company({}), wpi, NOW), 'TURNOVER').reason).toMatch(/^No turnover found/);
  });

  it('a tender with no requirements says so instead of claiming full qualification', () => {
    const r = evaluateSingle({ deadlineDate: new Date('2026-12-01') }, company({}), wpi, NOW);
    expect(r.result).toBe('INDIVIDUAL_ELIGIBLE');
    expect(r.summary).toMatch(/No turnover, similar contract or key activity requirement/);
    expect(check(r, 'TURNOVER').status).toBe('NOT_REQUIRED');
  });

  it('every check carries a reason', () => {
    const r = evaluateSingle(tender({ keyActivityReqs: [{ name: 'X', unit: 'm', quantity: 1 }] }), company({}), wpi, NOW);
    for (const c of r.checks) expect(c.reason.length).toBeGreaterThan(10);
    expect(r.disclaimer).toMatch(/Not legal advice/);
  });
});

describe('joint venture', () => {
  const big = tender({ estimateAmount: 900e6, keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1200 }] });
  // required turnover = 1.5 × 900M × 12/24 = 675M
  const lead = () =>
    company({
      name: 'Lead Co',
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 450e6 }], // 66.7%
      certificates: [cert({ contractAmount: 400e6, fiscalYear: '2081/82', keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2080/81', quantity: 800 }] })],
    });
  const partner = () =>
    company({
      name: 'Partner Co',
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 250e6 }], // 37%
      certificates: [cert({ contractAmount: 50e6, fiscalYear: '2081/82', keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2080/81', quantity: 500 }] })],
    });

  it('qualifies when combined ≥ 100%, each ≥ 25%, one ≥ 40%, one partner meets similar, key activities combined', () => {
    const r = evaluateJv(big, [{ company: lead(), share: 60, isLead: true }, { company: partner(), share: 40 }], wpi, NOW);
    expect(r.result).toBe('JV_ELIGIBLE');
    expect(check(r, 'TURNOVER').status).toBe('PASS');
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('PASS');
    expect(check(r, 'KEY_ACTIVITY').actual).toBe(1300);
  });

  it('fails when a partner is below 25% even if combined is enough', () => {
    const tiny = company({ name: 'Tiny', annualTurnovers: [{ fiscalYear: '2081/82', amount: 160e6 }] }); // 23.7%
    const huge = company({ name: 'Huge', annualTurnovers: [{ fiscalYear: '2081/82', amount: 900e6 }] });
    const r = evaluateJv(big, [{ company: huge, share: 70, isLead: true }, { company: tiny, share: 30 }], wpi, NOW);
    expect(check(r, 'TURNOVER').status).toBe('FAIL');
    expect(check(r, 'TURNOVER').reason).toMatch(/Tiny has 24%/);
  });

  it('fails when no partner reaches 40%', () => {
    const a = company({ name: 'A', annualTurnovers: [{ fiscalYear: '2081/82', amount: 260e6 }] });
    const b = company({ name: 'B', annualTurnovers: [{ fiscalYear: '2081/82', amount: 260e6 }] });
    const c = company({ name: 'C', annualTurnovers: [{ fiscalYear: '2081/82', amount: 200e6 }] });
    const r = evaluateJv(big, [{ company: a, share: 40, isLead: true }, { company: b, share: 35 }, { company: c, share: 25 }], wpi, NOW);
    expect(check(r, 'TURNOVER').reason).toMatch(/no partner reaches 40%/);
  });

  it('similar contract must be met by ONE partner alone (no adding up)', () => {
    const p1 = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 500e6 }], certificates: [cert({ contractAmount: 200e6, fiscalYear: '2081/82' })] });
    const p2 = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 300e6 }], certificates: [cert({ contractAmount: 200e6, fiscalYear: '2081/82' })] });
    const r = evaluateJv(big, [{ company: p1, share: 60, isLead: true }, { company: p2, share: 40 }], wpi, NOW);
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('FAIL'); // needs 360M from one partner
  });

  it('complex works above Rs 10 crore use the interim EACH_AND_ONE rule', () => {
    const r = evaluateJv({ ...big, isComplexWork: true }, [{ company: lead(), share: 60, isLead: true }, { company: partner(), share: 40 }], wpi, NOW);
    expect(r.criteria.jvSimilarRule).toBe('EACH_AND_ONE');
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('PASS'); // partner has a ROAD contract, lead meets full
    const noSimilarPartner = company({ name: 'NoExp', annualTurnovers: [{ fiscalYear: '2081/82', amount: 300e6 }] });
    const r2 = evaluateJv({ ...big, isComplexWork: true }, [{ company: lead(), share: 60, isLead: true }, { company: noSimilarPartner, share: 40 }], wpi, NOW);
    expect(check(r2, 'SIMILAR_CONTRACT').reason).toMatch(/NoExp has no similar contract/);
    // legacy rule set (before the interim notice) keeps ONE_PARTNER
    const r3 = evaluateJv({ ...big, isComplexWork: true, publicationDate: new Date('2025-01-01') }, [{ company: lead(), share: 60, isLead: true }, { company: noSimilarPartner, share: 40 }], wpi, NOW);
    expect(r3.criteria.jvSimilarRule).toBe('ONE_PARTNER');
  });

  it('structure: shares must total 100, max partners, no duplicates', () => {
    const l = lead();
    expect(check(evaluateJv(big, [{ company: l, share: 70 }, { company: partner(), share: 20 }], wpi, NOW), 'JV_STRUCTURE').status).toBe('FAIL');
    expect(check(evaluateJv(big, [{ company: l, share: 50 }, { company: l, share: 50 }], wpi, NOW), 'JV_STRUCTURE').reason).toMatch(/twice/);
    const four = [1, 2, 3, 4].map(() => ({ company: partner(), share: 25 }));
    expect(check(evaluateJv(big, four, wpi, NOW), 'JV_STRUCTURE').reason).toMatch(/maximum 3 partners/);
  });

  it('every partner must pass the running-contract limit', () => {
    const busy = partner();
    busy.certificates.push(...Array.from({ length: 5 }, () => cert({ completionStatus: 'in_progress', outstandingAmount: 0 })));
    const r = evaluateJv(big, [{ company: lead(), share: 60, isLead: true }, { company: busy, share: 40 }], wpi, NOW);
    expect(check(r, 'RUNNING_CONTRACTS').status).toBe('FAIL');
    expect(r.result).toBe('JV_NOT_ELIGIBLE');
  });

  it('key activity ONE_PARTNER rule can be selected', () => {
    const r = evaluateJv({ ...big, criteria: { jvKeyActivityRule: 'ONE_PARTNER' } }, [{ company: lead(), share: 60, isLead: true }, { company: partner(), share: 40 }], wpi, NOW);
    expect(check(r, 'KEY_ACTIVITY').status).toBe('FAIL');
    expect(check(r, 'KEY_ACTIVITY').actual).toBe(800);
  });

  it('partner finder ranks qualifying partners first', () => {
    const base = lead();
    const good = partner();
    const weak = company({ name: 'Weak', annualTurnovers: [{ fiscalYear: '2081/82', amount: 10e6 }] });
    const list = findJvPartners(big, base, [base, weak, good], wpi, NOW);
    expect(list).toHaveLength(2);
    expect(list[0].partnerName).toBe('Partner Co');
    expect(list[0].result).toBe('JV_ELIGIBLE');
    expect(list[0].lead).toBe('Lead Co');
    expect(list[1].result).toBe('JV_NOT_ELIGIBLE');
  });
});

// ---------------------------------------------------------------------------
// Final verification (2026-11-06): boundaries, missing data, explanation accuracy
// ---------------------------------------------------------------------------
describe('verification — FIN-5 boundaries', () => {
  const ctx = buildContext(tender(), wpi, NOW); // as-of = deadline 2026-12-01
  const one = (o: Partial<EngineCertificate>) =>
    calcCommitments(ctx, company({ certificates: [cert({ completionStatus: 'in_progress', ...o })] }), new Set());

  it('exactly 12 months remaining → outstanding × 12 / 12', () => {
    expect(one({ outstandingAmount: 12e6, completionDate: new Date('2027-12-01') }).B).toBeCloseTo(12e6, 0);
  });
  it('36 months remaining → one third a year', () => {
    expect(one({ outstandingAmount: 36e6, completionDate: new Date('2029-12-01') }).B).toBeCloseTo(12e6, 0);
  });
  it('1 month remaining → minimum 12 months (not ×12)', () => {
    expect(one({ outstandingAmount: 6e6, completionDate: new Date('2027-01-01') }).B).toBeCloseTo(6e6, 0);
  });
  it('no completion date → 12 months', () => {
    expect(one({ outstandingAmount: 9e6, completionDate: null }).B).toBeCloseTo(9e6, 0);
  });
  it('JV share reduces own commitment', () => {
    expect(one({ outstandingAmount: 10e6, jvShare: 40, completionDate: null }).B).toBeCloseTo(4e6, 0);
  });
  it('completed / substantially completed contracts are not commitments', () => {
    const cm = calcCommitments(ctx, company({ certificates: [
      cert({ completionStatus: 'completed', outstandingAmount: 50e6 }),
      cert({ completionStatus: 'substantially_completed', outstandingAmount: 50e6 }),
    ] }), new Set());
    expect(cm.B).toBe(0);
    expect(cm.runningOpenBid).toBe(0);
  });
});

describe('verification — bid capacity explanation numbers are exact', () => {
  it('reason shows A, B and capacity that match actual/required', () => {
    const co = company({
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 100e6 }],
      certificates: [cert({ completionStatus: 'in_progress', outstandingAmount: 24e6, completionDate: new Date('2028-12-01') })],
    });
    const b = check(evaluateSingle(tender(), co, wpi, NOW), 'BID_CAPACITY');
    expect(b.actual).toBeCloseTo(500e6 - 12e6, 0);
    expect(b.reason).toBe('5 × A (Rs 10,00,00,000) − B (Rs 1,20,00,000) = Rs 48,80,00,000 — meets the required Rs 40,00,00,000.');
    expect(b.details.fin5[0]).toMatchObject({ remainingMonths: 24, annualValue: 12e6 });
  });
});

describe('verification — five-contract limit boundary with mixed contracts', () => {
  it('4 open-bid + 3 excluded + 2 completed → PASS; one more open-bid → FAIL', () => {
    const certs = [
      ...Array.from({ length: 4 }, () => cert({ completionStatus: 'in_progress', outstandingAmount: 0 })),
      ...Array.from({ length: 3 }, () => cert({ completionStatus: 'in_progress', outstandingAmount: 0, isOpenBid: false })),
      ...Array.from({ length: 2 }, () => cert({ completionStatus: 'substantially_completed' })),
    ];
    const r1 = evaluateSingle(tender(), company({ certificates: certs }), wpi, NOW);
    expect(check(r1, 'RUNNING_CONTRACTS')).toMatchObject({ status: 'PASS', actual: 4 });
    certs.push(cert({ completionStatus: 'in_progress', outstandingAmount: 0, isOpenBid: null }));
    const r2 = evaluateSingle(tender(), company({ certificates: certs }), wpi, NOW);
    expect(check(r2, 'RUNNING_CONTRACTS')).toMatchObject({ status: 'FAIL', actual: 5 });
    expect(check(r2, 'RUNNING_CONTRACTS').jvCanHelp).toBe(false);
  });
});

describe('verification — annual key-activity quantities', () => {
  const t = tender({ keyActivityReqs: [
    { name: 'Asphalt concrete', unit: 'm3', quantity: 1000 },
    { name: 'Gabion wall', unit: 'm3', quantity: 500 },
  ] });
  it('each activity evaluated separately; quantities never averaged; outside look-back ignored', () => {
    const co = company({ certificates: [
      cert({ keyActivities: [
        { name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2081/82', quantity: 600 },
        { name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2080/81', quantity: 600 },
        { name: 'Gabion wall', unit: 'm3', fiscalYear: '2070/71', quantity: 9999 }, // too old
        { name: 'Gabion wall', unit: 'm3', fiscalYear: '2081/82', quantity: 500 },
      ] }),
      cert({ completionStatus: 'in_progress', outstandingAmount: 0, keyActivities: [
        { name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2081/82', quantity: 400 }, // ongoing work counts
      ] }),
    ] });
    const r = evaluateSingle(t, co, wpi, NOW);
    const ka = r.checks.filter((c) => c.code === 'KEY_ACTIVITY');
    expect(ka).toHaveLength(2);
    expect(ka[0]).toMatchObject({ status: 'PASS', actual: 1000, required: 1000 }); // 600 + 400 in 2081/82
    expect(ka[0].details.perYear).toEqual({ '2081/82': 1000, '2080/81': 600 });
    expect(ka[1]).toMatchObject({ status: 'PASS', actual: 500 });
    expect(ka[1].details.perYear['2070/71']).toBeUndefined();
  });
  it('a failing key activity alone → JV_REQUIRED with the exact shortfall in the reason', () => {
    const co = company({ certificates: [cert({ keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2081/82', quantity: 750 }] })] });
    const r = evaluateSingle(tender({ keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1000 }] }), co, wpi, NOW);
    const k = check(r, 'KEY_ACTIVITY');
    expect(k.reason).toBe('Best fiscal year is 2081/82 with 750 m3 — required 1,000 m3 in one fiscal year (short by 250).');
  });
});

describe('verification — missing and unverified certificates', () => {
  it('company with no certificates and no turnover: every requirement fails with a reason, nothing crashes', () => {
    const r = evaluateSingle(tender({ keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1 }] }), company({}), wpi, NOW);
    expect(r.certificatesUsed).toBe(0);
    expect(r.result).toBe('NOT_ELIGIBLE');
    expect(check(r, 'TURNOVER').reason).toMatch(/^No turnover found/);
    expect(check(r, 'SIMILAR_CONTRACT').reason).toMatch(/^No completed ROAD contract/);
    expect(check(r, 'KEY_ACTIVITY').reason).toMatch(/^No "Asphalt concrete" \(m3\) found/);
    expect(r.numbers.averageAnnualTurnover).toBe(0);
  });
  it('turnover estimated from unverified certificates is flagged on TURNOVER and BID_CAPACITY', () => {
    const co = company({ certificates: [cert({ contractAmount: 400e6, fiscalYear: '2081/82', verificationStatus: 'unverified' })] });
    const r = evaluateSingle(tender(), co, wpi, NOW);
    expect(check(r, 'TURNOVER').usesUnverified).toBe(true);
    expect(check(r, 'BID_CAPACITY').usesUnverified).toBe(true);
    expect(check(r, 'TURNOVER').details.source).toBe('CERTIFICATES');
  });
  it('audited turnover is NOT flagged as unverified even if certificates are unchecked', () => {
    const co = company({
      annualTurnovers: [{ fiscalYear: '2081/82', amount: 400e6 }],
      certificates: [cert({ contractAmount: 1e6, verificationStatus: 'unverified' })],
    });
    expect(check(evaluateSingle(tender(), co, wpi, NOW), 'TURNOVER').usesUnverified).toBe(false);
  });
  it('key activity pass from an unverified certificate is flagged', () => {
    const co = company({ certificates: [cert({ verificationStatus: 'unverified', keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2081/82', quantity: 2000 }] })] });
    const k = check(evaluateSingle(tender({ keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1000 }] }), co, wpi, NOW), 'KEY_ACTIVITY');
    expect(k).toMatchObject({ status: 'PASS', usesUnverified: true });
  });
  it('JV excludes unverified certificates of every partner when countUnverified=false', () => {
    const a = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 900e6 }], certificates: [cert({ contractAmount: 900e6, fiscalYear: '2081/82', verificationStatus: 'unverified' })] });
    const b = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 300e6 }] });
    const r = evaluateJv(tender({ estimateAmount: 900e6, criteria: { countUnverified: false } }), [{ company: a, share: 60, isLead: true }, { company: b, share: 40 }], wpi, NOW);
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('FAIL');
    expect(r.warnings.join(' ')).toMatch(/not counted because their document check is pending/);
  });
});

describe('verification — JV individually vs combined', () => {
  const big = tender({ estimateAmount: 900e6 }); // turnover req 675M, capacity 900M, similar 360M
  it('JV partner with expired licence fails the JV', () => {
    const a = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 500e6 }], certificates: [cert({ contractAmount: 400e6, fiscalYear: '2081/82' })] });
    const b = company({ name: 'Expired Co', licenseExpiry: new Date('2026-11-15'), annualTurnovers: [{ fiscalYear: '2081/82', amount: 300e6 }] });
    const r = evaluateJv(big, [{ company: a, share: 60, isLead: true }, { company: b, share: 40 }], wpi, NOW);
    expect(r.result).toBe('JV_NOT_ELIGIBLE');
    expect(r.checks.find((c) => c.code === 'LICENSE')!.reason).toMatch(/Expired Co's licence expired/);
  });
  it('exact JV boundaries pass: each 25%, one 40%, combined 100%', () => {
    const R = 675e6;
    const lead = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 0.4 * R }], certificates: [cert({ contractAmount: 360e6, fiscalYear: '2081/82' })] });
    const p2 = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 0.35 * R }] });
    const p3 = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 0.25 * R }] });
    const r = evaluateJv(big, [{ company: lead, share: 40, isLead: true }, { company: p2, share: 35 }, { company: p3, share: 25 }], wpi, NOW);
    expect(check(r, 'TURNOVER').status).toBe('PASS');
    expect(check(r, 'SIMILAR_CONTRACT').status).toBe('PASS');
    expect(r.result).toBe('JV_ELIGIBLE');
  });
  it('the same companies evaluated singly show JV_REQUIRED / roles consistent with JV result', () => {
    const lead = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 400e6 }] }); // 59%
    const minor = company({ annualTurnovers: [{ fiscalYear: '2081/82', amount: 200e6 }] }); // 30%
    expect(evaluateSingle(big, lead, wpi, NOW).suggestedJvRole).toBe('LEAD');
    expect(evaluateSingle(big, minor, wpi, NOW).suggestedJvRole).toBe('PARTNER');
  });
});
