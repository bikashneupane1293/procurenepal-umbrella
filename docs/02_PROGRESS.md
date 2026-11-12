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

## Task 2 — Bank System: Banks + Bank Guarantee Management
- Schema (additive only): new tables `Bank` (per company: branch, account, guarantee limit, usual margin %, commission % and basis) and `BankGuarantee` (type, number, bank, company, optional bid / tender, beneficiary, amount, issue / expiry / claim expiry, margin, commission, status, release, history); back-relations on Company, Tender, Bid. Bid / Tender / Bank deletion keeps guarantees (`SetNull`); Company deletion removes them.
- Types: BID_SECURITY, PERFORMANCE, ADVANCE_PAYMENT, RETENTION, CUSTOMS, OTHER. Statuses: REQUESTED, ACTIVE (both "open", count against the limit), RELEASED, EXPIRED, CLAIMED, CANCELLED.
- Background links: a bid with a bank-guarantee bid security (bank or number) creates / updates its BID_SECURITY guarantee; a won bid with a performance security amount creates a PERFORMANCE guarantee (REQUESTED); a hand-entered guarantee with the same bank + number is linked instead of duplicated; editing a linked open guarantee writes bank, number, amount and dates back to the bid; closed guarantees are never changed by bid saves; adding a bank attaches guarantees already typed with that name; `POST /bank-guarantees/sync-from-bids` back-fills older bids. Bids keep recording guarantees even when the Bank module is switched off.
- Alerts: expired but still open, expiring within N days, release due (bid lost / withdrawn / cancelled, or contract signed), bid security valid less than 30 days beyond bid validity (guidance only), active without number. Limit use per bank and over-limit list.
- Margin and commission are estimates (QUARTER / YEAR = rate per period or part of it; FLAT = once) from the bank's usual rates — not a rule; every value can be overwritten.
- API (module `bank`): `GET/POST /banks`, `GET/PATCH/DELETE /banks/:id`, `GET/POST /bank-guarantees`, `GET/PATCH/DELETE /bank-guarantees/:id`, `GET /bank-guarantees/summary?days=`, `POST /bank-guarantees/sync-from-bids`. Delete: Owner / Super Admin / Director; a bank with open guarantees cannot be deleted.
- Web: `/banks` and `/bank-guarantees` (summary cards, needs-attention list, limit use per bank, filters, form with guarantee-PDF reading incl. advance / retention detection, mark released, history, Excel template / import / export, "Bring in from bids"); the bid form links to its guarantees.
- Verified in sandbox: API e2e 49 (bank 11 new), unit 81, browser 132 checks (bank 29 new).

## Task 3 — Project Management: Project Information + BOQ
- Schema (additive): new tables `Project` (company, tender, bid (unique), code unique per workspace, client, location, contract no / amount (excl. VAT), signing / start / intended / revised / actual completion, period months, defect liability months, advance %, retention %, JV partners, manager, client's engineer, status + history) and `BoqItem` (item no, section, description, unit, quantity (3 dp), rate (2 dp), amount, heading flag); new nullable column `BankGuarantee.projectId` (SetNull). Tender / Bid deletion keeps the project (unlinked); Company deletion removes it; Project deletion removes its BOQ and unlinks guarantees.
- Background links: a bid saved as CONTRACT_SIGNED becomes a project automatically (code P-001 …, status MOBILIZING, contract amount = contract amount or bid amount, start = signing date, intended completion = start + tender period months, JV partners copied); an AWARDED bid becomes a project with "Create project →" (bid page or Project Information); the bid's guarantees move to the project, and later guarantees of that bid follow; guarantees can be linked to a project directly (same contractor company). Works even when the Project module is switched off.
- Alerts (guidance): overdue / due within 30 days (uses revised completion if set), BOQ total ≠ contract amount (> 0.1 %), no BOQ yet, performance guarantee expiring before completion, project guarantee expiring.
- BOQ: amount = quantity × rate computed exactly in integer units (no floating-point drift); a typed amount that differs is reported and not used; lines without quantity and rate are headings; replace or append; max 5,000 lines (API JSON limit raised to 5 MB in `main.ts`). Excel reader finds the header row by itself (S.N./Item No, Description, Unit, Qty, Rate, Amount, Remarks — also Nepali headings), reads every bill sheet, skips Total / Sub-total / Grand total / carried-forward rows.
- API (module `project`): `GET/POST /projects`, `GET /projects/won-bids`, `POST /projects/from-bid/:bidId`, `GET/PATCH/DELETE /projects/:id`, `GET/PUT /projects/:id/boq`; `GET /bank-guarantees?projectId=`. Delete: Owner / Super Admin / Director.
- Web: `/projects` (won bids waiting, cards, filters, new project, Excel template / import / export), `/projects/:id` (Information / BOQ / Bank guarantees tabs; BOQ upload with preview + replace/append, inline edit, export), `/boq` (BOQ menu → choose project); bid page shows its project or "Create project →"; guarantee form has a Project field and "+ Add guarantee" from a project.
- Login page wakes the API as soon as it opens (Render free plan sleeps after 15 min idle, ~1 min to wake) and explains the wait.
- Verified in sandbox: API e2e 58 (projects 9 new), unit 81, browser 160 checks (projects 28 new).

## Deployment conventions
- cPanel zip goes to `~/Downloads/procurenepal-web.zip`; delete the old zip first (`rm -f`), otherwise `zip` adds to it and old chunk files are uploaded too.

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
4. Phase 6.7: EXP/FIN/ELI form autofill; project progress → experience certificate.
5. Admin panel + subscription plans; eSewa/Khalti; WhatsApp OTP; WordPress site.
6. After full deployment: rotate admin + Supabase DB passwords; Render Starter.
