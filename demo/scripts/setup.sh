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

DEMO_USERS=(demo01 demo02 demo03 demo04 demo05 demo06)
DEMO_UIDS=(20001 20002 20003 20004 20005 20006)
NODE_SERVICES=(
  cpu01 cpu02 cpu03 cpu04 cpu05 cpu06 cpu07 cpu08
  highmem01 highmem02 highmem03
  gpu01 gpu02 gpu03 gpu04 gpu05
)

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

id slurm >/dev/null 2>&1 || die "host Slurm service user is missing"

SLURM_UID="$(id -u slurm)"
SLURM_GID="$(id -g slurm)"

[[ "${SLURM_UID}" != "0" ]] || die "Slurm service user must not be root"
[[ "${SLURM_GID}" != "0" ]] || die "Slurm service group must not be root"

export \
  ROCKY_MAJOR \
  OPENHPC_MAJOR \
  SLURM_VERSION \
  SLURM_RELEASE \
  SLURM_UID \
  SLURM_GID

log "using host Slurm service identity ${SLURM_UID}:${SLURM_GID}"

command -v docker >/dev/null 2>&1 || die "Docker is required"
docker info >/dev/null 2>&1 || die "Docker daemon is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
command -v sacctmgr >/dev/null 2>&1 || die "sacctmgr is required; run bootstrap-host.sh first"
command -v runuser >/dev/null 2>&1 || die "runuser is required"

log "creating runtime directories"
install -d -o root -g root -m 0755 \
  "${CONFIG_DIR}" \
  "${DEMO_STATE_ROOT}/slurmctld" \
  "${DEMO_STATE_ROOT}/slurmdbd" \
  "${SHARED_HOME_DIR}"
install -d -o root -g root -m 0700 "${SECRETS_DIR}"
install -d -o "${SLURM_UID}" -g "${SLURM_GID}" -m 0755 \
  "${DEMO_STATE_ROOT}/slurmctld" \
  "${DEMO_STATE_ROOT}/slurmdbd"

chown -R "${SLURM_UID}:${SLURM_GID}" \
  "${DEMO_STATE_ROOT}/slurmctld" \
  "${DEMO_STATE_ROOT}/slurmdbd"

ensure_demo_user() {
  local user=$1
  local uid=$2

  if getent group "${user}" >/dev/null 2>&1; then
    [[ "$(getent group "${user}" | cut -d: -f3)" == "${uid}" ]] || \
      die "existing ${user} group does not use GID ${uid}"
  else
    groupadd --gid "${uid}" "${user}"
  fi

  if id "${user}" >/dev/null 2>&1; then
    [[ "$(id -u "${user}")" == "${uid}" ]] || \
      die "existing ${user} user does not use UID ${uid}"
    [[ "$(id -g "${user}")" == "${uid}" ]] || \
      die "existing ${user} user does not use GID ${uid}"
  else
    useradd \
      --uid "${uid}" \
      --gid "${uid}" \
      --no-create-home \
      --home-dir "${SHARED_HOME_DIR}/${user}" \
      --shell /usr/sbin/nologin \
      "${user}"
  fi

  install -d -o "${uid}" -g "${uid}" -m 0755 "${SHARED_HOME_DIR}/${user}"
}

for index in "${!DEMO_USERS[@]}"; do
  ensure_demo_user "${DEMO_USERS[$index]}" "${DEMO_UIDS[$index]}"
done

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

write_runtime_config() {
  local source=$1
  local target=$2
  local owner=$3
  local group=$4
  local mode=$5

  if [[ -e "${target}" ]]; then
    cat "${source}" > "${target}"
  else
    install \
      -o "${owner}" \
      -g "${group}" \
      -m "${mode}" \
      "${source}" \
      "${target}"
  fi

  chown "${owner}:${group}" "${target}"
  chmod "${mode}" "${target}"
}

log "installing Slurm configuration"
for config in slurm.conf cgroup.conf gres.conf; do
  write_runtime_config \
    "${DEMO_DIR}/slurm/${config}" \
    "${CONFIG_DIR}/${config}" \
    root root 0644
done

install -d -o root -g root -m 0755 /etc/slurm
for config in slurm.conf cgroup.conf gres.conf; do
  install -o root -g root -m 0644 \
    "${DEMO_DIR}/slurm/${config}" \
    "/etc/slurm/${config}"
done

STORAGE_PASSWORD="$(tr -d '\n' < "${SECRETS_DIR}/slurmdbd-storage-password")"
[[ "${STORAGE_PASSWORD}" != *'#'* ]] || die "generated database password contains unsupported # character"

if [[ -e "${CONFIG_DIR}/slurmdbd.conf" ]]; then
  sed "s/@STORAGE_PASSWORD@/${STORAGE_PASSWORD}/g" \
    "${DEMO_DIR}/slurm/slurmdbd.conf.template" \
    > "${CONFIG_DIR}/slurmdbd.conf"
else
  (
    umask 077
    sed "s/@STORAGE_PASSWORD@/${STORAGE_PASSWORD}/g" \
      "${DEMO_DIR}/slurm/slurmdbd.conf.template" \
      > "${CONFIG_DIR}/slurmdbd.conf"
  )
fi

chown "${SLURM_UID}:${SLURM_GID}" "${CONFIG_DIR}/slurmdbd.conf"
chmod 0600 "${CONFIG_DIR}/slurmdbd.conf"

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
compose up -d --force-recreate slurmdbd

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

log "starting controller and 16 demo nodes"
compose up -d --force-recreate slurmctld "${NODE_SERVICES[@]}"

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

node_ready() {
  local node=$1
  local state

  state="$(sinfo -h -N -n "${node}" -o '%T' 2>/dev/null | head -n 1 || true)"

  case "${state}" in
    idle*|allocated*|mixed*|completing*|drained*|draining*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

for _ in $(seq 1 90); do
  all_ready=1

  for node in "${NODE_SERVICES[@]}"; do
    if ! node_ready "${node}"; then
      all_ready=0
      break
    fi
  done

  [[ ${all_ready} -eq 1 ]] && break
  sleep 2
done

for node in "${NODE_SERVICES[@]}"; do
  if ! node_ready "${node}"; then
    compose logs "${node}" >&2 || true
    scontrol show node "${node}" >&2 || true
    die "${node} did not register in a usable state"
  fi
done

log "clearing stale drain state on demo nodes"
for node in "${NODE_SERVICES[@]}"; do
  state="$(sinfo -h -N -n "${node}" -o '%T' 2>/dev/null | head -n 1 || true)"

  case "${state}" in
    drained*|draining*)
      scontrol update NodeName="${node}" State=UNDRAIN
      ;;
  esac
done

log "marking cpu08 as planned maintenance"
scontrol update NodeName=cpu08 State=DRAIN Reason="Demo maintenance"

log "demo topology is ready"
"${SCRIPT_DIR}/check.sh"
"${SCRIPT_DIR}/check-topology.sh"
