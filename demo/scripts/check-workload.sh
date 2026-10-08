#!/usr/bin/env bash
set -euo pipefail
shopt -s inherit_errexit

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
WORKLOAD_DIR="${DEMO_DIR}/workload"

source "${SCRIPT_DIR}/demo-identities.sh"
source "${WORKLOAD_DIR}/workload-spec.sh"

log() {
  printf '[demo workload check] %s\n' "$*"
}

die() {
  printf '[demo workload check] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root"

for command in awk date grep head seq sleep sort scontrol squeue; do
  command -v "${command}" >/dev/null 2>&1 || die "${command} is required"
done

scontrol ping 2>/dev/null | grep -q 'UP' || die "slurmctld is not responding"

active_slot_ids() {
  local slot=$1
  local comment

  comment="$(workload_comment_for "${slot}")"

  squeue -a -h -o '%F|%k' \
    | awk -F'|' -v comment="${comment}" '$2 == comment { print $1 }' \
    | sort -u
}

slot_id() {
  local slot=$1
  local -a ids=()

  mapfile -t ids < <(active_slot_ids "${slot}")
  [[ ${#ids[@]} -eq 1 ]] || \
    die "expected one active job for ${slot}, found ${#ids[@]}"

  printf '%s\n' "${ids[0]}"
}

state_for() {
  local job_id=$1
  squeue -a -h -j "${job_id}" -o '%T' | head -n 1
}

reason_for() {
  local job_id=$1

  scontrol -o show job "${job_id}" 2>/dev/null \
    | awk '{
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^Reason=/) {
            sub(/^Reason=/, "", $i)
            sub(/,.*/, "", $i)
            print $i
            exit
          }
        }
      }'
}

wait_reason() {
  local job_id=$1
  local expected=$2
  local state=""
  local reason=""

  for _ in $(seq 1 40); do
    state="$(state_for "${job_id}" || true)"
    reason="$(reason_for "${job_id}" || true)"

    if [[ "${state}" == "PENDING" && "${reason}" == "${expected}" ]]; then
      return 0
    fi

    [[ "${state}" == "PENDING" ]] || break
    sleep 0.25
  done

  squeue -a -j "${job_id}" \
    -o '%.18i %.24j %.10u %.12a %.10q %.10T %.32R' >&2 || true
  return 1
}

log "checking running showcase jobs"
for slot in "${DEMO_RUNNING_SLOTS[@]}"; do
  job_id="$(slot_id "${slot}")"
  state="$(state_for "${job_id}" || true)"
  [[ "${state}" == "RUNNING" ]] || \
    die "${slot} should be RUNNING, got ${state:-missing}"
done

[[ ${#DEMO_PENDING_SLOTS[@]} -eq ${#DEMO_PENDING_REASONS[@]} ]] || \
  die "pending slot/reason specification length mismatch"

log "checking pending-analysis showcase jobs"
for index in "${!DEMO_PENDING_SLOTS[@]}"; do
  slot="${DEMO_PENDING_SLOTS[$index]}"
  expected="${DEMO_PENDING_REASONS[$index]}"
  job_id="$(slot_id "${slot}")"

  wait_reason "${job_id}" "${expected}" || \
    die "${slot} did not report ${expected}"
done

log "checking parameter sweep"
ARRAY_ID="$(slot_id "${DEMO_ARRAY_SLOT}")"

read -r ARRAY_ACTIVE ARRAY_RUNNING ARRAY_PENDING ARRAY_THROTTLED < <(
  squeue --array -a -h -j "${ARRAY_ID}" -o '%T|%r' \
    | awk -F'|' '
        {
          active++
          if ($1 == "RUNNING") running++
          if ($1 == "PENDING") pending++
          if ($1 == "PENDING" && $2 == "JobArrayTaskLimit") throttled++
        }
        END {
          print active + 0, running + 0, pending + 0, throttled + 0
        }
      '
)

(( ARRAY_ACTIVE > 0 )) || die "parameter sweep has no active tasks"
(( ARRAY_RUNNING >= 1 )) || die "parameter sweep has no running tasks"
(( ARRAY_RUNNING <= DEMO_ARRAY_THROTTLE )) || \
  die "parameter sweep exceeds throttle ${DEMO_ARRAY_THROTTLE}"

if (( ARRAY_PENDING > DEMO_ARRAY_THROTTLE )); then
  (( ARRAY_THROTTLED > 0 )) || \
    die "parameter sweep has pending tasks but no JobArrayTaskLimit evidence"
fi

log "checking GPU chart anchors"
for pair in \
  'gpu01|v100' \
  'gpu02|a100' \
  'gpu03|h100' \
  'gpu04|l40s' \
  'gpu05|mi250'; do
  node="${pair%%|*}"
  gpu_type="${pair##*|}"
  node_row="$(scontrol -o show node "${node}")"

  [[ "${node_row}" == *"GresUsed=gpu:${gpu_type}:1"* ]] || \
    die "${node} should have one allocated ${gpu_type} GPU"
done

log "checking future reservation"
RESERVATION_ROW="$(
  scontrol -o show reservation "${DEMO_RESERVATION_NAME}" 2>/dev/null || true
)"
[[ "${RESERVATION_ROW}" == *"ReservationName=${DEMO_RESERVATION_NAME}"* ]] || \
  die "missing ${DEMO_RESERVATION_NAME} reservation"
[[ "${RESERVATION_ROW}" == *"Nodes=${DEMO_RESERVATION_NODE}"* ]] || \
  die "${DEMO_RESERVATION_NAME} should reserve ${DEMO_RESERVATION_NODE}"
[[ "${RESERVATION_ROW}" == *"Users=${DEMO_RESERVATION_USER}"* ]] || \
  die "${DEMO_RESERVATION_NAME} should be available to ${DEMO_RESERVATION_USER}"
[[ "${RESERVATION_ROW}" == *"Duration=00:${DEMO_RESERVATION_DURATION_MINUTES}:00"* ]] || \
  die "${DEMO_RESERVATION_NAME} should last ${DEMO_RESERVATION_DURATION_MINUTES} minutes"

RESERVATION_START="$(
  awk '{
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^StartTime=/) {
        sub(/^StartTime=/, "", $i)
        print $i
        exit
      }
    }
  }' <<< "${RESERVATION_ROW}"
)"
RESERVATION_START_EPOCH="$(
  date --date="${RESERVATION_START}" +%s 2>/dev/null || printf '0'
)"
(( RESERVATION_START_EPOCH > $(date +%s) )) || \
  die "${DEMO_RESERVATION_NAME} should start in the future"

log "seeded workload checks passed"
printf 'active_array_tasks=%s running_array_tasks=%s pending_array_tasks=%s\n' \
  "${ARRAY_ACTIVE}" \
  "${ARRAY_RUNNING}" \
  "${ARRAY_PENDING}"
