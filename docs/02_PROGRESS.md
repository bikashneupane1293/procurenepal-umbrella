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

## Task 4 — ERP engine: every remaining menu (Procurement, Fleet, HR, rest of Project and Bank)
- Design: one definition file `api/src/erp/erp.registry.ts` describes every register / document (fields, line items, statuses, number prefix, actions) and every menu (tabs = registers, calculated reports, CSV). The API serves the definitions (`GET /erp/menu/:id`) and one web page (`/m/:menuId`, `pages/erp/erp-page.ts`) draws list, form, lines, Excel template / import / export from them. A new register is added in the registry only.
- Schema (additive): one new table `ErpRecord` (tenantId, entity, number, status, companyId, projectId, date, total, data JSON, lines JSON). No existing table changes. Trade-off, stated plainly: these registers live as JSON documents, not one SQL table each — fast to extend, fine for a contractor's volume; heavy cross-register SQL reporting would later mean moving the busiest ones (stock documents) to their own tables.
- Registers (36): product / category / brand, warehouse, vendor, number series, requisition, RFQ, quotation, PO, pro forma + payment, GRN, stock transfer / dispatch / return; vehicle, maintenance, tax & insurance, movement, daily log, trip, other income/expense, allowance; employee, payroll; project document, milestone, schedule activity, extension of time, norm, progress report, petty contractor, work order, petty bill, material issue; loan, LC, fixed asset.
- Automatic steps: approved requisition → RFQ (all vendors ticked) → quotations → comparison → award → PO → GRN (pre-filled) → stock; PO becomes PARTIAL / RECEIVED from its GRNs (over-receipt refused); stock only moves on POSTED documents and can never go negative; "Email vendors" opens the user's mail program (no mail server is configured, nothing is sent by the system); payroll "Calculate from employees"; approved EOT → project's revised completion date; norms × BOQ → material plan → requisition for the shortfall; progress reports → % complete, S-curve (planned from schedule weights vs actual by value), and a completed project → experience certificate in Bolpatra (always "unverified"); loan amortization (EMI / equal principal / interest only) with recorded payments; LC due date = shipment + usance days.
- Reports (14): stock, quotation comparison, payables, fleet renewals, where vehicles are, vehicle earning & expense, material plan, progress, S-curve, portfolio, materials with petty contractors, amortization, finance dashboard, facilities per bank. CSV / Excel export of every list (Bank → CSV Export).
- Unconfirmed values are fields, not rules: SSF 11 % employee / 20 % employer of basic salary (editable per payroll), VAT 13 % (editable per document), income tax (TDS) is typed in — not calculated; retention % / TDS % on petty contractor bills are typed in; norms are the user's own (no DoR / DUDBC norm book is shipped).
- Not included: PDF reading on these pages (Bolpatra / bank guarantee pages keep it), file storage for Document Management (it records reference, physical location and a link), sending email from the server.
- Access: module checked per register / report inside the services; delete = Owner / Super Admin / Director. All five modules are now `built` in the module registry.
- Verified in sandbox: API e2e 66 (erp 8 new), unit 81, browser 185 checks (25 new: all 41 menus / 55 tabs open; procurement chain to stock; payroll; S-curve; amortization; CSV; Excel).

## Deployment conventions
- cPanel zip goes to `~/Downloads/procurenepal-web.zip`; delete the old zip first (`rm -f`), otherwise `zip` adds to it and old chunk files are uploaded too.

## Decisions recorded

- JV rules follow a published Nepal IFB (similar = one partner, key activities = combined, turnover 100/25/40).
- Unconfirmed defaults are configurable per tender and listed in `docs/PHASE_6.4_QUALIFICATION_ENGINE.md`.
- Legacy behaviour kept: `/qualification/evaluate` accepts the old body; old tender fields still evaluated;
  turnover average divides by available years (max 3) as in Phase 5.3.
- BS dates: `nepali-date-converter` (MIT) in the web app; the database keeps AD dates.

## Task 5 — Sidebar fix, Bid Document Reader, External References, User Setup upgrades, Daily Site Reporting
- **Sidebar now follows you.** Opening a menu from anywhere (Dashboard cards, a direct link) opens exactly that section in the sidebar and closes the others, then scrolls it into view. Before, every newly opened section stayed open on top of the last one, so the one you wanted could be far down and out of sight — it looked like the sidebar "wasn't showing" the right place. (`web/src/app/layout/shell.ts`)
- **Bid Document Reader** (Tenders → open a tender): upload the bid document PDF. It reads the text in your browser (nothing is uploaded to a server) and shows (a) the values it can find — IFB number, title, cost estimate, period, deadline, turnover / bid capacity / similar-contract requirement, bid security, bid validity — next to the line it found them on, to compare with "Requirements"; (b) a draft checklist of 17 common bid documents (bid security, bid form, price schedule / BOQ, power of attorney, registration, PAN/VAT, tax clearance, JV agreement, experience certificates, audited financials, equipment proof, key personnel, litigation history, methodology, qualification information, bid validity, eligibility declaration) — found / not found by keyword, with the nearby text shown. **This is a reading aid, not a compliance check** — every row must be verified by you against the actual document; nothing is auto-applied to the tender. "Save checklist" stores it on the tender (`Tender.readinessChecklist`, additive Json field); "Excel checklist" downloads it. (`web/src/app/core/pdf-parse.ts` — `findDocumentChecklist()`, wired to the already-built-but-unused `readPdfText()` / `parseTenderText()`.)
- **External References** (Bolpatra eGP System → External References (PPMO / NRB)): watches three public pages — ppmo.gov.np, nrb.org.np, and NRB's Current Macroeconomic Situation page — and tells you when the page's text has changed since the last check. **It only reports a change; nothing in ProcureNepal is changed automatically**, and it is not tied to bid prices or procurement rules. "Check now" is manual for the Owner for now (no scheduler is wired up — see Next works). New table `ExternalRef` (not tenant-scoped: public page snapshots only). (`api/src/references/*`, `web/src/app/pages/references/references.ts`)
- **User Setup upgrades**:
  - *Sidebar items (fine control)*: besides switching a whole module on/off, the Owner can now switch off one sidebar item within an active module (e.g. just "Bank — LC Management") without touching the rest. Reuses the existing `TenantFeatureFlag` table with a new key shape `item:<id>` — no schema change. **Known limit:** this hides the item in the sidebar; a user who already has the direct link can still open it, because the ERP API does not yet check item-level flags (only module-level). Worth closing next pass if it matters to you.
  - *Sign-in / sign-out history*: Owner, Super Admin and the new **HR and Operations** role can see every sign-in with its time and, if closed properly, sign-out time. New table `LoginSession`; a session is marked signed-out only on an explicit "Logout" click — closing the browser tab leaves it "Open" until the next sign-in. New role `HR_MANAGER` added to the `Role` enum (additive).
  - *Custom role / title*: a free-text label (e.g. "Site Supervisor – Butwal") can be set per user and is shown instead of the system role name. **By design this is a label only** — the role you pick still controls what the user can actually do. Turning the Role enum itself into free-text custom permissions would be a materially riskier schema change (converting an existing Postgres enum column), so it was deliberately not done without discussing it with you first.
  - *Activation by link, not a typed password*: when adding a user, the password field is now optional. Leave it blank and the user is created as `PENDING` with a 7-day activation link; the Owner copies the link (shown right on the page with a Copy button) and sends it however they like — WhatsApp, SMS, email. The user opens it and sets their own password. **Email sending is not configured yet** (no SMTP / Brevo / SendGrid credentials), so this is manual for now; typing a password at creation still works exactly as before if you'd rather activate someone immediately. New `User` fields: `status`, `activationToken` (unique), `activationExpires` (all additive, nullable).
- **Daily Site Reporting** (Project Management → Daily Site Reporting): one new register on the existing ERP engine (so it came with Excel template / import / export for free) — matches the attached site diary format: weather / temperature / humidity / wind, sub-contractor and manpower counts (mason, labour, welder, driver, supervisor — total calculated), equipment used, issues, material used, and a line table for activities by part of structure with progress status. (`project.dailyReport` in `api/src/erp/erp.registry.ts`)
- **Schema changes this task (all additive — no existing column or table was altered or removed):** `User.status/activationToken/activationExpires/customTitle`, `Tender.readinessChecklist`, `Role` enum `+ HR_MANAGER`, new tables `LoginSession` and `ExternalRef`.
- **Verification note:** this session's sandbox could compile and type-check everything (`nest build` on the API passed with zero errors; `tsc --noEmit` on the web app passed with zero errors; `prisma generate` succeeded) but could **not** run the full Angular build or the Jest test suite — this session's container is a Linux ARM64 VM with your Mac folder mounted over the network, while your project's `node_modules` (esbuild, the Jest toolchain) were installed for macOS, so platform-specific tooling fails here. This is an environment limitation, not a code issue, and it's the reason real `npm test` / `npm run test:e2e` / `ng build` runs are listed first in the next-session steps before anything is deployed.

## Next (in order)

1. **First, on your Mac:** run `npm test`, `npm run test:e2e`, and `ng build` for Task 5 (this session could not run them — see the verification note above) before anything is pushed or deployed. Full step-by-step commands next session.
2. Close the item-level sidebar toggle's soft spot: add the same check to the ERP API so a direct link to a switched-off item is blocked, not just hidden.
3. Wire real email sending (needs an SMTP / Brevo / SendGrid account from you) so new-user activation links and RFQ vendor emails go out automatically; then decide a schedule for External References "Check now" (a free GitHub Action cron hitting a new API endpoint, or Render's paid Cron Jobs).
4. Feedback from real use of the Task 4 ERP engine pages — cheap to change in `erp.registry.ts`.
5. Bidder profile for Bolpatra (staff, equipment, finances, litigation) — employees, vehicles and fixed assets already exist to feed it; document vault with expiry alerts; Nepali/English UI switch.
6. Storing PDFs and documents online (needs storage credentials from you — e.g. Cloudflare R2).
7. After everything is deployed: rotate the admin and Supabase database passwords; consider Render Starter to remove the slow first sign-in.
