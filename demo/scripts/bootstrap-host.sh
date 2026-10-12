#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
VERSIONS_FILE="${DEMO_DIR}/versions.env"

DEMO_STATE_ROOT="${SLURM_VIEW_DEMO_STATE_DIR:-/srv/slurm-view-demo}"
RUNTIME_STATE_DIR="${DEMO_STATE_ROOT}/state"
SECRETS_DIR="${DEMO_STATE_ROOT}/secrets"
RESOLVED_VERSIONS_FILE="${RUNTIME_STATE_DIR}/versions.env"
MUNGE_KEY_SOURCE="${SECRETS_DIR}/munge.key"
MUNGE_KEY_HOST="/etc/munge/munge.key"

log() {
  printf '[demo bootstrap] %s\n' "$*"
}

die() {
  printf '[demo bootstrap] error: %s\n' "$*" >&2
  exit 1
}

if [[ ${EUID} -ne 0 ]]; then
  die "run this script as root (for example: sudo ./demo/scripts/bootstrap-host.sh)"
fi

[[ -f "${VERSIONS_FILE}" ]] || die "missing ${VERSIONS_FILE}"
source "${VERSIONS_FILE}"

: "${ROCKY_MAJOR:?ROCKY_MAJOR must be set in demo/versions.env}"
: "${OPENHPC_MAJOR:?OPENHPC_MAJOR must be set in demo/versions.env}"
: "${SLURM_SERIES:?SLURM_SERIES must be set in demo/versions.env}"

[[ "${SLURM_SERIES}" =~ ^[0-9]+\.[0-9]+$ ]] || \
  die "SLURM_SERIES must look like 25.05, found ${SLURM_SERIES}"

[[ -r /etc/os-release ]] || die "/etc/os-release is not readable"
source /etc/os-release

OS_MAJOR="${VERSION_ID%%.*}"
[[ "${ID}" == "rocky" ]] || die "unsupported OS: expected Rocky Linux, found ${ID:-unknown}"
[[ "${OS_MAJOR}" == "${ROCKY_MAJOR}" ]] || \
  die "unsupported Rocky Linux major version: expected ${ROCKY_MAJOR}, found ${VERSION_ID:-unknown}"
[[ "$(uname -m)" == "x86_64" ]] || die "this demo currently supports x86_64 only"

command -v dnf >/dev/null 2>&1 || die "dnf is required"
command -v rpm >/dev/null 2>&1 || die "rpm is required"
command -v docker >/dev/null 2>&1 || die "Docker is required and must be installed before running this script"
docker info >/dev/null 2>&1 || die "Docker daemon is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"

log "creating demo state directories"
install -d -o root -g root -m 0755 "${DEMO_STATE_ROOT}"
install -d -o root -g root -m 0755 "${RUNTIME_STATE_DIR}"
install -d -o root -g root -m 0700 "${SECRETS_DIR}"

OHPC_RELEASE_RPM="ohpc-release-${OPENHPC_MAJOR}-1.el${ROCKY_MAJOR}.x86_64.rpm"
OHPC_RELEASE_URL="https://repos.openhpc.community/OpenHPC/${OPENHPC_MAJOR}/EL_${ROCKY_MAJOR}/x86_64/${OHPC_RELEASE_RPM}"

if ! rpm -q ohpc-release >/dev/null 2>&1; then
  log "installing OpenHPC ${OPENHPC_MAJOR} repository"
  dnf install -y "${OHPC_RELEASE_URL}"
else
  INSTALLED_OHPC_MAJOR="$(rpm -q --qf '%{VERSION}' ohpc-release)"
  INSTALLED_OHPC_MAJOR="${INSTALLED_OHPC_MAJOR%%.*}"
  [[ "${INSTALLED_OHPC_MAJOR}" == "${OPENHPC_MAJOR}" ]] || \
    die "unexpected OpenHPC repository major version: expected ${OPENHPC_MAJOR}, found ${INSTALLED_OHPC_MAJOR}"
  log "OpenHPC repository package is already installed"
fi

log "refreshing package metadata"
dnf makecache --refresh -y >/dev/null

if [[ -s "${RESOLVED_VERSIONS_FILE}" ]]; then
  log "reusing previously resolved Slurm package version"
  source "${RESOLVED_VERSIONS_FILE}"

  : "${SLURM_VERSION:?SLURM_VERSION missing from ${RESOLVED_VERSIONS_FILE}}"
  : "${SLURM_RELEASE:?SLURM_RELEASE missing from ${RESOLVED_VERSIONS_FILE}}"
else
  log "resolving latest Slurm ${SLURM_SERIES}.x package from OpenHPC"

  RESOLVED_SLURM="$({
    dnf repoquery \
      --available \
      --qf '%{version}|%{release}' \
      slurm-ohpc.x86_64
  } | awk -F '|' -v series="${SLURM_SERIES}" \
      '$1 ~ ("^" series "\\.[0-9]+$") { print $0 }' \
    | sort -V \
    | tail -n 1)"

  [[ -n "${RESOLVED_SLURM}" ]] || \
    die "no Slurm ${SLURM_SERIES}.x package is available from the configured OpenHPC repositories"

  IFS='|' read -r SLURM_VERSION SLURM_RELEASE <<< "${RESOLVED_SLURM}"

  TMP_VERSIONS_FILE="$(mktemp "${RUNTIME_STATE_DIR}/versions.env.XXXXXX")"
  printf 'SLURM_VERSION=%q\nSLURM_RELEASE=%q\n' \
    "${SLURM_VERSION}" \
    "${SLURM_RELEASE}" \
    > "${TMP_VERSIONS_FILE}"
  chmod 0644 "${TMP_VERSIONS_FILE}"
  mv -f "${TMP_VERSIONS_FILE}" "${RESOLVED_VERSIONS_FILE}"
fi

[[ "${SLURM_VERSION}" == "${SLURM_SERIES}."* ]] || \
  die "resolved Slurm version ${SLURM_VERSION} is outside supported series ${SLURM_SERIES}.x"

SLURM_NEVRA="${SLURM_VERSION}-${SLURM_RELEASE}.x86_64"

log "installing Slurm ${SLURM_VERSION}-${SLURM_RELEASE} client packages and MUNGE"
dnf install -y \
  "slurm-ohpc-${SLURM_NEVRA}" \
  "slurm-contribs-ohpc-${SLURM_NEVRA}" \
  "slurm-perlapi-ohpc-${SLURM_NEVRA}" \
  munge \
  perl-Sys-Hostname

INSTALLED_SLURM="$(rpm -q --qf '%{VERSION}-%{RELEASE}' slurm-ohpc)"
EXPECTED_SLURM="${SLURM_VERSION}-${SLURM_RELEASE}"
[[ "${INSTALLED_SLURM}" == "${EXPECTED_SLURM}" ]] || \
  die "unexpected Slurm package version: expected ${EXPECTED_SLURM}, found ${INSTALLED_SLURM}"

command -v squeue >/dev/null 2>&1 || die "squeue was not installed"
command -v seff >/dev/null 2>&1 || die "seff was not installed"
command -v perl >/dev/null 2>&1 || die "Perl was not installed"

log "ensuring Slurm JSON serializer is available"
SLURM_VIEW_DEMO_STATE_DIR="${DEMO_STATE_ROOT}" \
  "${SCRIPT_DIR}/ensure-json-serializer.sh" \
    "${SLURM_VERSION}" \
    "${SLURM_RELEASE}"

if [[ ! -s "${MUNGE_KEY_SOURCE}" ]]; then
  if [[ -s "${MUNGE_KEY_HOST}" ]]; then
    log "adopting existing host MUNGE key as the demo key"
    install -o root -g root -m 0600 "${MUNGE_KEY_HOST}" "${MUNGE_KEY_SOURCE}"
  else
    log "generating demo MUNGE key"
    umask 077
    head -c 1024 /dev/urandom > "${MUNGE_KEY_SOURCE}"
    chown root:root "${MUNGE_KEY_SOURCE}"
    chmod 0600 "${MUNGE_KEY_SOURCE}"
  fi
else
  log "reusing existing demo MUNGE key"
fi

MUNGE_KEY_CHANGED=0
if [[ ! -f "${MUNGE_KEY_HOST}" ]] || ! cmp -s "${MUNGE_KEY_SOURCE}" "${MUNGE_KEY_HOST}"; then
  log "installing demo MUNGE key on the host"
  install -o munge -g munge -m 0400 "${MUNGE_KEY_SOURCE}" "${MUNGE_KEY_HOST}"
  MUNGE_KEY_CHANGED=1
else
  chown munge:munge "${MUNGE_KEY_HOST}"
  chmod 0400 "${MUNGE_KEY_HOST}"
fi

if command -v restorecon >/dev/null 2>&1; then
  restorecon -F "${MUNGE_KEY_HOST}"
fi

if systemctl is-active --quiet munge; then
  if [[ ${MUNGE_KEY_CHANGED} -eq 1 ]]; then
    log "restarting MUNGE after key update"
    systemctl restart munge
  fi
else
  log "starting MUNGE"
  systemctl start munge
fi
systemctl enable munge >/dev/null

log "verifying MUNGE authentication"
munge -n | unmunge >/dev/null

log "host bootstrap complete"
printf '  Slurm:  %s\n' "${SLURM_VERSION}"
printf '  seff:   %s\n' "$(command -v seff)"
printf '  MUNGE:  %s\n' "$(systemctl is-active munge)"
printf '  state:  %s\n' "${DEMO_STATE_ROOT}"
