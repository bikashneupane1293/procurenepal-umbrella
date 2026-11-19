#!/usr/bin/env bash
# ProcureNepal — Task 8 verification script (Admin Panel: plan->module mapping +
# organization-setup flow). Run this on your Mac, from the repo root (not in any sandbox).
# Read-only / test-only: builds and type-checks, never touches git, never deploys, never pushes.
set -uo pipefail
cd "$(dirname "$0")" 2>/dev/null || true
if [ ! -d "web" ] || [ ! -d "api" ]; then
  echo "Run this from inside the ProcureNepal repo root (expects web/ and api/ folders here)."
  exit 1
fi

pass=0
fail=0
run() {
  local label="$1"; shift
  echo ""
  echo "=== $label ==="
  if "$@"; then echo "--> PASS: $label"; pass=$((pass+1));
  else echo "--> FAIL: $label"; fail=$((fail+1)); fi
}

pushd api >/dev/null
run "API — TypeScript build check" \
  npx tsc --noEmit -p tsconfig.build.json
popd >/dev/null

pushd api >/dev/null
run "API — full test suite (auth, access, tenants, erp, ...)" \
  npm test
popd >/dev/null

pushd web >/dev/null
run "Web — TypeScript application code" \
  npx tsc --noEmit -p tsconfig.app.json

run "Web — TypeScript spec files" \
  npx tsc --noEmit -p tsconfig.spec.json

run "Web — Angular Ivy template check (catches template-only errors tsc misses)" \
  npx ngc -p tsconfig.app.json --noEmit

run "Web — full frontend test suite" \
  npx ng test --watch=false
popd >/dev/null

echo ""
echo "=================================================================="
echo "Summary: $pass passed, $fail failed."
echo "Known, expected, unrelated failure: the web suite may show 1 failing"
echo "test (app.spec.ts > should render title) — pre-existing, unrelated"
echo "to Task 8. See docs/02_PROGRESS.md, Task 6, Outstanding issues."
echo ""
echo "No automated test yet covers Task 8 itself (createTenant, the slug"
echo "generator, or the new plan-gating branches in tenantModules /"
echo "setTenantModules) — that's listed in docs/02_PROGRESS.md, Task 8,"
echo "Outstanding issues, and in Next (in order), item 9. This script only"
echo "confirms Task 8 did not break anything that already had tests."
echo ""
echo "Manual check worth doing once on the Mac (no automated test for this"
echo "yet): sign in as admin@griha.com (SUPER_ADMIN), open /admin, use"
echo "'Create a new organization', copy the activation link it shows, open"
echo "it in a private window and set a password — the new workspace should"
echo "sign in as OWNER on the plan you chose. Then in that new workspace's"
echo "User Setup, confirm a module NOT in that plan shows locked (greyed"
echo "out, 'Not included in the X plan'), and that Set plan in /admin to a"
echo "higher plan unlocks it without needing to sign out."
echo "=================================================================="
exit 0
