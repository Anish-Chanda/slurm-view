#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
WORKLOAD_DIR="${REPO_ROOT}/demo/workload"
SYSTEMD_DIR="${REPO_ROOT}/demo/systemd"

die() {
  printf '[demo source check] error: %s\n' "$*" >&2
  exit 1
}

for script in \
  "${SCRIPT_DIR}/demo-identities.sh" \
  "${SCRIPT_DIR}/bootstrap-host.sh" \
  "${SCRIPT_DIR}/ensure-json-serializer.sh" \
  "${SCRIPT_DIR}/init-accounting.sh" \
  "${SCRIPT_DIR}/setup.sh" \
  "${SCRIPT_DIR}/check.sh" \
  "${SCRIPT_DIR}/check-topology.sh" \
  "${SCRIPT_DIR}/seed-workload.sh" \
  "${SCRIPT_DIR}/check-workload.sh" \
  "${SCRIPT_DIR}/install-workload-service.sh" \
  "${WORKLOAD_DIR}/workload-spec.sh" \
  "${WORKLOAD_DIR}/steady-job.sh" \
  "${WORKLOAD_DIR}/array-task.sh"; do
  bash -n "${script}" || die "syntax validation failed for ${script}"
done

source "${SCRIPT_DIR}/demo-identities.sh"
source "${WORKLOAD_DIR}/workload-spec.sh"

[[ ${#DEMO_USERS[@]} -gt 0 ]] || \
  die "demo identity list is empty"

[[ ${#DEMO_USERS[@]} -eq ${#DEMO_ACCOUNTS[@]} ]] || \
  die "DEMO_USERS and DEMO_ACCOUNTS have different lengths"

[[ ${#DEMO_USERS[@]} -eq ${#DEMO_UIDS[@]} ]] || \
  die "DEMO_USERS and DEMO_UIDS have different lengths"

[[ ${#DEMO_PENDING_SLOTS[@]} -eq ${#DEMO_PENDING_REASONS[@]} ]] || \
  die "DEMO_PENDING_SLOTS and DEMO_PENDING_REASONS have different lengths"

declare -A seen_slots=()
for slot in \
  "${DEMO_RUNNING_SLOTS[@]}" \
  "${DEMO_PENDING_SLOTS[@]}" \
  "${DEMO_ARRAY_SLOT}"; do
  [[ -n "${slot}" ]] || die "workload contains an empty slot"
  [[ -z "${seen_slots[$slot]:-}" ]] || die "duplicate workload slot ${slot}"
  seen_slots["${slot}"]=1
done

declare -A seen_users=()
declare -A seen_uids=()

for index in "${!DEMO_USERS[@]}"; do
  user="${DEMO_USERS[$index]}"
  account="${DEMO_ACCOUNTS[$index]}"
  uid="${DEMO_UIDS[$index]}"

  [[ -n "${user}" ]] || die "empty user at identity index ${index}"
  [[ -n "${account}" ]] || die "empty account for ${user}"
  [[ "${uid}" =~ ^[0-9]+$ ]] || die "invalid UID ${uid} for ${user}"

  [[ -z "${seen_users[$user]:-}" ]] || \
    die "duplicate demo user ${user}"
  seen_users["${user}"]=1

  [[ -z "${seen_uids[$uid]:-}" ]] || \
    die "duplicate demo UID ${uid}"
  seen_uids["${uid}"]=1

  resolved="$(demo_account_for "${user}")"
  [[ "${resolved}" == "${account}" ]] || \
    die "demo_account_for ${user} returned ${resolved}, expected ${account}"
done

for script in \
  "${SCRIPT_DIR}/setup.sh" \
  "${SCRIPT_DIR}/init-accounting.sh" \
  "${SCRIPT_DIR}/check.sh" \
  "${SCRIPT_DIR}/check-topology.sh" \
  "${SCRIPT_DIR}/seed-workload.sh" \
  "${SCRIPT_DIR}/check-workload.sh"; do
  grep -Fq 'source "${SCRIPT_DIR}/demo-identities.sh"' "${script}" || \
    die "${script} does not source demo-identities.sh"

  if grep -q '^DEMO_USERS=(' "${script}"; then
    die "${script} duplicates DEMO_USERS instead of using demo-identities.sh"
  fi

  if grep -q '^DEMO_ACCOUNTS=(' "${script}"; then
    die "${script} duplicates DEMO_ACCOUNTS instead of using demo-identities.sh"
  fi
done

if grep -nE \
    -- '--account="?([a-z][a-z0-9_-]*)"?' \
    "${SCRIPT_DIR}/check.sh" \
    "${SCRIPT_DIR}/check-topology.sh" \
    "${SCRIPT_DIR}/seed-workload.sh" \
    "${SCRIPT_DIR}/check-workload.sh"; then
  die "job checks contain a hard-coded --account value"
fi


for script in \
  "${SCRIPT_DIR}/seed-workload.sh" \
  "${SCRIPT_DIR}/check-workload.sh"; do
  grep -Fq 'source "${WORKLOAD_DIR}/workload-spec.sh"' "${script}" || \
    die "${script} does not source workload-spec.sh"
done

for unit in \
  "${SYSTEMD_DIR}/slurm-view-demo-workload.service" \
  "${SYSTEMD_DIR}/slurm-view-demo-workload.timer"; do
  [[ -r "${unit}" ]] || die "missing ${unit}"
done

grep -Fq \
  'ExecStart=/usr/local/libexec/slurm-view-demo/scripts/seed-workload.sh' \
  "${SYSTEMD_DIR}/slurm-view-demo-workload.service" || \
  die "workload service does not execute the installed reconciler"

grep -Fq 'OnUnitInactiveSec=5min' \
  "${SYSTEMD_DIR}/slurm-view-demo-workload.timer" || \
  die "workload timer does not use the expected reconciliation interval"

grep -Fq 'Unit=slurm-view-demo-workload.service' \
  "${SYSTEMD_DIR}/slurm-view-demo-workload.timer" || \
  die "workload timer is not linked to the workload service"

grep -Fq 'source demo/scripts/demo-identities.sh' \
  "${REPO_ROOT}/.github/workflows/demo-ci.yml" || \
  die "demo CI does not source the canonical identity map"

printf '[demo source check] source consistency passed\n'
