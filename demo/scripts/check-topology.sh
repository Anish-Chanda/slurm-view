#!/usr/bin/env bash
set -euo pipefail

EXPECTED_NODES=(
  cpu01 cpu02 cpu03 cpu04 cpu05 cpu06 cpu07 cpu08
  highmem01 highmem02
  gpu01 gpu02
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

log "checking 12-node topology"
mapfile -t ACTUAL_NODES < <(sinfo -h -N -o '%N' | sort -u)

[[ ${#ACTUAL_NODES[@]} -eq 12 ]] || {
  printf 'registered nodes:\n%s\n' "${ACTUAL_NODES[*]}" >&2
  die "expected 12 registered nodes, found ${#ACTUAL_NODES[@]}"
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

for node in cpu01 cpu02 cpu03 cpu04 cpu05 cpu06 cpu07 highmem01 highmem02 gpu01 gpu02; do
  state="$(sinfo -h -N -n "${node}" -o '%T' | head -n 1)"

  case "${state}" in
    down*|unknown*)
      die "${node} is not usable (state: ${state})"
      ;;
  esac
done

scontrol show node gpu01 -o | grep -q 'Gres=gpu:a100:2' || \
  die "gpu01 does not advertise two fake A100 GPUs"
scontrol show node gpu02 -o | grep -q 'Gres=gpu:a100:2' || \
  die "gpu02 does not advertise two fake A100 GPUs"

log "checking accounts, users, and qos"
for qos in normal short limited; do
  sacctmgr -nP show qos "${qos}" format=Name | grep -qx "${qos}" || \
    die "missing ${qos} qos"
done

for pair in \
  'demo01|research' \
  'demo02|research' \
  'demo03|teaching' \
  'demo04|teaching'; do
  user="${pair%%|*}"
  account="${pair##*|}"

  sacctmgr -nP show user "${user}" withassoc format=User,Account,Cluster \
    | grep -qx "${user}|${account}|slurm-view-demo" || \
    die "missing ${user}/${account} association"
done

log "running compute smoke job"
CPU_JOB="$(
  submit_as demo01 \
    --account=research \
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
    --account=teaching \
    --qos=normal \
    --partition=highmem \
    --job-name=topology-highmem \
    --cpus-per-task=1 \
    --mem=2G \
    --wrap='sleep 2'
)"
wait_terminal "${HIGHMEM_JOB}" COMPLETED

log "running fake GPU smoke job"
GPU_JOB="$(
  submit_as demo02 \
    --account=research \
    --qos=short \
    --partition=gpu \
    --job-name=topology-gpu \
    --cpus-per-task=1 \
    --mem=512M \
    --gres=gpu:a100:1 \
    --time=00:01:00 \
    --wrap='sleep 2'
)"
wait_terminal "${GPU_JOB}" COMPLETED

log "running array smoke job"
ARRAY_JOB="$(
  submit_as demo01 \
    --account=research \
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
    --account=teaching \
    --qos=normal \
    --partition=compute \
    --job-name=dependency-parent \
    --wrap='sleep 2'
)"
CHILD_JOB="$(
  submit_as demo03 \
    --account=teaching \
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
    --account=teaching \
    --qos=limited \
    --partition=compute \
    --job-name=limited-running \
    --wrap='sleep 8'
)"
wait_running "${LIMITED_ONE}"

LIMITED_TWO="$(
  submit_as demo04 \
    --account=teaching \
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
    --account=teaching \
    --qos=short \
    --partition=compute \
    --job-name=expected-failure \
    --time=00:01:00 \
    --wrap='exit 7'
)"
wait_terminal "${FAIL_JOB}" FAILED

log "topology and policy checks passed"
