#!/usr/bin/env bash
# ProcureNepal — Phase 1A/1B verification script. Run this on your Mac (not in any sandbox).
# Read-only / test-only: builds and runs tests, never touches git, never deploys, never pushes.
set -uo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || true
if [ ! -d "web" ]; then echo "Run this from inside the ProcureNepal repo root (expects a web/ folder here)."; exit 1; fi
cd web

pass=0
fail=0
run() {
  local label="$1"; shift
  echo ""
  echo "=== $label ==="
  if "$@"; then echo "--> PASS: $label"; pass=$((pass+1));
  else echo "--> FAIL: $label"; fail=$((fail+1)); fi
}

run "Phase 1A engine tests (pdf-table-reconstruct.spec.ts, 10 tests)" \
  npx ng test --watch=false --include='**/pdf-table-reconstruct.spec.ts'

run "Full frontend test suite" \
  npx ng test --watch=false

run "TypeScript — application code" \
  npx tsc --noEmit -p tsconfig.app.json

run "TypeScript — spec files" \
  npx tsc --noEmit -p tsconfig.spec.json

run "Angular Ivy template check (catches template-only errors tsc misses)" \
  npx ngc -p tsconfig.app.json --noEmit

echo ""
echo "=================================================================="
echo "Summary: $pass passed, $fail failed."
echo "Known, expected, unrelated failure: 'full frontend suite' may show"
echo "1 failing test (app.spec.ts > should render title) — pre-existing,"
echo "unrelated to Phase 1A/1B. See docs/02_PROGRESS.md, Task 6, Outstanding issues."
echo "=================================================================="
exit 0
