# ProcureNepal — Construction Industry OS for Nepal

Brand: Cuidado Technology Pvt. Ltd. · © Cuidado Technology Pvt. Ltd.
Login email: admin@griha.com (do NOT rename)

## Stack
NestJS 12 · Angular 22 · Prisma 7.10 · PostgreSQL 18 (Supabase Singapore)
Render free tier (cold start ~60s) · Cloudflare · Himalayan Host cPanel

## Live URLs
- Frontend: https://app.procurenepal.com
- Backend:  https://procurenepal-api.onrender.com
- Repo:     github.com/bikashneupane1293/procurenepal-umbrella
- Local:    ~/ProcureNepal

## Commands (run from ~/ProcureNepal)
- Backend dev:  cd api && npm run start:dev
- Frontend dev: cd web && npm start
- DB push:      cd api && npx prisma db push && npx prisma generate
- Build web:    cd web && ng build --configuration production
- Backup:       ~/ProcureNepal/backup.sh

## Non-negotiable rules
1. EVERY DB query MUST filter by tenantId (multi-tenancy).
2. WPI: Adjusted = Historical × (Current_WPI / Historical_WPI).
3. AACT = average of BEST 3 WPI-adjusted years (NOT all 5).
4. Key Activity = MAX year production (NOT average).
5. JV share applies to Turnover ONLY — NOT to Key Activity.
6. Qual results: INDIVIDUAL_ELIGIBLE / JV_REQUIRED / NOT_ELIGIBLE.
7. Never automate e-GP bid submission or store e-GP credentials.
8. Bid prices must never mix across tenants (collusion safeguard).
9. Tender criteria are per-tender configurable — never hardcode.

## Do NOT
- Modify .env or commit secrets.
- Change Prisma schema without `db push` + `generate`.
- Skip tenant isolation on any query.

## Custom skills (auto-trigger on domain terms)
- procurenepal-wpi — WPI table + AACT formula
- procurenepal-ppmo — bid capacity, FIN-5, award rules
- procurenepal-jv — JV splits + key activity max-year
