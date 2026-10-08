#!/usr/bin/env bash
set -euo pipefail

EXPECTED_NODES=(
  cpu01 cpu02 cpu03 cpu04 cpu05 cpu06 cpu07 cpu08
  highmem01 highmem02 highmem03
  gpu01 gpu02 gpu03 gpu04 gpu05
)

log() {
  printf '[demo topology check] %s\n' "$*"
}

die() {
  printf '[demo topology check] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root"

for command in scontrol sinfo sbatch sacct sacctmgr squeue runuser seff; do
  command -v "${command}" >/dev/null 2>&1 || die "${command} is required"
done

submit_as() {
  local user=$1
  shift

  runuser -u "${user}" -- sbatch --parsable --output=/dev/null "$@" \
    | cut -d';' -f1
}

wait_terminal() {
  local job_id=$1
  local expected=$2
  local state=""

  for _ in $(seq 1 90); do
    state="$(
      sacct -nP -j "${job_id}" --starttime now-10minutes --format=JobIDRaw,State \
        | awk -F'|' -v id="${job_id}" '$1 == id { print $2; exit }'
    )"

    case "${state}" in
      COMPLETED*|FAILED*|CANCELLED*|TIMEOUT*|OUT_OF_MEMORY*|NODE_FAIL*)
        break
        ;;
    esac

    sleep 1
  done

  [[ "${state}" == "${expected}"* ]] || \
    die "job ${job_id} expected ${expected}, got ${state:-unknown}"
}

wait_running() {
  local job_id=$1
  local state=""

  for _ in $(seq 1 30); do
    state="$(squeue -h -j "${job_id}" -o '%T' | head -n 1 || true)"
    [[ "${state}" == "RUNNING" ]] && return 0
    sleep 1
  done

  die "job ${job_id} did not reach RUNNING state (state: ${state:-unknown})"
}

log "checking 16-node topology"
mapfile -t ACTUAL_NODES < <(sinfo -h -N -o '%N' | sort -u)

[[ ${#ACTUAL_NODES[@]} -eq ${#EXPECTED_NODES[@]} ]] || {
  printf 'registered nodes:\n%s\n' "${ACTUAL_NODES[*]}" >&2
  die "expected ${#EXPECTED_NODES[@]} registered nodes, found ${#ACTUAL_NODES[@]}"
}

for node in "${EXPECTED_NODES[@]}"; do
  printf '%s\n' "${ACTUAL_NODES[@]}" | grep -qx "${node}" || \
    die "missing node ${node}"
done

for partition in compute highmem gpu; do
  scontrol show partition "${partition}" >/dev/null 2>&1 || \
    die "missing ${partition} partition"
done

CPU08_STATE="$(sinfo -h -N -n cpu08 -o '%T' | head -n 1)"
[[ "${CPU08_STATE}" == drained* || "${CPU08_STATE}" == draining* ]] || \
  die "cpu08 should be drained for demo maintenance (state: ${CPU08_STATE})"

for node in cpu01 cpu02 cpu03 cpu04 cpu05 cpu06 cpu07 highmem01 highmem02 highmem03 gpu01 gpu02 gpu03 gpu04 gpu05; do
  state="$(sinfo -h -N -n "${node}" -o '%T' | head -n 1)"

  case "${state}" in
    down*|unknown*)
      die "${node} is not usable (state: ${state})"
      ;;
  esac
done

for pair in \
  'gpu01|v100' \
  'gpu02|a100' \
  'gpu03|h100' \
  'gpu04|l40s' \
  'gpu05|mi250'; do
  node="${pair%%|*}"
  gpu_type="${pair##*|}"

  scontrol show node "${node}" -o \
    | grep -F "Gres=gpu:${gpu_type}:2" >/dev/null || \
    die "${node} does not advertise two fake ${gpu_type} GPUs"
done

read -r TOTAL_CPUS TOTAL_MEMORY_MIB < <(
  scontrol show nodes -o | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^CPUTot=/) {
          split($i, value, "=")
          total_cpus += value[2]
        }

        if ($i ~ /^RealMemory=/) {
          split($i, value, "=")
          total_memory += value[2]
        }
      }
    }

    END {
      print total_cpus, total_memory
    }
  '
)

[[ "${TOTAL_CPUS}" -eq 256 ]] || \
  die "expected 256 configured CPUs, found ${TOTAL_CPUS}"

[[ "${TOTAL_MEMORY_MIB}" -eq 1048576 ]] || \
  die "expected 1 TiB configured memory, found ${TOTAL_MEMORY_MIB} MiB"

log "checking accounts, users, and qos"
for qos in normal short limited shared memcap sweep; do
  sacctmgr -nP show qos "${qos}" format=Name | grep -qx "${qos}" || \
    die "missing ${qos} qos"
done

for pair in \
  'demo01|proteins' \
  'demo02|chemistry' \
  'demo03|climate' \
  'demo04|cfd101' \
  'demo05|ai' \
  'demo06|ml101'; do
  user="${pair%%|*}"
  account="${pair##*|}"

  sacctmgr -nP show user "${user}" withassoc format=User,Account,Cluster \
    | grep -qx "${user}|${account}|slurm-view-demo" || \
    die "missing ${user}/${account} association"
done

account_parent() {
  local account=$1

  sacctmgr -nP show assoc \
    cluster=slurm-view-demo \
    account="${account}" \
    format=Account,User,ParentName \
    | awk -F'|' -v account="${account}" \
        '$1 == account && $2 == "" { print $3; exit }'
}

[[ "$(account_parent research)" == "root" ]] || \
  die "research should be a child of root"

[[ "$(account_parent molecular)" == "research" ]] || \
  die "molecular should be a child of research"

[[ "$(account_parent proteins)" == "molecular" ]] || \
  die "proteins should be a child of molecular"

[[ "$(account_parent chemistry)" == "molecular" ]] || \
  die "chemistry should be a child of molecular"

[[ "$(account_parent climate)" == "research" ]] || \
  die "climate should be a child of research"

[[ "$(account_parent ai)" == "research" ]] || \
  die "ai should be a child of research"

[[ "$(account_parent teaching)" == "root" ]] || \
  die "teaching should be a child of root"

[[ "$(account_parent cfd101)" == "teaching" ]] || \
  die "cfd101 should be a child of teaching"

[[ "$(account_parent ml101)" == "teaching" ]] || \
  die "ml101 should be a child of teaching"

for user in demo01 demo02 demo03 demo04 demo05 demo06; do
  id "${user}" >/dev/null 2>&1 || die "missing local demo user ${user}"
done

assoc_group_tres() {
  local account=$1
  local user=${2:-}

  sacctmgr -nP show assoc \
    cluster=slurm-view-demo \
    account="${account}" \
    format=Account,User,GrpTRES \
    | awk -F'|' \
        -v account="${account}" \
        -v user="${user}" \
        '$1 == account && $2 == user { print $3; exit }'
}

assoc_max_jobs() {
  local account=$1

  sacctmgr -nP show assoc \
    cluster=slurm-view-demo \
    account="${account}" \
    format=Account,User,MaxJobs \
    | awk -F'|' -v account="${account}" \
        '$1 == account && $2 == "" { print $3; exit }'
}

qos_field() {
  local qos=$1
  local field=$2

  sacctmgr -nP show qos "${qos}" \
    format=Name,"${field}" \
    | awk -F'|' -v qos="${qos}" \
        '$1 == qos { print $2; exit }'
}

[[ "$(assoc_group_tres research)" == *"cpu=160"* ]] || \
  die "research should have GrpTRES cpu=160"

[[ "$(assoc_group_tres molecular)" == *"cpu=64"* ]] || \
  die "molecular should have GrpTRES cpu=64"

[[ "$(assoc_group_tres proteins demo01)" == *"cpu=48"* ]] || \
  die "demo01/proteins should have GrpTRES cpu=48"

[[ "$(assoc_group_tres ai)" == *"gres/gpu:h100=1"* ]] || \
  die "ai should have GrpTRES gres/gpu:h100=1"

[[ "$(assoc_max_jobs ml101)" == "1" ]] || \
  die "ml101 should have MaxJobs=1"

[[ "$(qos_field shared GrpTRES)" == *"cpu=32"* ]] || \
  die "shared qos should have GrpTRES cpu=32"

[[ "$(qos_field memcap MaxTRESPU)" == *"mem=12G"* ]] || \
  die "memcap qos should have MaxTRESPU mem=12G"

[[ "$(qos_field limited MaxJobsPU)" == "1" ]] || \
  die "limited qos should have MaxJobsPU=1"

log "running compute smoke job"
CPU_JOB="$(
  submit_as demo01 \
    --account=proteins \
    --qos=normal \
    --partition=compute \
    --job-name=topology-cpu \
    --cpus-per-task=1 \
    --mem=128M \
    --wrap='sleep 2'
)"
wait_terminal "${CPU_JOB}" COMPLETED
seff "${CPU_JOB}" >/dev/null

log "running high-memory partition smoke job"
HIGHMEM_JOB="$(
  submit_as demo03 \
    --account=climate \
    --qos=normal \
    --partition=highmem \
    --job-name=topology-highmem \
    --cpus-per-task=1 \
    --mem=2G \
    --wrap='sleep 2'
)"
wait_terminal "${HIGHMEM_JOB}" COMPLETED

for gpu_type in v100 a100 h100 l40s mi250; do
  log "running fake ${gpu_type} GPU smoke job"

  GPU_JOB="$(
    submit_as demo02 \
      --account=chemistry \
      --qos=short \
      --partition=gpu \
      --job-name="topology-gpu-${gpu_type}" \
      --cpus-per-task=1 \
      --mem=512M \
      --gres="gpu:${gpu_type}:1" \
      --time=00:01:00 \
      --wrap='sleep 2'
  )"

  wait_terminal "${GPU_JOB}" COMPLETED
done

log "running array smoke job"
ARRAY_JOB="$(
  submit_as demo01 \
    --account=proteins \
    --qos=short \
    --partition=compute \
    --job-name=topology-array \
    --array=0-3%2 \
    --cpus-per-task=1 \
    --mem=128M \
    --time=00:01:00 \
    --wrap='sleep 1'
)"

for _ in $(seq 1 60); do
  if [[ -z "$(squeue -h -j "${ARRAY_JOB}" -o '%i' || true)" ]]; then
    break
  fi
  sleep 1
done

[[ -z "$(squeue -h -j "${ARRAY_JOB}" -o '%i' || true)" ]] || \
  die "array ${ARRAY_JOB} did not finish"

ARRAY_BAD="$(
  sacct -nP -j "${ARRAY_JOB}" --starttime now-10minutes --format=JobIDRaw,State \
    | awk -F'|' '$1 ~ /_/ && $2 !~ /^COMPLETED/ { print $0 }'
)"
[[ -z "${ARRAY_BAD}" ]] || die "array ${ARRAY_JOB} has non-completed tasks: ${ARRAY_BAD}"

pending_reason() {
  local job_id=$1

  scontrol show job -o "${job_id}" 2>/dev/null \
    | awk '{
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^Reason=/) {
            sub(/^Reason=/, "", $i)
            print $i
            exit
          }
        }
      }'
}

log "checking dependency pending reason"
PARENT_JOB="$(
  submit_as demo03 \
    --hold \
    --account=climate \
    --qos=normal \
    --partition=compute \
    --job-name=dependency-parent \
    --wrap='sleep 2'
)"
CHILD_JOB="$(
  submit_as demo03 \
    --account=climate \
    --qos=normal \
    --partition=compute \
    --job-name=dependency-child \
    --dependency="afterok:${PARENT_JOB}" \
    --wrap='sleep 1'
)"

DEPENDENCY_SEEN=0
for _ in $(seq 1 20); do
  reason="$(pending_reason "${CHILD_JOB}")"

  if [[ "${reason}" == "Dependency" ]]; then
    DEPENDENCY_SEEN=1
    break
  fi

  sleep 0.5
done

[[ ${DEPENDENCY_SEEN} -eq 1 ]] || {
  squeue -j "${PARENT_JOB},${CHILD_JOB}" -o '%.12i %.20j %.10T %.30R' >&2 || true
  die "dependency job never reported Dependency"
}

scontrol release "${PARENT_JOB}"

wait_terminal "${PARENT_JOB}" COMPLETED
wait_terminal "${CHILD_JOB}" COMPLETED

log "checking qos job-count enforcement"
LIMITED_ONE="$(
  submit_as demo04 \
    --account=cfd101 \
    --qos=limited \
    --partition=compute \
    --job-name=limited-running \
    --wrap='sleep 8'
)"
wait_running "${LIMITED_ONE}"

LIMITED_TWO="$(
  submit_as demo04 \
    --account=cfd101 \
    --qos=limited \
    --partition=compute \
    --job-name=limited-waiting \
    --wrap='sleep 1'
)"

QOS_REASON_SEEN=0
for _ in $(seq 1 30); do
  reason="$(pending_reason "${LIMITED_TWO}")"
  if [[ "${reason}" == "QOSMaxJobsPerUserLimit" ]]; then
    QOS_REASON_SEEN=1
    break
  fi
  sleep 0.5
done
[[ ${QOS_REASON_SEEN} -eq 1 ]] || \
  die "limited qos job never reported QOSMaxJobsPerUserLimit"

wait_terminal "${LIMITED_ONE}" COMPLETED
wait_terminal "${LIMITED_TWO}" COMPLETED

log "checking intentional failure accounting"
FAIL_JOB="$(
  submit_as demo03 \
    --account=climate \
    --qos=short \
    --partition=compute \
    --job-name=expected-failure \
    --time=00:01:00 \
    --wrap='exit 7'
)"
wait_terminal "${FAIL_JOB}" FAILED

log "topology and policy checks passed"
