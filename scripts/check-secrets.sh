#!/usr/bin/env bash
# Block secrets before they enter git history (gitleaks, MIT).
# Shared by husky + Cursor beforeShellExecution.
#
# Usage:
#   scripts/check-secrets.sh                # staged changes (default / pre-commit)
#   scripts/check-secrets.sh --staged       # same
#   scripts/check-secrets.sh --pre-push     # commits about to push (stdin refs)
#   scripts/check-secrets.sh --range A..B   # explicit commit range
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

find_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    command -v gitleaks
    return 0
  fi
  local candidate
  for candidate in "${HOME}/.local/bin/gitleaks" /usr/local/bin/gitleaks; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! GITLEAKS="$(find_gitleaks)"; then
  cat >&2 <<'EOF'
gitleaks not found on PATH (or ~/.local/bin).

Install (free, MIT): https://github.com/gitleaks/gitleaks#installing
  # Linux x64 example:
  # curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_*_linux_x64.tar.gz | tar -xz
  # install -m 755 gitleaks ~/.local/bin/

Or: brew install gitleaks
EOF
  exit 1
fi

run_staged() {
  echo "gitleaks: scanning staged changes"
  "$GITLEAKS" git --no-banner --redact --verbose --staged
}

run_range() {
  local range="$1"
  if [[ -z "$range" ]]; then
    return 0
  fi
  if [[ "$range" == *'..'* ]]; then
    local a="${range%%..*}"
    local b="${range##*..}"
    if [[ "$a" == "$b" ]]; then
      return 0
    fi
  fi
  echo "gitleaks: scanning $range"
  "$GITLEAKS" git --no-banner --redact --verbose --log-opts="$range"
}

ZERO=0000000000000000000000000000000000000000
mode="${1:-}"

case "$mode" in
  '' | --staged | --pre-commit)
    run_staged
    exit 0
    ;;
  --pre-push)
    scanned=0
    while read -r local_ref local_sha remote_ref remote_sha; do
      [[ -z "${local_sha:-}" ]] && continue
      if [[ "$local_sha" == "$ZERO" ]]; then
        continue
      fi
      if [[ "$remote_sha" == "$ZERO" ]]; then
        if git rev-parse --verify origin/main >/dev/null 2>&1; then
          range="origin/main..$local_sha"
        else
          range="$local_sha"
        fi
      else
        range="$remote_sha..$local_sha"
      fi
      run_range "$range"
      scanned=1
    done
    if [[ "$scanned" -eq 0 ]]; then
      # Empty stdin: scan unpushed commits as a fallback.
      if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
        run_range '@{u}..HEAD'
      elif git rev-parse --verify origin/main >/dev/null 2>&1; then
        run_range 'origin/main..HEAD'
      fi
    fi
    exit 0
    ;;
  --range)
    run_range "${2:?usage: check-secrets.sh --range A..B}"
    exit 0
    ;;
  *)
    echo "usage: check-secrets.sh [--staged|--pre-commit|--pre-push|--range A..B]" >&2
    exit 2
    ;;
esac
