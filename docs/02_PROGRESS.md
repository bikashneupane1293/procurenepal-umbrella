# ProcureNepal — Technical Progress

© Cuidado Technology Pvt. Ltd. · last updated 2026-11-06 (Phases 6.4A, 6.4B, 6.5)
Master log for Bikash is also kept in the claude.ai project "PROCURENEPAL.COM" (claude/PROGRESS.md).

## Status

| Phase | Item | Status |
|---|---|---|
| 1–5.5 | Setup, auth, multi-tenant, companies, certificates, WPI/turnover, qualification v1, tenders | ✅ live |
| 6–6.3d | Angular UI: login, dashboard, companies, certificates, Excel import/export, Owner-only ZIP + delete | ✅ live |
| **6.4A** | Qualification engine v2: rule sets, bid capacity + FIN-5, 5-contract limit, JV 100/25/40, key activities per FY, unverified flags, partner finder, audited turnover table | ✅ code + tests, ⏳ not deployed |
| **6.4B** | Tender list/form (requirements, key activities, advanced overrides), tender workspace (check all, details, JV builder, partner finder, history, Excel report, print), Qualification quick-check page | ✅ code + browser tests, ⏳ not deployed |
| **6.5 (part)** | Edit company / certificate (PATCH), BS ⇄ AD date fields everywhere, BS dates in Excel import, remaining-work + open-bid on running contracts, turnover in ZIP backup | ✅ code + tests, ⏳ not deployed |
| **6.5b** | Excel import/export/template on Companies, Turnover, Tenders; Read-from-PDF (pdf.js, in the browser) for tender + certificate forms | ✅ tested locally by Bikash, ⏳ not deployed |
| **6.5c** | ERP menu (7 modules, planned items marked Soon with their data links), Bolpatra overview page with templates table, User Setup (add/edit users, roles, per-user modules, block), workspace module activation (TenantFeatureFlag `module:<key>`), server-side ModuleGuard on Bolpatra APIs, Qualification for all / several companies | ✅ code + tests, ⏳ needs `db push` (User.modules) |

## Tests (run on 2026-11-06)

| Suite | Command (from `api/`) | Result |
|---|---|---|
| All unit specs (incl. 60 engine tests) | `npm test` | 81 passed (21 suites) — final verification |
| API (real NestJS, validation, JWT, in-memory DB with Decimal columns) | `npm run test:e2e -- access qualification verification` | 29 passed (3 suites) |
| Browser (sandbox, Playwright) | workflow 29 + Excel/PDF 21 + ERP/User Setup 25 | 75 checks passed |
| Browser (Playwright against built site + API) | sandbox only | 29 checks passed; Accountant role sees no ZIP/Delete |

Note: Jest needs **Node 24.9+** for the NestJS 12 (ESM) API tests. The engine tests run on Node 22 too.

## Final verification
See `docs/PHASE_6.4_QUALIFICATION_ENGINE.md` → "Final verification" for commands, results and the list of unimplemented / unconfirmed rules. Four original scaffold specs (auth, turnover) were failing before Phase 6.4 because they had no test providers; fixed.

## Access model (6.5c)
- Module keys: companies (core, always on), bolpatra, procurement, fleet, hr, project, bank — `api/src/access/module-registry.ts` and `web/src/app/core/modules.ts` must stay in sync.
- Workspace: Owner switches modules on/off (`PUT /access/workspace-modules`); no saved setting = on.
- User: `User.modules` (empty = every active module). Owner / Super Admin always get every active module.
- `GET /access/me` builds the menu; `ModuleGuard` + `@RequireModule('bolpatra')` blocks the API (Tender, Certificate, Qualification controllers). Companies is never blocked.
- User Setup: `GET /users` (Owner, Super Admin, Director), `POST /users`, `PATCH /users/:id` (Owner, Super Admin). Passwords ≥ 8 with a letter and a number, bcrypt; the workspace always keeps one active Owner; you cannot block yourself; SUPER_ADMIN cannot be assigned.

## Task 1 — Bid Information Management + Reports (Bolpatra)
- Schema (additive only): `Tender.bidSecurityAmount Decimal(15,2)?`, `Tender.bidValidityDays Int?`; new table `Bid` (one per tender × company, `@@unique([tenderId, companyId])`, cascades from Tender and Company).
- Bid pipeline: PREPARING → SUBMITTED → OPENED → EVALUATED → INTENTION_TO_AWARD → AWARDED → CONTRACT_SIGNED (+ LOST, WITHDRAWN, CANCELLED); every change is stored in `statusHistory`.
- Background links: bid security amount copied from the tender; bid validity expiry = deadline + validity days; `submittedAt` filled automatically when a bid reaches a post-submission status; tender status follows its bids (won > submitted > lost > cancelled > active; archived and manually-cancelled tenders untouched); latest saved qualification shown on the bid.
- Rules enforced: NO_BID only with Preparing/Withdrawn/Cancelled; JV = 2–3 different companies of the same workspace, shares 1–99 totalling 100, one lead; guarantee issue < expiry; award ≤ contract signing; tender/company of a bid cannot change; delete = Owner / Super Admin / Director.
- API: `GET/POST /bids`, `GET/PATCH/DELETE /bids/:id`, `GET /bolpatra/reports?days=1..365` (default 30) — JWT + `@RequireModule('bolpatra')`.
- Web: `/bids` (filters, new/edit, JV partners, 13/14-item checklist, guarantee PDF reading, Excel template/import/export), `/reports` (cards, deadlines, status bars, expiring bid/performance securities, bid validity and licences, per company, 12 months, Excel export, print); tender workspace panel; Bolpatra overview cards.
- Not a PPMO rule source: the 30-day guarantee margin hint and checklist items are guidance, editable per bid.
- Verified in sandbox: API e2e 38 (bids, access, qualification, verification), unit 81, browser 103 checks (bids 28, tenders 29, Excel/PDF 21, ERP 25).

## Decisions recorded

- JV rules follow a published Nepal IFB (similar = one partner, key activities = combined, turnover 100/25/40).
- Unconfirmed defaults are configurable per tender and listed in `docs/PHASE_6.4_QUALIFICATION_ENGINE.md`.
- Legacy behaviour kept: `/qualification/evaluate` accepts the old body; old tender fields still evaluated;
  turnover average divides by available years (max 3) as in Phase 5.3.
- BS dates: `nepali-date-converter` (MIT) in the web app; the database keeps AD dates.

## Next (in order)

1. Deploy 6.4A/6.4B/6.5 (db push → git push → Render → cPanel) — needs owner approval.
2. Phase 6.5 rest: Nepali/English UI toggle, full bidder profile (personnel, equipment, financials, litigation), document vault + expiry alerts.
3. Phase 6.6: certificate PDF upload (Cloudflare R2) + auto-fill; PDFs in ZIP; average-bid price scenario tool.
4. Phase 6.7: EXP/FIN/ELI form autofill; Bank Guarantee Management linked to bids; won tender → Project.
5. Admin panel + subscription plans; eSewa/Khalti; WhatsApp OTP; WordPress site.
6. After full deployment: rotate admin + Supabase DB passwords; Render Starter.
