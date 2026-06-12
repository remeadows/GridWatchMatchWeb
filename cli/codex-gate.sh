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
CR_PLAIN_LOG="${CR_PLAIN_LOG:-0}"
LOG_DIR="${CR_LOG_DIR:-.coderabbit/local}"
BASE_BRANCH="${CR_BASE:-main}"
CODEX_PROMPT_FILE="${CR_PROMPT_FILE:-.coderabbit/codex-prompt.md}"
OVERRIDES_FILE="${CR_OVERRIDES_FILE:-.coderabbit/overrides.md}"

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

if [[ "${CR_PLAIN_LOG}" == "1" ]]; then
  set +e
  cr --plain --base "${BASE_BRANCH}" 2>&1 | tee -a "${REPORT_LOG}" >/dev/null
  CR_PLAIN_EXIT=$?
  set -e
  if [[ "${CR_PLAIN_EXIT}" -ne 0 ]]; then
    printf '[codex-gate] cr --plain exited %s; continuing because CR_PLAIN_LOG is non-blocking\n' "${CR_PLAIN_EXIT}" >>"${REPORT_LOG}"
  fi
fi

# ---- Validate NDJSON completion. Use jq for whitespace-insensitive matching.
if [[ -z "$(jq -c 'select(.type=="complete")' "${REPORT_JSON}" 2>/dev/null | head -1)" ]]; then
  log "Review output missing completion event. First 5 lines:"
  head -5 "${REPORT_JSON}" >&2 || true
  fail "Review produced invalid output (no completion event). Gate blocks." 1
fi

# ---- Override filtering
ACTIVE_FINDINGS_JSON="${LOG_DIR}/review-${TIMESTAMP}.active-findings.jsonl"
: > "${ACTIVE_FINDINGS_JSON}"
OVERRIDDEN_COUNT=0

lowercase() {
  tr '[:upper:]' '[:lower:]'
}

contains_any_timing_term() {
  local text="$1"
  [[ "${text}" == *"motiontiming"* \
    || "${text}" == *"matchlock"* \
    || "${text}" == *"matchpop"* \
    || "${text}" == *"matchpopanticipation"* \
    || "${text}" == *"powerupeffect"* \
    || "${text}" == *"spawnmove"* ]]
}

contains_any_helper_term() {
  local text="$1"
  [[ "${text}" == *"powerupeventkeys"* \
    || "${text}" == *"clearflashcolors"* \
    || "${text}" == *"poweruppopstagger"* \
    || "${text}" == *"unionkeys"* ]]
}

contains_any_e2e_counter_term() {
  local text="$1"
  [[ "${text}" == *"matchburstcount"* \
    || "${text}" == *"powerupfxcount"* \
    || "${text}" == *"tntdetonationcount"* \
    || "${text}" == *"rocketlaunchcount"* \
    || "${text}" == *"propellerstrikecount"* \
    || "${text}" == *"lightballzapcount"* ]]
}

contains_any_vfx_import_term() {
  local text="$1"
  [[ "${text}" == *"burst("* \
    || ( "${text}" == *"import"* && "${text}" == *"burst"* ) \
    || "${text}" == *"ensurevfxtextures"* \
    || "${text}" == *"shake"* \
    || "${text}" == *"shockwave"* \
    || "${text}" == *"vfxtexturekeys"* ]]
}

is_board_method_override() {
  local text="$1"
  [[ "${text}" == *"activateboosteratpointer"* \
    || "${text}" == *"playblockedcellfeedback"* \
    || "${text}" == *"updategeometry"* ]]
}

override_line_matches_file() {
  local line_l="$1"
  local file_l="$2"
  local token
  local shell_flags="$-"
  set -f
  for token in ${line_l}; do
    token="${token#:}"
    token="${token%:}"
    token="${token%,}"
    token="${token%;}"
    if [[ "${token}" == "${file_l}" ]]; then
      case "${shell_flags}" in *f*) ;; *) set +f ;; esac
      return 0
    fi
  done
  case "${shell_flags}" in *f*) ;; *) set +f ;; esac
  return 1
}

override_line_has_marker() {
  local line_l="$1"
  [[ "${line_l}" == *"stale"* \
    || "${line_l}" == *"override:"* \
    || "${line_l}" == *"manual override"* \
    || "${line_l}" == *"disagree:"* ]]
}

finding_is_overridden() {
  local file_name="$1"
  local instructions="$2"
  local file_l instructions_l line_l

  [[ -f "${OVERRIDES_FILE}" ]] || return 1
  file_l="$(printf '%s' "${file_name}" | lowercase)"
  [[ -n "${file_l}" ]] || return 1
  instructions_l="$(printf '%s' "${instructions}" | lowercase)"

  while IFS= read -r override_line; do
    line_l="$(printf '%s' "${override_line}" | lowercase)"
    override_line_matches_file "${line_l}" "${file_l}" || continue
    override_line_has_marker "${line_l}" || continue

    # Override lines must first match a specific assertion phrase in overrides.md,
    # then the finding text must mention the narrow symbol family covered by it.
    if [[ "${line_l}" == *"helper symbols"* || "${line_l}" == *"animation helper functions"* ]] \
      && contains_any_helper_term "${instructions_l}"; then return 0; fi
    if [[ "${line_l}" == *"timing constants"* ]] && contains_any_timing_term "${instructions_l}"; then return 0; fi
    if [[ "${line_l}" == *"board methods"* ]] && is_board_method_override "${instructions_l}"; then return 0; fi
    if [[ "${line_l}" == *"powerup_fx_budget_ms"* && "${instructions_l}" == *"powerup_fx_budget_ms"* ]]; then return 0; fi
    if [[ "${line_l}" == *"booster title"* && "${instructions_l}" == *"title"* && "${instructions_l}" == *"tilepopcount"* ]]; then return 0; fi
    if [[ "${line_l}" == *"power-up fx poll"* && "${instructions_l}" == *"powerupfxcount"* ]]; then return 0; fi
    if [[ "${line_l}" == *"counter helper duplicates"* && "${instructions_l}" == *"duplicate"* ]] && contains_any_e2e_counter_term "${instructions_l}"; then return 0; fi
    if [[ "${line_l}" == *"vfx_timing"* && "${instructions_l}" == *"vfx_timing"* ]]; then return 0; fi
    if [[ "${line_l}" == *"vfx imports"* ]] && contains_any_vfx_import_term "${instructions_l}"; then return 0; fi
  done < "${OVERRIDES_FILE}"

  return 1
}

while IFS= read -r finding_json; do
  FINDING_FILE="$(jq -r '.fileName // ""' <<<"${finding_json}")"
  FINDING_INSTRUCTIONS="$(jq -r '.codegenInstructions // .message // ""' <<<"${finding_json}")"
  if finding_is_overridden "${FINDING_FILE}" "${FINDING_INSTRUCTIONS}"; then
    OVERRIDDEN_COUNT=$((OVERRIDDEN_COUNT + 1))
  else
    printf '%s\n' "${finding_json}" >> "${ACTIVE_FINDINGS_JSON}"
  fi
done < <(jq -c 'select(.type=="finding")' "${REPORT_JSON}")

# ---- Counts
RAW_FINDING_COUNT="$(jq -c 'select(.type=="finding")' "${REPORT_JSON}" | wc -l | tr -d ' ')"
CRITICAL_COUNT="$(jq -c 'select(.severity=="critical")' "${ACTIVE_FINDINGS_JSON}" | wc -l | tr -d ' ')"
MAJOR_COUNT="$(   jq -c 'select(.severity=="major")'    "${ACTIVE_FINDINGS_JSON}" | wc -l | tr -d ' ')"
MINOR_COUNT="$(   jq -c 'select(.severity=="minor")'    "${ACTIVE_FINDINGS_JSON}" | wc -l | tr -d ' ')"

BLOCKING_COUNT="$(
  jq -c '.' "${ACTIVE_FINDINGS_JSON}" \
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
log "Overrides: raw=${RAW_FINDING_COUNT} overridden=${OVERRIDDEN_COUNT}"
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
  jq -c '.' "${ACTIVE_FINDINGS_JSON}" \
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
  echo "   with a one-line rationale prefixed by \`override:\` or \`disagree:\`."
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
