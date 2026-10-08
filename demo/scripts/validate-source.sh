#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

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
  "${SCRIPT_DIR}/check-topology.sh"; do
  bash -n "${script}" || die "syntax validation failed for ${script}"
done

source "${SCRIPT_DIR}/demo-identities.sh"

[[ ${#DEMO_USERS[@]} -gt 0 ]] || \
  die "demo identity list is empty"

[[ ${#DEMO_USERS[@]} -eq ${#DEMO_ACCOUNTS[@]} ]] || \
  die "DEMO_USERS and DEMO_ACCOUNTS have different lengths"

[[ ${#DEMO_USERS[@]} -eq ${#DEMO_UIDS[@]} ]] || \
  die "DEMO_USERS and DEMO_UIDS have different lengths"

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
  "${SCRIPT_DIR}/check-topology.sh"; do
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
    "${SCRIPT_DIR}/check-topology.sh"; then
  die "job checks contain a hard-coded --account value"
fi

grep -Fq 'source demo/scripts/demo-identities.sh' \
  "${REPO_ROOT}/.github/workflows/demo-ci.yml" || \
  die "demo CI does not source the canonical identity map"

printf '[demo source check] source consistency passed\n'
