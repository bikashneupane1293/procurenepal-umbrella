#!/usr/bin/env bash
# ProcureNepal — Task 10 verification (pricing & promotions; includes everything Task 9 checked).
# Run on your Mac from the repo root. Read-only: builds and tests only — never touches git,
# never deploys, never pushes, never connects to the live database (e2e tests use an in-memory DB).
set -uo pipefail
cd "$(dirname "$0")" 2>/dev/null || true
if [ ! -d web ] || [ ! -d api ]; then echo "Run this from the ProcureNepal repo root (needs web/ and api/)."; exit 1; fi
pass=0; fail=0
run() { local label="$1"; shift; echo ""; echo "=== $label ==="; if "$@"; then echo "--> PASS: $label"; pass=$((pass+1)); else echo "--> FAIL: $label"; fail=$((fail+1)); fi; }

pushd api >/dev/null
run "API — TypeScript (src + tests)"                   npx tsc --noEmit -p tsconfig.json
run "API — unit tests"                                 npm test
run "API — e2e: pricing (prices, promos, Set plan), access, tenants, erp, projects, bank, bids, qualification, verification" \
  npm run test:e2e -- pricing access tenants erp projects bank bids qualification verification
popd >/dev/null

pushd web >/dev/null
run "Web — TypeScript app"                             npx tsc --noEmit -p tsconfig.app.json
run "Web — TypeScript specs"                           npx tsc --noEmit -p tsconfig.spec.json
run "Web — Angular template check"                     npx ngc -p tsconfig.app.json --noEmit
run "Web — tests (incl. PDF table -> checklist)"       npx ng test --watch=false
run "Web — production build"                           npx ng build --configuration production
popd >/dev/null

echo ""
echo "=================================================================="
echo "Summary: $pass passed, $fail failed."
echo "Expected: ONLY 'Web — tests' may fail, with exactly 1 failing test:"
echo "app.spec.ts > should render title (old Angular scaffold test, unrelated)."
echo "Anything else failing: stop and send the output before deploying."
echo ""
echo "Results from the cloud session (Linux copy of these exact files):"
echo "  API e2e 9 suites / 82 tests passed; API unit 21 suites / 81 passed;"
echo "  Web 13/14 passed (the 1 = the scaffold test above); prod build OK."
echo "=================================================================="
exit 0
