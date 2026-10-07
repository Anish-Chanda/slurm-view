#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[demo accounting] %s\n' "$*"
}

die() {
  printf '[demo accounting] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root"
command -v sacctmgr >/dev/null 2>&1 || die "sacctmgr is required"

if ! sacctmgr -nP show cluster slurm-view-demo format=Cluster 2>/dev/null | grep -qx 'slurm-view-demo'; then
  log "creating cluster"
  sacctmgr -i add cluster slurm-view-demo
fi

if ! sacctmgr -nP show account research format=Account 2>/dev/null | grep -qx 'research'; then
  log "creating research account"
  sacctmgr -i add account research cluster=slurm-view-demo description="Demo research workloads"
fi

if ! sacctmgr -nP show user demo01 withassoc format=User,Account,Cluster 2>/dev/null \
  | grep -qx 'demo01|research|slurm-view-demo'; then
  log "creating demo01 association"
  sacctmgr -i add user demo01 account=research cluster=slurm-view-demo
fi

sacctmgr -i modify user where name=demo01 set DefaultAccount=research >/dev/null

log "accounting initialized"
