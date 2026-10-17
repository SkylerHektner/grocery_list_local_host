#!/usr/bin/env bash
# Runs every project check in order and stops at the first failure.
#   cargo fmt --check, cargo clippy (-D warnings), cargo test, node unit tests, Playwright e2e.
# Usage: ./scripts/check.sh [--quick]     (--quick skips Playwright)
# Exit code 0 = all green; otherwise the first failing step's exit code.
set -uo pipefail

quick=0
for arg in "$@"; do
  case "$arg" in
    --quick | -q) quick=1 ;;
    -h | --help)
      sed -n '2,5p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg (use --quick)" >&2
      exit 2
      ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
results=()

summary() {
  echo
  echo "==== check summary ===="
  printf '%s\n' "${results[@]}"
  echo "OVERALL: $1"
}

# step <name> <dir> <command...>
step() {
  local name="$1" dir="$2"
  shift 2
  echo
  echo "==> $name"
  local start=$SECONDS code=0
  (cd "$dir" && "$@") || code=$?
  local secs=$((SECONDS - start))
  if [ "$code" -ne 0 ]; then
    results+=("FAIL  $name  (${secs}s, exit $code)")
    summary FAIL
    exit "$code"
  fi
  results+=("PASS  $name  (${secs}s)")
}

step "cargo fmt --check" "$root" cargo fmt --check
step "cargo clippy --all-targets -- -D warnings" "$root" cargo clippy --all-targets -- -D warnings
step "cargo test" "$root" cargo test
step "node --test (public/js)" "$root" node --test 'public/js/**/*.test.js'

if [ "$quick" -eq 1 ]; then
  results+=("SKIP  playwright e2e  (--quick)")
else
  if [ ! -d "$root/e2e/node_modules" ]; then
    step "npm ci (e2e)" "$root/e2e" npm ci --no-fund --no-audit
  fi
  step "playwright e2e (npm test)" "$root/e2e" npm test
fi

summary PASS
exit 0
