#!/usr/bin/env bash
set -euo pipefail

CLUSTER=slurm-view-demo
ALL_QOS=normal,short,limited,shared,memcap,sweep

log() {
  printf '[demo accounting] %s\n' "$*"
}

die() {
  printf '[demo accounting] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root"
command -v sacctmgr >/dev/null 2>&1 || die "sacctmgr is required"

if ! sacctmgr -nP show cluster "${CLUSTER}" format=Cluster 2>/dev/null \
  | grep -qx "${CLUSTER}"; then
  log "creating cluster"
  sacctmgr -i add cluster "${CLUSTER}"
fi

ensure_qos() {
  local name=$1

  if ! sacctmgr -nP show qos "${name}" format=Name 2>/dev/null \
    | grep -qx "${name}"; then
    log "creating ${name} qos"
    sacctmgr -i add qos "${name}"
  fi
}

for qos in normal short limited shared memcap sweep; do
  ensure_qos "${qos}"
done

log "configuring qos policies"

sacctmgr -i modify qos normal set \
  Priority=100 \
  MaxWall=08:00:00 \
  >/dev/null

sacctmgr -i modify qos short set \
  Priority=200 \
  MaxWall=00:05:00 \
  >/dev/null

sacctmgr -i modify qos limited set \
  Priority=50 \
  MaxWall=02:00:00 \
  MaxJobsPU=1 \
  >/dev/null

sacctmgr -i modify qos shared set \
  Priority=80 \
  MaxWall=08:00:00 \
  GrpTRES=cpu=32 \
  >/dev/null

sacctmgr -i modify qos memcap set \
  Priority=70 \
  MaxWall=08:00:00 \
  MaxTRESPU=mem=12G \
  >/dev/null

sacctmgr -i modify qos sweep set \
  Priority=5 \
  MaxWall=00:30:00 \
  >/dev/null

ensure_account() {
  local name=$1
  local parent=$2
  local description=$3

  if ! sacctmgr -nP show assoc \
      cluster="${CLUSTER}" \
      account="${name}" \
      format=Cluster,Account,User 2>/dev/null \
    | grep -qx "${CLUSTER}|${name}|"; then
    log "creating ${name} account under ${parent}"
    sacctmgr -i add account "${name}" \
      cluster="${CLUSTER}" \
      parent="${parent}" \
      description="${description}"
  fi
}

ensure_account research root "Research workloads"
ensure_account molecular research "Molecular simulation workloads"
ensure_account proteins molecular "Protein simulation workloads"
ensure_account chemistry molecular "Computational chemistry workloads"
ensure_account climate research "Climate modeling workloads"
ensure_account ai research "AI and accelerator workloads"

ensure_account teaching root "Teaching workloads"
ensure_account cfd101 teaching "CFD course workloads"
ensure_account ml101 teaching "Machine learning course workloads"

log "configuring account hierarchy and limits"

sacctmgr -i modify account \
  where name=research cluster="${CLUSTER}" \
  set Parent=root FairShare=70 QOS="${ALL_QOS}" DefaultQOS=normal \
      GrpTRES=cpu=160 \
  >/dev/null

sacctmgr -i modify account \
  where name=molecular cluster="${CLUSTER}" \
  set Parent=research FairShare=45 QOS="${ALL_QOS}" DefaultQOS=normal \
      GrpTRES=cpu=64 \
  >/dev/null

sacctmgr -i modify account \
  where name=proteins cluster="${CLUSTER}" \
  set Parent=molecular FairShare=60 QOS="${ALL_QOS}" DefaultQOS=normal \
  >/dev/null

sacctmgr -i modify account \
  where name=chemistry cluster="${CLUSTER}" \
  set Parent=molecular FairShare=40 QOS="${ALL_QOS}" DefaultQOS=normal \
  >/dev/null

sacctmgr -i modify account \
  where name=climate cluster="${CLUSTER}" \
  set Parent=research FairShare=35 QOS="${ALL_QOS}" DefaultQOS=normal \
  >/dev/null

sacctmgr -i modify account \
  where name=ai cluster="${CLUSTER}" \
  set Parent=research FairShare=20 QOS="${ALL_QOS}" DefaultQOS=normal \
      GrpTRES=gres/gpu:h100=1 \
  >/dev/null

sacctmgr -i modify account \
  where name=teaching cluster="${CLUSTER}" \
  set Parent=root FairShare=30 QOS="${ALL_QOS}" DefaultQOS=normal \
  >/dev/null

sacctmgr -i modify account \
  where name=cfd101 cluster="${CLUSTER}" \
  set Parent=teaching FairShare=60 QOS="${ALL_QOS}" DefaultQOS=normal \
  >/dev/null

sacctmgr -i modify account \
  where name=ml101 cluster="${CLUSTER}" \
  set Parent=teaching FairShare=40 QOS="${ALL_QOS}" DefaultQOS=normal \
      MaxJobs=1 \
  >/dev/null

ensure_user() {
  local user=$1
  local account=$2

  if ! sacctmgr -nP show assoc \
      cluster="${CLUSTER}" \
      account="${account}" \
      user="${user}" \
      format=Cluster,Account,User 2>/dev/null \
    | grep -qx "${CLUSTER}|${account}|${user}"; then
    log "creating ${user}/${account} association"
    sacctmgr -i add user "${user}" \
      account="${account}" \
      cluster="${CLUSTER}"
  fi

  sacctmgr -i modify user \
    where name="${user}" \
    set DefaultAccount="${account}" \
    >/dev/null

  sacctmgr -i modify user \
    where name="${user}" account="${account}" cluster="${CLUSTER}" \
    set DefaultQOS=normal QOS="${ALL_QOS}" \
    >/dev/null
}

ensure_user demo01 proteins
ensure_user demo02 chemistry
ensure_user demo03 climate
ensure_user demo04 cfd101
ensure_user demo05 ai
ensure_user demo06 ml101

# The demo originally placed demo01-demo04 directly under the two top-level
# accounts. Remove those legacy associations after their replacement leaf
# associations exist. This keeps upgrades of an existing demo VM aligned with
# a fresh install without resetting accounting history.
remove_legacy_association() {
  local user=$1
  local account=$2

  if sacctmgr -nP show assoc \
      cluster="${CLUSTER}" \
      account="${account}" \
      user="${user}" \
      format=Cluster,Account,User 2>/dev/null \
    | grep -qx "${CLUSTER}|${account}|${user}"; then
    log "removing legacy ${user}/${account} association"
    sacctmgr -i remove user "${user}" \
      where account="${account}" cluster="${CLUSTER}" \
      >/dev/null
  fi
}

remove_legacy_association demo01 research
remove_legacy_association demo02 research
remove_legacy_association demo03 teaching
remove_legacy_association demo04 teaching

# demo01 deliberately has its own CPU ceiling below its ancestors. The
# workload can therefore demonstrate a request that fits this user level but
# is blocked by the intermediate molecular account.
sacctmgr -i modify user \
  where name=demo01 account=proteins cluster="${CLUSTER}" \
  set GrpTRES=cpu=48 \
  >/dev/null

log "accounting initialized"
