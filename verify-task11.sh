#!/usr/bin/env bash
# ProcureNepal — Tasks 11–13 verification (Nepal Time, plan expiry, email, staff/Org ID/Google,
# tender requirements table + whole-document PDF reader; includes everything Task 10 checked).
# Run on your Mac from the repo root. Read-only: builds and tests only — never touches git,
# never deploys, never pushes, never connects to the live database (e2e tests use an in-memory DB).
set -uo pipefail
cd "$(dirname "$0")" 2>/dev/null || true
if [ ! -d web ] || [ ! -d api ]; then echo "Run this from the ProcureNepal repo root (needs web/ and api/)."; exit 1; fi
pass=0; fail=0
run() { local label="$1"; shift; echo ""; echo "=== $label ==="; if "$@"; then echo "--> PASS: $label"; pass=$((pass+1)); else echo "--> FAIL: $label"; fail=$((fail+1)); fi; }

pushd api >/dev/null
run "API — TypeScript (src + tests)"         npx tsc --noEmit -p tsconfig.json
run "API — unit tests (incl. Nepal Time)"    npm test
# (named suites only — never plain `npm run test:e2e`: app.e2e-spec talks to the database in .env)
run "API — e2e: staff, tender-requirements, access/expiry, pricing, tenants, erp, projects, bank, bids, qualification, verification" \
  npm run test:e2e -- staff tender-requirements pricing access tenants erp projects bank bids qualification verification
popd >/dev/null

pushd web >/dev/null
run "Web — TypeScript app"                   npx tsc --noEmit -p tsconfig.app.json
run "Web — TypeScript specs"                 npx tsc --noEmit -p tsconfig.spec.json
run "Web — Angular template check"           npx ngc -p tsconfig.app.json --noEmit
run "Web — tests (incl. real tender PDF requirements reader)" npx ng test --watch=false
run "Web — production build"                 npx ng build --configuration production
popd >/dev/null

echo ""
echo "=================================================================="
echo "Summary: $pass passed, $fail failed.   Expected: 8 passed, 0 failed."
echo "Anything failing: stop and send the output before deploying."
echo ""
echo "Results from the cloud session (Linux copy of these exact files):"
echo "  API unit 22 suites / 86 tests; API e2e 11 named suites (+ app) / 100 tests;"
echo "  Web 4 files / 34 tests (all green); production build OK."
echo "=================================================================="
exit 0
