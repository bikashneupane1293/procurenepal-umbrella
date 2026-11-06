# Phase 6.4 — Qualification Engine v2 (rules, assumptions, API)

© Cuidado Technology Pvt. Ltd. · ProcureNepal · written 2026-11-06

The engine is a guide. **The bid document (IFB / Section III) always takes priority.** Every
default below can be overridden per tender (`criteria` field / "Advanced" section of the tender form).
Not legal advice.

## Where the code is

| Part | File |
|---|---|
| Rule sets (versioned defaults) | `api/src/qualification/engine/rule-sets.ts` |
| Fiscal year, unit and name helpers | `api/src/qualification/engine/fiscal-year.ts` |
| Pure engine (no database) | `api/src/qualification/engine/qualification-engine.ts` |
| Engine tests (48) | `api/src/qualification/engine/qualification-engine.spec.ts` |
| Loading data, JV, turnover table | `api/src/qualification/qualification.service.ts` |
| API tests (12, in-memory DB) | `api/test/qualification.e2e-spec.ts` + `api/test/fake-prisma.ts` |

## Rule sets (picked by tender publication date, or set explicitly)

| Id | From | Notes |
|---|---|---|
| `PPMO-LEGACY` | before 2026-05-13 | Award method default LOWEST |
| `PPMO-2083-INTERIM` | 2026-05-13 (2083/01/30 BS) | Interim JV notice: complex works > Rs 10 crore → similar contract EACH_AND_ONE |
| `PPMO-2083-ACT` | 2026-07-16 | Second Amendment Act 2083: award default AVERAGE (closest to average, 30% floor) |

## Checks for one bidder (each returns PASS / FAIL / WARN / NOT_REQUIRED and a reason)

1. **LICENSE** — licence expiry must be on/after the bid deadline. Missing expiry → WARN. Fail = hard (JV cannot fix).
2. **RUNNING_CONTRACTS** — in-progress certificates with "Open bid" ticked; bidder must hold **fewer than 5**. Hard fail.
3. **TURNOVER** — average annual construction turnover, best 3 of the last 10 fiscal years, WPI-adjusted.
   Source: audited turnover table (Companies → Turnover). If empty, estimated from certificates
   (value × JV share, in the certificate's fiscal year) with a warning.
   Required = IFB amount, else `1.5 × V × 12 ÷ max(12, T months)`.
4. **BID_CAPACITY** — `M × A − B`, M default 5, A = turnover above, B = Σ FIN-5 annual values of running contracts:
   `remaining work × JV share × 12 ÷ max(12, months to scheduled completion)`; completion date passed → 12 months.
   Required = IFB amount, else 100% of V.
5. **SIMILAR_CONTRACT** — N completed contracts (default 1) of the similar project types, within 10 years,
   value (final amount if entered, else contract amount) WPI-adjusted ≥ IFB amount, else 40% of V.
   JV share is **not** applied by default (CLAUDE.md rule 5).
6. **KEY_ACTIVITY** — for each required item (name + unit + quantity): quantities from certificates' Key Activities,
   summed **per fiscal year**, the **maximum single fiscal year** is compared. JV share not applied.
   Names match loosely ("Asphalt concrete" = "Asphalt Concrete (AC)"); units are normalised (m³ = cum = cu.m, MT = t).
   Different units are not counted and are reported.
7. **KEY_ACTIVITY_VALUE** — legacy value-based check from the old tender fields (`reqActivity`, `reqMinProduction`).

**Decision:** any hard fail → `NOT_ELIGIBLE`. All pass → `INDIVIDUAL_ELIGIBLE`. Otherwise, if turnover ≥ 25% of the
requirement → `JV_REQUIRED` (role LEAD if ≥ 40%, else PARTNER); below 25% → `NOT_ELIGIBLE`.

Certificates whose document check is pending are counted by default and **flagged** on every check they help pass
(`usesUnverified`), plus a warning. Set `countUnverified: false` on a tender to exclude them.

## JV rules (confirmed against a published Nepal IFB, Bagmati Municipality, Sarlahi)

| Requirement | JV rule |
|---|---|
| Turnover | all partners combined ≥ 100%, **each** partner ≥ 25%, **one** partner ≥ 40% |
| Similar contract | **one partner** must meet it alone (no adding up). Complex works > Rs 10 crore after 2083/01/30: each partner needs one similar contract **and** one partner the full value |
| Key activities | all partners **combined** (per fiscal year, then max year) — `jvKeyActivityRule` can be set to ONE_PARTNER |
| Bid capacity | partners combined |
| Running contracts, licence | **every** partner |
| Structure | 2–3 partners (configurable), shares total 100%, no duplicates; lead with a smaller share than another partner → WARN |

Partner finder: tries the company with every other company of the **same workspace** (60/40 both ways) and ranks
qualifying pairs first. No data from other customers is ever used.

## Assumptions / unconfirmed rules (configurable, flagged in the UI)

| Item | Default | Why unconfirmed | Override |
|---|---|---|---|
| Bid capacity multiplier | 5 (5A − B) | Calculators use 5 and 7; IFBs often state the required amount only | `bidCapacityMultiplier`, or enter the IFB amount |
| Required bid capacity | 100% of V | IFBs say 80–100% | `bidCapacityPercent` or IFB amount |
| Turnover average when < 3 years | divide by years available (same as Phase 5.3) | Not stated whether e-GP divides by 3 | `turnoverDivisor: FIXED` |
| JV share on similar contract | not applied | CLAUDE.md #5; some IFBs count only the share | `applyJvShareToSimilar: true` |
| Fiscal year change date | 16 July AD | Shrawan 1 is 16 or 17 July | — (affects one day a year) |
| WPI years after 2081/82 | factor 1.0 | WPI table ends at 2081/82 | update `wpi.service.ts` when NRB publishes |
| WPI year missing (older) | unadjusted + warning | not in the table | update the table |

## API (all need the JWT; all tenant-scoped)

| Method | Path | Purpose |
|---|---|---|
| POST/GET/PATCH/DELETE | `/tenders`, `/tenders/:id` | Tender CRUD (DELETE: Owner, Super Admin, Director) |
| POST | `/tenders/:id/evaluate/:companyId` | Evaluate one company and save |
| POST | `/tenders/:id/evaluate-all` | Evaluate every company, save, ranked |
| POST | `/tenders/:id/evaluate-jv` | `{ partners: [{ companyId, share, isLead? }] }` |
| GET | `/tenders/:id/jv-partners/:companyId` | Best partner finder |
| GET | `/tenders/:id/qualifications` | Saved results (history) with company names |
| POST | `/qualification/evaluate` | Quick check: `{ companyId, tenderId }` or old `{ companyId, requirements }` |
| GET | `/qualification/rules` | Rule sets and defaults |
| GET/PUT | `/companies/:id/turnovers` | Audited annual turnover (PUT replaces the whole table) |
| PATCH | `/companies/:id`, `/certificates/:id` | Edit (Phase 6.5) |

## Database changes (additive only — `npx prisma db push`, no data loss)

- `Tender`: contractPeriodMonths, reqBidCapacity, reqSimilarValue, reqSimilarCount, similarDescription,
  keyActivityReqs (Json), criteria (Json), isComplexWork (default false), awardMethod, ruleSetId, notes, updatedAt (default now)
- `Certificate`: outstandingAmount, isOpenBid (default true)
- `QualificationResult`: checks (Json), warnings (Json), ruleSetId
- New table `AnnualTurnover` (companyId + fiscalYear unique, cascade-deleted with the company)

## Final verification — 2026-11-06 (Node 24.22.1, Jest 30.5.2, Prisma 7.10.1)

| Step | Command (from `api/`) | Result |
|---|---|---|
| Schema validation | `npx prisma validate --config prisma7.config.ts` | valid |
| Client generation | `npx prisma generate` | Generated Prisma Client (7.10.1) |
| TypeScript (app + tests) | `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| Nest build | `npm run build` | exit 0 |
| Lint (changed folders) | `npx oxlint src/qualification src/tender src/certificate src/company test/*.e2e-spec.ts` | 0 warnings |
| Unit tests | `npm test` | 21/21 suites, 81/81 tests (engine: 60) |
| API tests (in-memory DB, Decimal columns) | `npm run test:e2e -- qualification verification` | 2/2 suites, 23/23 tests |
| Web production build | `cd ../web && ng build --configuration production` | complete, initial 463 kB |
| Browser workflow (sandbox) | Playwright vs built site + API | 29/29 checks; Accountant sees no ZIP/Delete |

`prisma format --check` reports "unformatted" — the schema was already unformatted before Phase 6.4 (spacing only), left unchanged.
Do **not** run plain `npm run test:e2e` against a real `.env`: the original `test/app.e2e-spec.ts` boots the real app and connects to the live database (read-only connect).

### Not implemented (engine does not check these — the user must check the bid document)
- Financial resources / liquid assets / credit line (FIN-4/FIN-5 "available financial resources" minimum).
- Personnel (key staff) and equipment requirements.
- History of non-performance, pending litigation, debarment / blacklisting (ELI).
- Licence **class** versus the class required for the estimate (only the expiry date is checked).
- PAN/VAT registration and tax clearance.
- Default "key activities ≥ 10% of estimate" rule (only quantities/values typed into the tender are checked).
- Role in past contracts (prime / JV member / sub-contractor / management contractor).
- Similar contract "nature and complexity" — matched only by project type; the description is not used.
- Award stage: closest-to-average with 30% floor, 50/50 technical-financial weighting above Rs 1.5 billion, bid/performance security amounts (awardMethod is stored only).
- Domestic preference, sub-contracting limits.

### Implemented but not confirmed against the official SBD (configurable per tender)
- Bid capacity formula M × A − B with M = 5; required capacity 100% of V (IFBs often state an amount — enter it).
- JV share applied to running-contract commitments (B) — reasonable but not confirmed.
- Turnover average when fewer than 3 years: divides by years available (Phase 5.3 behaviour); `FIXED` divides by 3.
- Look-back window: fiscal years from (current − 10) to current inclusive — 11 fiscal-year labels including the running one.
- Similar contract value uses final amount if entered, else contract amount; price adjustment excluded; WPI-adjusted; JV share not applied.
- Turnover estimated from certificates puts each certificate's whole value in its completion fiscal year (used only when audited turnover is missing; warned).
- Key-activity quantities from in-progress contracts are counted.
- Interim JV rule threshold (> Rs 10 crore) and dates of the three rule sets; fiscal year changes on 16 July (Shrawan 1 is 16 or 17 July).
- WPI for 2082/83 onward assumed 1.0 (table ends at 2081/82).
