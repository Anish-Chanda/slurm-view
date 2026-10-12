#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
WORKLOAD_DIR="${DEMO_DIR}/workload"
SYSTEMD_SOURCE_DIR="${DEMO_DIR}/systemd"

INSTALL_ROOT=/usr/local/libexec/slurm-view-demo
SYSTEMD_UNIT_DIR=/etc/systemd/system
SERVICE_NAME=slurm-view-demo-workload.service
TIMER_NAME=slurm-view-demo-workload.timer
LOCK_FILE=/run/lock/slurm-view-demo-workload.lock
ENABLE_TIMER=0

log() {
  printf '[demo workload install] %s\n' "$*"
}

die() {
  printf '[demo workload install] error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: install-workload-service.sh [--enable]

Install the workload reconciler into /usr/local/libexec and its systemd units
into /etc/systemd/system. Pass --enable to enable and start the timer after
installation. Without --enable, an already-active timer is restarted, but a
new timer is left disabled so CI and manual validation can control when it runs.
USAGE
}

while (( $# > 0 )); do
  case "$1" in
    --enable)
      ENABLE_TIMER=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

[[ ${EUID} -eq 0 ]] || \
  die "run this script as root (for example: sudo ./demo/scripts/install-workload-service.sh --enable)"

for command in flock install mktemp mv rm systemctl systemd-analyze; do
  command -v "${command}" >/dev/null 2>&1 || die "${command} is required"
done

for path in \
  "${SCRIPT_DIR}/seed-workload.sh" \
  "${SCRIPT_DIR}/check-workload.sh" \
  "${SCRIPT_DIR}/demo-identities.sh" \
  "${WORKLOAD_DIR}/workload-spec.sh" \
  "${WORKLOAD_DIR}/steady-job.sh" \
  "${WORKLOAD_DIR}/array-task.sh" \
  "${SYSTEMD_SOURCE_DIR}/${SERVICE_NAME}" \
  "${SYSTEMD_SOURCE_DIR}/${TIMER_NAME}"; do
  [[ -r "${path}" ]] || die "missing ${path}"
done

TIMER_WAS_ACTIVE=0
if systemctl is-active --quiet "${TIMER_NAME}" 2>/dev/null; then
  TIMER_WAS_ACTIVE=1
  log "stopping active timer during installation"
  systemctl stop "${TIMER_NAME}"
fi

install -d -o root -g root -m 0755 "$(dirname -- "${INSTALL_ROOT}")"

exec 9>"${LOCK_FILE}"
if ! flock -w 60 9; then
  die "timed out waiting for workload reconciliation lock"
fi

STAGING_DIR="$(mktemp -d "${INSTALL_ROOT}.tmp.XXXXXX")"
BACKUP_DIR="${INSTALL_ROOT}.old.$$"

cleanup() {
  [[ -z "${STAGING_DIR:-}" ]] || rm -rf "${STAGING_DIR}" || true
}
trap cleanup EXIT

install -d -o root -g root -m 0755 \
  "${STAGING_DIR}/scripts" \
  "${STAGING_DIR}/workload"

install -o root -g root -m 0755 \
  "${SCRIPT_DIR}/seed-workload.sh" \
  "${SCRIPT_DIR}/check-workload.sh" \
  "${STAGING_DIR}/scripts/"

install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/demo-identities.sh" \
  "${STAGING_DIR}/scripts/demo-identities.sh"

install -o root -g root -m 0644 \
  "${WORKLOAD_DIR}/workload-spec.sh" \
  "${STAGING_DIR}/workload/workload-spec.sh"

install -o root -g root -m 0755 \
  "${WORKLOAD_DIR}/steady-job.sh" \
  "${WORKLOAD_DIR}/array-task.sh" \
  "${STAGING_DIR}/workload/"

bash -n "${STAGING_DIR}/scripts/seed-workload.sh"
bash -n "${STAGING_DIR}/scripts/check-workload.sh"
bash -n "${STAGING_DIR}/scripts/demo-identities.sh"
bash -n "${STAGING_DIR}/workload/workload-spec.sh"
bash -n "${STAGING_DIR}/workload/steady-job.sh"
bash -n "${STAGING_DIR}/workload/array-task.sh"

rm -rf "${BACKUP_DIR}"
if [[ -e "${INSTALL_ROOT}" ]]; then
  mv "${INSTALL_ROOT}" "${BACKUP_DIR}"
fi

if ! mv "${STAGING_DIR}" "${INSTALL_ROOT}"; then
  [[ ! -e "${BACKUP_DIR}" ]] || mv "${BACKUP_DIR}" "${INSTALL_ROOT}"
  die "failed to install workload reconciler"
fi
STAGING_DIR=""
rm -rf "${BACKUP_DIR}"

install -o root -g root -m 0644 \
  "${SYSTEMD_SOURCE_DIR}/${SERVICE_NAME}" \
  "${SYSTEMD_UNIT_DIR}/${SERVICE_NAME}"

install -o root -g root -m 0644 \
  "${SYSTEMD_SOURCE_DIR}/${TIMER_NAME}" \
  "${SYSTEMD_UNIT_DIR}/${TIMER_NAME}"

if command -v restorecon >/dev/null 2>&1; then
  restorecon -RF "${INSTALL_ROOT}" || true
  restorecon -F \
    "${SYSTEMD_UNIT_DIR}/${SERVICE_NAME}" \
    "${SYSTEMD_UNIT_DIR}/${TIMER_NAME}" \
    || true
fi

systemd-analyze verify \
  "${SYSTEMD_UNIT_DIR}/${SERVICE_NAME}" \
  "${SYSTEMD_UNIT_DIR}/${TIMER_NAME}"

systemctl daemon-reload
flock -u 9

if (( ENABLE_TIMER == 1 )); then
  log "enabling workload reconciliation timer"
  systemctl enable --now "${TIMER_NAME}"
elif (( TIMER_WAS_ACTIVE == 1 )); then
  log "restarting previously-active workload timer"
  systemctl start "${TIMER_NAME}"
fi

log "workload reconciler installed"
log "service: ${SERVICE_NAME}"
log "timer: ${TIMER_NAME}"
