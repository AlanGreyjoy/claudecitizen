#!/usr/bin/env bash
# Cursor beforeShellExecution: block agent git commit/push when gitleaks finds secrets.
# Still runs when the agent passes --no-verify (husky skipped).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

input="$(cat)"
command="$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("command") or "")')"

if [[ "$command" =~ git[[:space:]]+commit ]]; then
  if ! ./scripts/check-secrets.sh --staged; then
    printf '%s\n' '{"permission":"deny","user_message":"Commit blocked: gitleaks found secrets in staged changes.","agent_message":"gitleaks detected secrets in the index. Unstage/remove them (do not use --no-verify) and commit again."}'
    exit 0
  fi
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

if [[ "$command" =~ git[[:space:]]+push ]]; then
  if ! ./scripts/check-secrets.sh --pre-push </dev/null; then
    printf '%s\n' '{"permission":"deny","user_message":"Push blocked: gitleaks found secrets in commits about to be pushed.","agent_message":"gitleaks detected secrets already in local history. Rewrite/remove those commits (do not use --no-verify) before pushing."}'
    exit 0
  fi
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

printf '%s\n' '{"permission":"allow"}'
exit 0
