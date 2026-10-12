#!/usr/bin/env bash
set -euo pipefail
shopt -s inherit_errexit

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
WORKLOAD_DIR="${DEMO_DIR}/workload"

source "${SCRIPT_DIR}/demo-identities.sh"
source "${WORKLOAD_DIR}/workload-spec.sh"

DEMO_STATE_ROOT="${SLURM_VIEW_DEMO_STATE_DIR:-/srv/slurm-view-demo}"
SHARED_HOME_DIR="${DEMO_STATE_ROOT}/shared-home"
STEADY_TEMPLATE="${WORKLOAD_DIR}/steady-job.sh"
ARRAY_TEMPLATE="${WORKLOAD_DIR}/array-task.sh"

log() {
  printf '[demo workload] %s\n' "$*" >&2
}

die() {
  printf '[demo workload] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || \
  die "run this script as root (for example: sudo ./demo/scripts/seed-workload.sh)"

for command in \
  awk \
  date \
  dirname \
  flock \
  grep \
  head \
  id \
  install \
  runuser \
  sacctmgr \
  sbatch \
  scancel \
  scontrol \
  seq \
  sinfo \
  sleep \
  sort \
  squeue; do
  command -v "${command}" >/dev/null 2>&1 || die "${command} is required"
done

WORKLOAD_LOCK_FILE=/run/lock/slurm-view-demo-workload.lock
exec 9>"${WORKLOAD_LOCK_FILE}"
if ! flock -n 9; then
  log "another workload reconciliation is already running; skipping"
  exit 0
fi

[[ -r "${STEADY_TEMPLATE}" ]] || die "missing ${STEADY_TEMPLATE}"
[[ -r "${ARRAY_TEMPLATE}" ]] || die "missing ${ARRAY_TEMPLATE}"

scontrol ping 2>/dev/null | grep -q 'UP' || die "slurmctld is not responding"

CPU08_STATE="$(sinfo -h -N -n cpu08 -o '%T' | head -n 1 || true)"
case "${CPU08_STATE}" in
  drained*|draining*)
    ;;
  *)
    die "cpu08 must be drained before seeding the demo workload (state: ${CPU08_STATE:-unknown})"
    ;;
esac

for index in "${!DEMO_USERS[@]}"; do
  user="${DEMO_USERS[$index]}"
  account="${DEMO_ACCOUNTS[$index]}"

  id "${user}" >/dev/null 2>&1 || die "missing local user ${user}"

  sacctmgr -nP \
    show user "${user}" withassoc \
    format=User,Account,Cluster \
    | awk -F'|' -v user="${user}" -v account="${account}" \
        '$1 == user && $2 == account && $3 == "slurm-view-demo" { found = 1 } END { exit found ? 0 : 1 }' || \
    die "missing ${user}/${account} Slurm association"
done

prepare_job_script() {
  local user=$1
  local job_name=$2
  local source=$3
  local account
  local uid
  local gid
  local job_dir
  local target

  account="$(demo_account_for "${user}")" || die "no demo account for ${user}"
  uid="$(id -u "${user}")"
  gid="$(id -g "${user}")"
  job_dir="${SHARED_HOME_DIR}/${user}/projects/${account}/${job_name}"
  target="${job_dir}/run.sbatch"

  install -d -o "${uid}" -g "${gid}" -m 0755 \
    "${job_dir}" \
    "${job_dir}/logs"

  install -o "${uid}" -g "${gid}" -m 0755 \
    "${source}" \
    "${target}"

  printf '%s\n' "${target}"
}

active_slot_ids() {
  local slot=$1
  local comment

  comment="$(workload_comment_for "${slot}")"

  # %F is the array master id for arrays and the ordinary job id otherwise.
  # Do not use --array here: pending array elements are intentionally
  # compressed so discovery stays cheap even for the 256-task sweep.
  squeue -a -h -o '%F|%k' \
    | awk -F'|' -v comment="${comment}" '$2 == comment { print $1 }' \
    | sort -u
}

find_slot_id() {
  local slot=$1
  local -a ids=()

  mapfile -t ids < <(active_slot_ids "${slot}")

  if (( ${#ids[@]} > 1 )); then
    die "multiple active jobs own workload slot ${slot}: ${ids[*]}"
  fi

  if (( ${#ids[@]} == 1 )); then
    printf '%s\n' "${ids[0]}"
  fi
}

job_state() {
  local job_id=$1
  squeue -a -h -j "${job_id}" -o '%T' | head -n 1
}

job_reason() {
  local job_id=$1

  scontrol -o show job "${job_id}" 2>/dev/null \
    | awk '{
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^Reason=/) {
            sub(/^Reason=/, "", $i)
            sub(/,.*/, "", $i)
            print $i
            exit
          }
        }
      }'
}

wait_until_gone() {
  local job_id=$1

  for _ in $(seq 1 40); do
    if [[ -z "$(job_state "${job_id}" || true)" ]]; then
      return 0
    fi
    sleep 0.25
  done

  return 1
}

cancel_slot() {
  local slot=$1
  local job_id

  if ! job_id="$(find_slot_id "${slot}")"; then
    return 1
  fi
  [[ -n "${job_id}" ]] || return 0

  log "replacing ${slot} job ${job_id}"
  scancel "${job_id}"
  wait_until_gone "${job_id}" || \
    die "job ${job_id} did not leave the queue after cancellation"
}

submit_job() {
  local user=$1
  local slot=$2
  local job_name=$3
  local script=$4
  shift 4

  local account
  local workdir
  local comment
  local response

  account="$(demo_account_for "${user}")" || die "no demo account for ${user}"
  workdir="$(dirname -- "${script}")"
  comment="$(workload_comment_for "${slot}")"

  response="$({
    runuser -u "${user}" -- sbatch \
      --parsable \
      --account="${account}" \
      --job-name="${job_name}" \
      --comment="${comment}" \
      --chdir="${workdir}" \
      --output="${workdir}/logs/%x-%j.out" \
      --error="${workdir}/logs/%x-%j.err" \
      "$@" \
      "${script}"
  } | cut -d';' -f1)"

  [[ "${response}" =~ ^[0-9]+$ ]] || \
    die "unexpected sbatch response for ${slot}: ${response}"

  printf '%s\n' "${response}"
}

submit_array() {
  local user=$1
  local slot=$2
  local job_name=$3
  local script=$4
  shift 4

  local account
  local workdir
  local comment
  local response

  account="$(demo_account_for "${user}")" || die "no demo account for ${user}"
  workdir="$(dirname -- "${script}")"
  comment="$(workload_comment_for "${slot}")"

  response="$({
    runuser -u "${user}" -- sbatch \
      --parsable \
      --account="${account}" \
      --job-name="${job_name}" \
      --comment="${comment}" \
      --chdir="${workdir}" \
      --output="${workdir}/logs/%x-%A_%a.out" \
      --error="${workdir}/logs/%x-%A_%a.err" \
      "$@" \
      "${script}"
  } | cut -d';' -f1)"

  [[ "${response}" =~ ^[0-9]+$ ]] || \
    die "unexpected array sbatch response for ${slot}: ${response}"

  printf '%s\n' "${response}"
}

show_job_diagnostics() {
  local job_id=$1

  squeue -a -j "${job_id}" \
    -o '%.18i %.24j %.10u %.12a %.10q %.10T %.32R' >&2 || true
  scontrol -o show job "${job_id}" >&2 || true
}

wait_running() {
  local job_id=$1
  local state=""

  for _ in $(seq 1 80); do
    state="$(job_state "${job_id}" || true)"
    [[ "${state}" == "RUNNING" ]] && return 0
    [[ -n "${state}" ]] || break

    case "${state}" in
      FAILED|CANCELLED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL)
        break
        ;;
    esac

    sleep 0.25
  done

  show_job_diagnostics "${job_id}"
  return 1
}

wait_reason() {
  local job_id=$1
  local expected=$2
  local state=""
  local reason=""

  for _ in $(seq 1 80); do
    state="$(job_state "${job_id}" || true)"
    reason="$(job_reason "${job_id}" || true)"

    if [[ "${state}" == "PENDING" && "${reason}" == "${expected}" ]]; then
      return 0
    fi

    [[ -n "${state}" ]] || break
    [[ "${state}" == "PENDING" ]] || break
    sleep 0.25
  done

  show_job_diagnostics "${job_id}"
  return 1
}

ANCHOR_RECOVERY_ACTIVE=0

workload_needs_anchor_recovery() {
  local slot
  local job_id
  local state
  local -a ids=()

  # Running anchors establish the resource and policy usage that keeps the
  # curated pending jobs in their intended states. After a controller/slurmd
  # restart Slurm can requeue those anchors and opportunistically start jobs
  # that were supposed to remain pending. Treat that as generation drift.
  for slot in "${DEMO_RUNNING_SLOTS[@]}"; do
    mapfile -t ids < <(active_slot_ids "${slot}")

    (( ${#ids[@]} <= 1 )) || \
      die "multiple active jobs own workload slot ${slot}: ${ids[*]}"

    if (( ${#ids[@]} == 0 )); then
      log "running anchor ${slot} is missing"
      return 0
    fi

    job_id="${ids[0]}"
    state="$(job_state "${job_id}" || true)"

    if [[ "${state}" != "RUNNING" ]]; then
      log "running anchor ${slot} is ${state:-missing}; recovery required"
      return 0
    fi
  done

  # A showcase job that is expected to stay pending must never be allowed to
  # take over resources from the running anchor layer.
  for slot in "${DEMO_PENDING_SLOTS[@]}"; do
    mapfile -t ids < <(active_slot_ids "${slot}")

    (( ${#ids[@]} <= 1 )) || \
      die "multiple active jobs own workload slot ${slot}: ${ids[*]}"

    (( ${#ids[@]} == 1 )) || continue

    job_id="${ids[0]}"
    state="$(job_state "${job_id}" || true)"

    case "${state}" in
      RUNNING|COMPLETING|CONFIGURING)
        log "pending scenario ${slot} is ${state}; recovery required"
        return 0
        ;;
    esac
  done

  return 1
}

clear_pending_scenarios_for_anchor_recovery() {
  local slot

  log "clearing pending-analysis jobs before restoring running anchors"

  for slot in "${DEMO_PENDING_SLOTS[@]}"; do
    cancel_slot "${slot}"
  done

  # Ask slurmctld to reconsider the now-freed resources immediately rather
  # than waiting for the next periodic scheduling cycle.
  scontrol schedule >/dev/null 2>&1 || true
}

wait_anchor_running() {
  local slot=$1
  local job_id=$2
  local state
  local reason
  local array_id=""

  if wait_running "${job_id}"; then
    return 0
  fi

  # Normally the large array is preserved across anchor repairs so its public
  # progress map can live longer than the six-hour anchor jobs. If an anchor
  # is still resource-blocked after all showcase-pending jobs were removed,
  # the current array generation is the only owned workload allowed to be a
  # remaining blocker. Rotate it once and retry.
  if (( ANCHOR_RECOVERY_ACTIVE == 1 )); then
    state="$(job_state "${job_id}" || true)"
    reason="$(job_reason "${job_id}" || true)"

    if [[ "${state}" == "PENDING" && "${reason}" == "Resources" ]]; then
      array_id="$(find_slot_id "${DEMO_ARRAY_SLOT}")"

      if [[ -n "${array_id}" ]]; then
        log "anchor ${slot} is still resource-blocked; rotating parameter sweep ${array_id}"
        cancel_slot "${DEMO_ARRAY_SLOT}"
        scontrol schedule >/dev/null 2>&1 || true

        if wait_running "${job_id}"; then
          return 0
        fi
      fi
    fi
  fi

  return 1
}

ensure_running() {
  local slot=$1
  local user=$2
  local job_name=$3
  local script=$4
  shift 4

  local job_id
  local state

  if ! job_id="$(find_slot_id "${slot}")"; then
    return 1
  fi

  if [[ -n "${job_id}" ]]; then
    state="$(job_state "${job_id}" || true)"
    if [[ "${state}" == "RUNNING" ]]; then
      printf '%s\n' "${job_id}"
      return 0
    fi

    if wait_anchor_running "${slot}" "${job_id}"; then
      printf '%s\n' "${job_id}"
      return 0
    fi

    cancel_slot "${slot}"
  fi

  log "submitting running anchor ${slot}"
  job_id="$(submit_job "${user}" "${slot}" "${job_name}" "${script}" "$@")"
  wait_anchor_running "${slot}" "${job_id}" || \
    die "${slot} did not reach RUNNING"
  printf '%s\n' "${job_id}"
}

ensure_pending() {
  local slot=$1
  local expected_reason=$2
  local user=$3
  local job_name=$4
  local script=$5
  shift 5

  local job_id

  if ! job_id="$(find_slot_id "${slot}")"; then
    return 1
  fi

  if [[ -n "${job_id}" ]] && wait_reason "${job_id}" "${expected_reason}"; then
    printf '%s\n' "${job_id}"
    return 0
  fi

  [[ -z "${job_id}" ]] || cancel_slot "${slot}"

  log "submitting pending scenario ${slot} (${expected_reason})"
  job_id="$(submit_job "${user}" "${slot}" "${job_name}" "${script}" "$@")"
  wait_reason "${job_id}" "${expected_reason}" || \
    die "${slot} did not report ${expected_reason}"
  printf '%s\n' "${job_id}"
}

ensure_array() {
  local script=$1
  local job_id
  local running_count

  if ! job_id="$(find_slot_id "${DEMO_ARRAY_SLOT}")"; then
    return 1
  fi

  if [[ -z "${job_id}" ]]; then
    log "submitting ${DEMO_ARRAY_SIZE}-task parameter sweep"
    job_id="$(
      submit_array \
        "${DEMO_ARRAY_USER}" \
        "${DEMO_ARRAY_SLOT}" \
        "${DEMO_ARRAY_NAME}" \
        "${script}" \
        --qos=sweep \
        --partition=compute \
        --nodelist=cpu07 \
        --array="0-$((DEMO_ARRAY_SIZE - 1))%${DEMO_ARRAY_THROTTLE}" \
        --nodes=1 \
        --ntasks=1 \
        --cpus-per-task=1 \
        --mem=512M \
        --time=00:20:00
    )"
  fi

  for _ in $(seq 1 80); do
    running_count="$(
      squeue --array -a -h -j "${job_id}" -o '%T' \
        | awk '$1 == "RUNNING" { count++ } END { print count + 0 }'
    )"

    if (( running_count == DEMO_ARRAY_THROTTLE )); then
      printf '%s\n' "${job_id}"
      return 0
    fi

    local current_array_id
    if ! current_array_id="$(find_slot_id "${DEMO_ARRAY_SLOT}")"; then
      return 1
    fi

    if [[ -z "${current_array_id}" ]]; then
      log "parameter sweep generation ${job_id} completed during reconciliation"
      ensure_array "${script}"
      return 0
    fi

    sleep 0.25
  done

  show_job_diagnostics "${job_id}"
  die "parameter sweep did not reach ${DEMO_ARRAY_THROTTLE} running tasks"
}

ensure_reservation() {
  local row=""
  local start_text=""
  local start_epoch=0
  local now_epoch
  local rotate=0

  row="$(scontrol -o show reservation "${DEMO_RESERVATION_NAME}" 2>/dev/null || true)"
  now_epoch="$(date +%s)"

  if [[ "${row}" != *"ReservationName=${DEMO_RESERVATION_NAME}"* ]]; then
    row=""
  fi

  if [[ -n "${row}" ]]; then
    start_text="$(
      awk '{
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^StartTime=/) {
            sub(/^StartTime=/, "", $i)
            print $i
            exit
          }
        }
      }' <<< "${row}"
    )"

    start_epoch="$(date --date="${start_text}" +%s 2>/dev/null || printf '0')"

    [[ "${row}" == *"Nodes=${DEMO_RESERVATION_NODE}"* ]] || rotate=1
    [[ "${row}" == *"Users=${DEMO_RESERVATION_USER}"* ]] || rotate=1
    [[ "${row}" == *"Duration=00:${DEMO_RESERVATION_DURATION_MINUTES}:00"* ]] || rotate=1

    # Keep the reservation comfortably beyond all six-hour running anchors.
    # Rotate it before the reserved window gets close enough to influence
    # ordinary backfill decisions.
    if (( start_epoch <= now_epoch + DEMO_RESERVATION_ROTATE_HOURS * 3600 )); then
      rotate=1
    fi
  fi

  if (( rotate == 1 )); then
    cancel_slot reserved-calibration
    log "rotating ${DEMO_RESERVATION_NAME} reservation"
    scontrol delete ReservationName="${DEMO_RESERVATION_NAME}"
    row=""
  fi

  if [[ -z "${row}" ]]; then
    log "creating ${DEMO_RESERVATION_NAME} ${DEMO_RESERVATION_LEAD_HOURS} hours from now"

    scontrol create reservation \
      ReservationName="${DEMO_RESERVATION_NAME}" \
      StartTime="now+${DEMO_RESERVATION_LEAD_HOURS}hours" \
      Duration="${DEMO_RESERVATION_DURATION_MINUTES}" \
      Nodes="${DEMO_RESERVATION_NODE}" \
      Users="${DEMO_RESERVATION_USER}" \
      >/dev/null
  fi
}

log "installing synthetic batch scripts"

GROMACS_SCRIPT="$(prepare_job_script demo01 gromacs-md "${STEADY_TEMPLATE}")"
REPLICA_SCRIPT="$(prepare_job_script demo01 replica-expansion "${STEADY_TEMPLATE}")"
POSTPROCESS_SCRIPT="$(prepare_job_script demo01 md-postprocess "${STEADY_TEMPLATE}")"

LAMMPS_SCRIPT="$(prepare_job_script demo02 lammps-solvation "${STEADY_TEMPLATE}")"

WRF_MEMBER_SCRIPT="$(prepare_job_script demo03 wrf-member-07 "${STEADY_TEMPLATE}")"
WRF_EXTRA_SCRIPT="$(prepare_job_script demo03 wrf-ensemble-extra "${STEADY_TEMPLATE}")"
FORECAST_SCRIPT="$(prepare_job_script demo03 forecast-regrid "${STEADY_TEMPLATE}")"
CHECKPOINT_SCRIPT="$(prepare_job_script demo03 checkpoint-restart "${STEADY_TEMPLATE}")"
WRF_RESTART_SCRIPT="$(prepare_job_script demo03 wrf-restart "${STEADY_TEMPLATE}")"
CLIMATE_RESTART_SCRIPT="$(prepare_job_script demo03 climate-restart "${STEADY_TEMPLATE}")"
LEGACY_CUDA_SCRIPT="$(prepare_job_script demo03 legacy-cuda-forecast "${STEADY_TEMPLATE}")"
OCEAN_ROCM_SCRIPT="$(prepare_job_script demo03 ocean-rocm "${STEADY_TEMPLATE}")"

CFD_MESH_SCRIPT="$(prepare_job_script demo04 cfd-mesh "${STEADY_TEMPLATE}")"
MEMCAP_SCRIPT="$(prepare_job_script demo04 mesh-preconditioner "${STEADY_TEMPLATE}")"
MESH_REFINE_SCRIPT="$(prepare_job_script demo04 mesh-refine-large "${STEADY_TEMPLATE}")"
CFD_FACTOR_SCRIPT="$(prepare_job_script demo04 cfd-factorization "${STEADY_TEMPLATE}")"
LARGE_MESH_SCRIPT="$(prepare_job_script demo04 large-mesh-solve "${STEADY_TEMPLATE}")"
RENDER_SCRIPT="$(prepare_job_script demo04 render-batch "${STEADY_TEMPLATE}")"
DIFFUSION_SCRIPT="$(prepare_job_script demo04 diffusion-eval "${STEADY_TEMPLATE}")"
URGENT_SCRIPT="$(prepare_job_script demo04 urgent-sim "${STEADY_TEMPLATE}")"
RESERVATION_SCRIPT="$(prepare_job_script "${DEMO_RESERVATION_USER}" reserved-calibration "${STEADY_TEMPLATE}")"
ARRAY_SCRIPT="$(prepare_job_script demo04 parameter-sweep "${ARRAY_TEMPLATE}")"

VISION_SCRIPT="$(prepare_job_script demo05 vision-pretrain "${STEADY_TEMPLATE}")"
H100_EVAL_SCRIPT="$(prepare_job_script demo05 h100-eval "${STEADY_TEMPLATE}")"

ML_SESSION_SCRIPT="$(prepare_job_script demo06 ml-lab-session "${STEADY_TEMPLATE}")"
ML_NEXT_SCRIPT="$(prepare_job_script demo06 ml-lab-next "${STEADY_TEMPLATE}")"

if workload_needs_anchor_recovery; then
  ANCHOR_RECOVERY_ACTIVE=1
  log "running-anchor drift detected; restoring the anchor layer first"
  clear_pending_scenarios_for_anchor_recovery
fi

log "reconciling running anchors"

GROMACS_ID="$(
  ensure_running \
    gromacs-md demo01 gromacs-md "${GROMACS_SCRIPT}" \
    --qos=normal \
    --partition=compute \
    --nodelist=cpu01,cpu02 \
    --nodes=2 \
    --ntasks=32 \
    --ntasks-per-node=16 \
    --cpus-per-task=1 \
    --mem-per-cpu=1G \
    --time=06:00:00
)"

ensure_running \
  lammps-solvation demo02 lammps-solvation "${LAMMPS_SCRIPT}" \
  --qos=normal \
  --partition=compute \
  --nodelist=cpu03,cpu04 \
  --nodes=2 \
  --ntasks=24 \
  --ntasks-per-node=12 \
  --cpus-per-task=1 \
  --mem-per-cpu=1G \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  wrf-member-07 demo03 wrf-member-07 "${WRF_MEMBER_SCRIPT}" \
  --qos=shared \
  --partition=compute \
  --nodelist=cpu05 \
  --nodes=1 \
  --ntasks=16 \
  --cpus-per-task=1 \
  --mem=8G \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  cfd-mesh demo04 cfd-mesh "${CFD_MESH_SCRIPT}" \
  --qos=shared \
  --partition=compute \
  --nodelist=cpu06 \
  --nodes=1 \
  --ntasks=12 \
  --cpus-per-task=1 \
  --mem=8G \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  memcap-baseline demo04 mesh-preconditioner "${MEMCAP_SCRIPT}" \
  --qos=memcap \
  --partition=compute \
  --nodelist=cpu07 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=1 \
  --mem=8G \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  ml-lab-session demo06 ml-lab-session "${ML_SESSION_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodelist=gpu02 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=8G \
  --gres=gpu:a100:1 \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  vision-pretrain demo05 vision-pretrain "${VISION_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodelist=gpu03 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=8G \
  --gres=gpu:h100:1 \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  legacy-cuda-forecast demo03 legacy-cuda-forecast "${LEGACY_CUDA_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodelist=gpu01 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=8G \
  --gres=gpu:v100:1 \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  render-batch demo04 render-batch "${RENDER_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodelist=gpu04 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=8G \
  --gres=gpu:l40s:1 \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  ocean-rocm demo03 ocean-rocm "${OCEAN_ROCM_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodelist=gpu05 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=8G \
  --gres=gpu:mi250:1 \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  wrf-restart demo03 wrf-restart "${WRF_RESTART_SCRIPT}" \
  --qos=normal \
  --partition=highmem \
  --nodelist=highmem01 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=64G \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  cfd-factorization demo04 cfd-factorization "${CFD_FACTOR_SCRIPT}" \
  --qos=normal \
  --partition=highmem \
  --nodelist=highmem02 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=64G \
  --time=06:00:00 \
  >/dev/null

ensure_running \
  climate-restart demo03 climate-restart "${CLIMATE_RESTART_SCRIPT}" \
  --qos=normal \
  --partition=highmem \
  --nodelist=highmem03 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=128G \
  --time=06:00:00 \
  >/dev/null

# Start the large array only after the fixed anchors have fragmented the
# compute partition. Its low-priority sweep QOS keeps it behind the curated
# pending scenarios while the %4 throttle guarantees JobArrayTaskLimit.
ARRAY_ID="$(ensure_array "${ARRAY_SCRIPT}")"

log "reconciling pending-analysis scenarios"

ensure_pending \
  replica-expansion AssocGrpCpuLimit \
  demo01 replica-expansion "${REPLICA_SCRIPT}" \
  --qos=normal \
  --partition=compute \
  --nodes=1 \
  --ntasks=16 \
  --cpus-per-task=1 \
  --mem=8G \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  h100-eval AssocGrpGRES \
  demo05 h100-eval "${H100_EVAL_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=2 \
  --mem=4G \
  --gres=gpu:h100:1 \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  ml-lab-next AssocMaxJobsLimit \
  demo06 ml-lab-next "${ML_NEXT_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=2 \
  --mem=4G \
  --gres=gpu:a100:1 \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  wrf-ensemble-extra QOSGrpCpuLimit \
  demo03 wrf-ensemble-extra "${WRF_EXTRA_SCRIPT}" \
  --qos=shared \
  --partition=compute \
  --nodes=1 \
  --ntasks=8 \
  --cpus-per-task=1 \
  --mem=4G \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  mesh-refine-large QOSMaxMemoryPerUser \
  demo04 mesh-refine-large "${MESH_REFINE_SCRIPT}" \
  --qos=memcap \
  --partition=compute \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=1 \
  --mem=8G \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  diffusion-eval Resources \
  demo04 diffusion-eval "${DIFFUSION_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=2 \
  --mem=8G \
  --gres=gpu:a100:2 \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  large-mesh-solve Resources \
  demo04 large-mesh-solve "${LARGE_MESH_SCRIPT}" \
  --qos=normal \
  --partition=highmem \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=4 \
  --mem=192G \
  --time=06:00:00 \
  >/dev/null

URGENT_ID="$(
  ensure_pending \
    urgent-sim Resources \
    demo04 urgent-sim "${URGENT_SCRIPT}" \
    --qos=short \
    --partition=compute \
    --nodes=1 \
    --ntasks=16 \
    --cpus-per-task=1 \
    --mem=4G \
    --time=00:05:00
)"

ensure_pending \
  forecast-regrid Priority \
  demo03 forecast-regrid "${FORECAST_SCRIPT}" \
  --qos=normal \
  --partition=compute \
  --nodes=1 \
  --ntasks=16 \
  --cpus-per-task=1 \
  --mem=4G \
  --nice=10000 \
  --time=06:00:00 \
  >/dev/null

ensure_pending \
  md-postprocess Dependency \
  demo01 md-postprocess "${POSTPROCESS_SCRIPT}" \
  --qos=normal \
  --partition=compute \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=1 \
  --mem=1G \
  --dependency="afterok:${GROMACS_ID}" \
  --time=02:00:00 \
  >/dev/null

ensure_pending \
  checkpoint-restart ReqNodeNotAvail \
  demo03 checkpoint-restart "${CHECKPOINT_SCRIPT}" \
  --qos=normal \
  --partition=compute \
  --nodelist=cpu08 \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=1 \
  --mem=1G \
  --time=02:00:00 \
  >/dev/null

ensure_reservation

ensure_pending \
  reserved-calibration Reservation \
  "${DEMO_RESERVATION_USER}" reserved-calibration "${RESERVATION_SCRIPT}" \
  --qos=normal \
  --partition=gpu \
  --reservation="${DEMO_RESERVATION_NAME}" \
  --nodelist="${DEMO_RESERVATION_NODE}" \
  --nodes=1 \
  --ntasks=1 \
  --cpus-per-task=2 \
  --mem=4G \
  --gres=gpu:v100:1 \
  --time=00:20:00 \
  >/dev/null

log "demo workload is seeded"
printf 'gromacs_job_id=%s\n' "${GROMACS_ID}"
printf 'array_job_id=%s\n' "${ARRAY_ID}"
printf 'urgent_job_id=%s\n' "${URGENT_ID}"
