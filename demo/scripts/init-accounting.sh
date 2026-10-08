#!/usr/bin/env bash
set -euo pipefail

CLUSTER=slurm-view-demo

log() {
  printf '[demo accounting] %s\n' "$*"
}

die() {
  printf '[demo accounting] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root"
command -v sacctmgr >/dev/null 2>&1 || die "sacctmgr is required"

if ! sacctmgr -nP show cluster "${CLUSTER}" format=Cluster 2>/dev/null | grep -qx "${CLUSTER}"; then
  log "creating cluster"
  sacctmgr -i add cluster "${CLUSTER}"
fi

ensure_qos() {
  local name=$1

  if ! sacctmgr -nP show qos "${name}" format=Name 2>/dev/null | grep -qx "${name}"; then
    log "creating ${name} qos"
    sacctmgr -i add qos "${name}"
  fi
}

ensure_qos normal
ensure_qos short
ensure_qos limited

log "configuring qos policies"
sacctmgr -i modify qos normal set Priority=100 MaxWall=00:30:00 >/dev/null
sacctmgr -i modify qos short set Priority=200 MaxWall=00:05:00 >/dev/null
sacctmgr -i modify qos limited set Priority=50 MaxWall=00:30:00 MaxJobsPU=1 >/dev/null

ensure_account() {
  local name=$1
  local description=$2

  if ! sacctmgr -nP show assoc \
    cluster="${CLUSTER}" \
    account="${name}" \
    format=Cluster,Account 2>/dev/null \
    | grep -qx "${CLUSTER}|${name}"; then
    log "creating ${name} account"
    sacctmgr -i add account "${name}" cluster="${CLUSTER}" description="${description}"
  fi
}

ensure_account research "Demo research workloads"
ensure_account teaching "Demo teaching workloads"

sacctmgr -i modify account name=research cluster="${CLUSTER}" \
  set FairShare=70 QOS=normal,short,limited DefaultQOS=normal >/dev/null
sacctmgr -i modify account name=teaching cluster="${CLUSTER}" \
  set FairShare=30 QOS=normal,short,limited DefaultQOS=normal >/dev/null

ensure_user() {
  local user=$1
  local account=$2
  local default_qos=$3

  if ! sacctmgr -nP show assoc \
    cluster="${CLUSTER}" \
    account="${account}" \
    user="${user}" \
    format=Cluster,Account,User 2>/dev/null \
    | grep -qx "${CLUSTER}|${account}|${user}"; then
    log "creating ${user} association"
    sacctmgr -i add user "${user}" account="${account}" cluster="${CLUSTER}"
  fi

  sacctmgr -i modify user where name="${user}" set DefaultAccount="${account}" >/dev/null
  sacctmgr -i modify user name="${user}" account="${account}" cluster="${CLUSTER}" \
    set DefaultQOS="${default_qos}" >/dev/null
}

ensure_user demo01 research normal
ensure_user demo02 research normal
ensure_user demo03 teaching normal
ensure_user demo04 teaching limited

log "accounting initialized"
