#!/usr/bin/env bash
# codex-gate.sh — Pre-push merge gate for Codex CLI workflows.
#
# Authority chain (see AGENTS.md):
#   USER → PLANNER → EXECUTOR (Codex) → CodeRabbit REVIEWER → MERGE
#
# Same contract as claude-code-gate.sh, with a Codex-consumable prompt
# emitted to .coderabbit/codex-prompt.md.
#
# CodeRabbit `cr --agent` emits newline-delimited JSON. Event types:
# review_context, status, heartbeat, finding, complete.
# Severities (lowest → highest): minor < major < critical.
#
# Wiring:
#   1. Git hook:  .githooks/pre-push -> this script
#   2. Manual:    bash cli/codex-gate.sh
#   3. Codex agent loop:
#        codex exec "implement task X, then run bash cli/codex-gate.sh
#                    until clean or CR_MAX_LOOPS iterations, fixing findings
#                    each loop based on .coderabbit/codex-prompt.md."
#
# Exit codes:
#   0  clean — no findings at/above threshold
#   1  findings present at/above threshold
#   2  environmental failure

set -euo pipefail

CR_MAX_SEVERITY="${CR_MAX_SEVERITY:-major}"
CR_MAX_LOOPS="${CR_MAX_LOOPS:-3}"
LOG_DIR="${CR_LOG_DIR:-.coderabbit/local}"
BASE_BRANCH="${CR_BASE:-main}"
CODEX_PROMPT_FILE="${CR_PROMPT_FILE:-.coderabbit/codex-prompt.md}"

mkdir -p "${LOG_DIR}" "$(dirname "${CODEX_PROMPT_FILE}")"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_JSON="${LOG_DIR}/review-${TIMESTAMP}.json"
REPORT_LOG="${LOG_DIR}/review-${TIMESTAMP}.log"

log()  { printf '\e[1;35m[codex-gate]\e[0m %s\n' "$1"; }
fail() { printf '\e[1;31m[codex-gate]\e[0m %s\n' "$1" >&2; exit "${2:-1}"; }

# ---- Severity → ordinal
sev_rank() {
  case "$1" in
    minor)    echo 1 ;;
    major)    echo 2 ;;
    critical) echo 3 ;;
    *)        echo 0 ;;
  esac
}

THRESHOLD_RANK="$(sev_rank "${CR_MAX_SEVERITY}")"
if [[ "${THRESHOLD_RANK}" -eq 0 ]]; then
  fail "CR_MAX_SEVERITY must be one of: minor, major, critical (got: ${CR_MAX_SEVERITY})" 2
fi

# ---- Preflight
command -v cr >/dev/null 2>&1 || fail "cr not installed. Run cli/install.sh" 2
command -v jq >/dev/null 2>&1 || fail "jq required. brew install jq" 2
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not a git repo" 2
cr auth status >/dev/null 2>&1 || fail "cr not authenticated. Run: cr auth login" 2

# ---- Validate base branch before invoking cr (fail-fast with a clear message)
if ! git rev-parse --verify "${BASE_BRANCH}" >/dev/null 2>&1 \
  && ! git rev-parse --verify "origin/${BASE_BRANCH}" >/dev/null 2>&1; then
  fail "CR_BASE='${BASE_BRANCH}' is not a valid git branch or ref (checked local and origin/)" 2
fi

# ---- Loop guard
LOOP_FILE="${LOG_DIR}/.loop-counter-codex"
LOOP="$(cat "${LOOP_FILE}" 2>/dev/null || echo 0)"
LOOP=$((LOOP + 1))
echo "${LOOP}" > "${LOOP_FILE}"
if [[ "${LOOP}" -gt "${CR_MAX_LOOPS}" ]]; then
  rm -f "${LOOP_FILE}"
  fail "Hit max review loops (${CR_MAX_LOOPS}). Manual review required." 1
fi

log "Loop ${LOOP}/${CR_MAX_LOOPS} — running cr --agent --base ${BASE_BRANCH}"

# ---- Run review. Capture exit code; fail closed on error.
set +e
cr --agent --base "${BASE_BRANCH}" >"${REPORT_JSON}" 2>"${REPORT_LOG}"
CR_EXIT=$?
set -e

if [[ "${CR_EXIT}" -ne 0 ]]; then
  log "cr --agent exited ${CR_EXIT}. Tail of log:"
  tail -20 "${REPORT_LOG}" >&2 || true
  fail "Review failed (exit ${CR_EXIT}). Gate blocks push." 1
fi

set +e
cr --plain --base "${BASE_BRANCH}" 2>&1 | tee -a "${REPORT_LOG}" >/dev/null
set -e

# ---- Validate NDJSON completion. Use jq for whitespace-insensitive matching.
if [[ -z "$(jq -c 'select(.type=="complete")' "${REPORT_JSON}" 2>/dev/null | head -1)" ]]; then
  log "Review output missing completion event. First 5 lines:"
  head -5 "${REPORT_JSON}" >&2 || true
  fail "Review produced invalid output (no completion event). Gate blocks." 1
fi

# ---- TODO: enforce overrides.md filter on findings before counting.
# Currently overrides.md is documented but not yet wired into BLOCKING_COUNT.
# Plan: parse overrides.md for "file:line:rule" tuples, filter NDJSON findings
# matching those tuples out of the gate. See AGENTS.md "Override protocol".

# ---- Counts
CRITICAL_COUNT="$(jq -c 'select(.type=="finding" and .severity=="critical")' "${REPORT_JSON}" | wc -l | tr -d ' ')"
MAJOR_COUNT="$(   jq -c 'select(.type=="finding" and .severity=="major")'    "${REPORT_JSON}" | wc -l | tr -d ' ')"
MINOR_COUNT="$(   jq -c 'select(.type=="finding" and .severity=="minor")'    "${REPORT_JSON}" | wc -l | tr -d ' ')"

BLOCKING_COUNT="$(
  jq -c 'select(.type=="finding")' "${REPORT_JSON}" \
    | jq -r '.severity' \
    | awk -v tr="${THRESHOLD_RANK}" '
        function rank(s) {
          if (s=="critical") return 3
          if (s=="major")    return 2
          if (s=="minor")    return 1
          return 0
        }
        { if (rank($1) >= tr) c++ }
        END { print c+0 }
      '
)"

log "Findings: critical=${CRITICAL_COUNT} major=${MAJOR_COUNT} minor=${MINOR_COUNT}"
log "Threshold: CR_MAX_SEVERITY=${CR_MAX_SEVERITY}  blocking=${BLOCKING_COUNT}"

# ---- Emit Codex-consumable prompt
{
  echo "# CodeRabbit Review — Loop ${LOOP}/${CR_MAX_LOOPS}"
  echo ""
  echo "Generated: ${TIMESTAMP}"
  echo "Base:      ${BASE_BRANCH}"
  echo "Threshold: CR_MAX_SEVERITY=${CR_MAX_SEVERITY}"
  echo "Counts:    critical=${CRITICAL_COUNT} major=${MAJOR_COUNT} minor=${MINOR_COUNT}"
  echo ""
  echo "## Findings to address (severity >= ${CR_MAX_SEVERITY})"
  echo ""
  jq -c 'select(.type=="finding")' "${REPORT_JSON}" \
    | jq -r --argjson tr "${THRESHOLD_RANK}" '
        def rank: if .severity=="critical" then 3 elif .severity=="major" then 2 elif .severity=="minor" then 1 else 0 end;
        select(rank >= $tr)
        | "### [\(.severity | ascii_upcase)] \(.fileName // "unknown")\n\n\(.codegenInstructions // .message // "(no instructions)")\n"
      ' 2>/dev/null || echo "(no parseable findings; raw NDJSON at ${REPORT_JSON})"
  echo ""
  echo "## Instructions for Codex"
  echo ""
  echo "For each finding above:"
  echo "1. Open the file at the reported location."
  echo "2. Apply the fix described in codegenInstructions."
  echo "3. If you disagree, append the finding to \`.coderabbit/overrides.md\`"
  echo "   with a one-line rationale. Do not silently ignore."
  echo "4. Re-run \`bash cli/codex-gate.sh\` until clean or CR_MAX_LOOPS hit."
} > "${CODEX_PROMPT_FILE}"

log "Codex prompt: ${CODEX_PROMPT_FILE}"
log "JSON: ${REPORT_JSON}"
log "Log:  ${REPORT_LOG}"

# ---- Decide
if [[ "${BLOCKING_COUNT}" -gt 0 ]]; then
  log "Blocking push — see ${CODEX_PROMPT_FILE}"
  exit 1
fi

log "Clean. Push allowed."
rm -f "${LOOP_FILE}"
exit 0
