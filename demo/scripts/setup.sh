#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
VERSIONS_FILE="${DEMO_DIR}/versions.env"

DEMO_STATE_ROOT="${SLURM_VIEW_DEMO_STATE_DIR:-/srv/slurm-view-demo}"
RUNTIME_STATE_DIR="${DEMO_STATE_ROOT}/state"
RESOLVED_VERSIONS_FILE="${RUNTIME_STATE_DIR}/versions.env"
CONFIG_DIR="${DEMO_STATE_ROOT}/config"
SECRETS_DIR="${DEMO_STATE_ROOT}/secrets"
SHARED_HOME_DIR="${DEMO_STATE_ROOT}/shared-home"

export SLURM_VIEW_DEMO_STATE_DIR="${DEMO_STATE_ROOT}"

log() {
  printf '[demo setup] %s\n' "$*"
}

die() {
  printf '[demo setup] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root (for example: sudo ./demo/scripts/setup.sh)"
[[ -f "${VERSIONS_FILE}" ]] || die "missing ${VERSIONS_FILE}"
[[ -s "${RESOLVED_VERSIONS_FILE}" ]] || die "host bootstrap has not been completed"
[[ -s "${SECRETS_DIR}/munge.key" ]] || die "demo MUNGE key is missing"

source "${VERSIONS_FILE}"
source "${RESOLVED_VERSIONS_FILE}"

: "${ROCKY_MAJOR:?ROCKY_MAJOR is required}"
: "${OPENHPC_MAJOR:?OPENHPC_MAJOR is required}"
: "${SLURM_VERSION:?SLURM_VERSION is required}"
: "${SLURM_RELEASE:?SLURM_RELEASE is required}"

export ROCKY_MAJOR OPENHPC_MAJOR SLURM_VERSION SLURM_RELEASE

command -v docker >/dev/null 2>&1 || die "Docker is required"
docker info >/dev/null 2>&1 || die "Docker daemon is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
command -v sacctmgr >/dev/null 2>&1 || die "sacctmgr is required; run bootstrap-host.sh first"
command -v runuser >/dev/null 2>&1 || die "runuser is required"

log "creating runtime directories"
install -d -o root -g root -m 0755 "${CONFIG_DIR}" "${DEMO_STATE_ROOT}/slurmctld" "${DEMO_STATE_ROOT}/slurmdbd" "${SHARED_HOME_DIR}"
install -d -o root -g root -m 0700 "${SECRETS_DIR}"
install -d -o 64030 -g 64030 -m 0755 "${DEMO_STATE_ROOT}/slurmctld" "${DEMO_STATE_ROOT}/slurmdbd"
install -d -o 20001 -g 20001 -m 0755 "${SHARED_HOME_DIR}/demo01"

if getent group demo01 >/dev/null 2>&1; then
  [[ "$(getent group demo01 | cut -d: -f3)" == "20001" ]] || die "existing demo01 group does not use GID 20001"
else
  groupadd --gid 20001 demo01
fi

if id demo01 >/dev/null 2>&1; then
  [[ "$(id -u demo01)" == "20001" ]] || die "existing demo01 user does not use UID 20001"
  [[ "$(id -g demo01)" == "20001" ]] || die "existing demo01 user does not use GID 20001"
else
  useradd \
    --uid 20001 \
    --gid 20001 \
    --no-create-home \
    --home-dir "${SHARED_HOME_DIR}/demo01" \
    --shell /usr/sbin/nologin \
    demo01
fi
chown 20001:20001 "${SHARED_HOME_DIR}/demo01"

create_secret() {
  local path=$1

  if [[ ! -s "${path}" ]]; then
    umask 077
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "${path}"
    printf '\n' >> "${path}"
    chmod 0600 "${path}"
    chown root:root "${path}"
  fi
}

log "ensuring database credentials exist"
create_secret "${SECRETS_DIR}/mariadb-root-password"
create_secret "${SECRETS_DIR}/slurmdbd-storage-password"

log "installing Slurm configuration"
install -o root -g root -m 0644 "${DEMO_DIR}/slurm/slurm.conf" "${CONFIG_DIR}/slurm.conf"
install -o root -g root -m 0644 "${DEMO_DIR}/slurm/cgroup.conf" "${CONFIG_DIR}/cgroup.conf"
install -d -o root -g root -m 0755 /etc/slurm
install -o root -g root -m 0644 "${DEMO_DIR}/slurm/slurm.conf" /etc/slurm/slurm.conf
install -o root -g root -m 0644 "${DEMO_DIR}/slurm/cgroup.conf" /etc/slurm/cgroup.conf

STORAGE_PASSWORD="$(tr -d '\n' < "${SECRETS_DIR}/slurmdbd-storage-password")"
[[ "${STORAGE_PASSWORD}" != *'#'* ]] || die "generated database password contains unsupported # character"

sed "s/@STORAGE_PASSWORD@/${STORAGE_PASSWORD}/g" \
  "${DEMO_DIR}/slurm/slurmdbd.conf.template" \
  > "${CONFIG_DIR}/slurmdbd.conf.tmp"
chown root:64030 "${CONFIG_DIR}/slurmdbd.conf.tmp"
chmod 0640 "${CONFIG_DIR}/slurmdbd.conf.tmp"
mv -f "${CONFIG_DIR}/slurmdbd.conf.tmp" "${CONFIG_DIR}/slurmdbd.conf"

compose() {
  docker compose -f "${DEMO_DIR}/compose.yaml" "$@"
}

log "building Slurm image ${SLURM_VERSION}-${SLURM_RELEASE}"
compose build slurmctld

log "starting MariaDB"
compose up -d mariadb

MARIADB_ID="$(compose ps -q mariadb)"
[[ -n "${MARIADB_ID}" ]] || die "MariaDB container was not created"

for _ in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${MARIADB_ID}" 2>/dev/null || true)" == "healthy" ]]; then
    break
  fi
  sleep 2
done

[[ "$(docker inspect --format '{{.State.Health.Status}}' "${MARIADB_ID}" 2>/dev/null || true)" == "healthy" ]] || {
  compose logs mariadb >&2 || true
  die "MariaDB did not become healthy"
}

log "starting slurmdbd"
compose up -d slurmdbd

for _ in $(seq 1 60); do
  if sacctmgr -nP show cluster format=Cluster >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! sacctmgr -nP show cluster format=Cluster >/dev/null 2>&1; then
  compose logs slurmdbd >&2 || true
  die "slurmdbd did not become reachable"
fi

"${SCRIPT_DIR}/init-accounting.sh"

log "starting controller and cpu01"
compose up -d slurmctld cpu01

for _ in $(seq 1 60); do
  if scontrol ping 2>/dev/null | grep -q 'UP'; then
    break
  fi
  sleep 2
done

scontrol ping 2>/dev/null | grep -q 'UP' || {
  compose logs slurmctld >&2 || true
  die "slurmctld did not become reachable"
}

for _ in $(seq 1 60); do
  NODE_STATE="$(sinfo -h -N -n cpu01 -o '%T' 2>/dev/null | head -n 1 || true)"
  if [[ "${NODE_STATE}" == idle* ]]; then
    break
  fi
  sleep 2
done

NODE_STATE="$(sinfo -h -N -n cpu01 -o '%T' 2>/dev/null | head -n 1 || true)"
[[ "${NODE_STATE}" == idle* ]] || {
  compose logs cpu01 >&2 || true
  scontrol show node cpu01 >&2 || true
  die "cpu01 did not reach IDLE state (state: ${NODE_STATE:-unknown})"
}

log "minimal cluster is ready"
"${SCRIPT_DIR}/check.sh"
