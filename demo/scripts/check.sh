#!/usr/bin/env bash
set -euo pipefail

DEMO_STATE_ROOT="${SLURM_VIEW_DEMO_STATE_DIR:-/srv/slurm-view-demo}"
JOB_DIR="${DEMO_STATE_ROOT}/shared-home/demo01"

log() {
  printf '[demo check] %s\n' "$*"
}

die() {
  printf '[demo check] error: %s\n' "$*" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || die "run this script as root"
id demo01 >/dev/null 2>&1 || die "demo01 user is missing"
[[ -d "${JOB_DIR}" ]] || die "shared demo01 home is missing"

log "checking controller and node"
scontrol ping | grep -q 'UP' || die "slurmctld is not responding"
NODE_STATE="$(sinfo -h -N -n cpu01 -o '%T' | head -n 1)"
[[ "${NODE_STATE}" == idle* ]] || die "cpu01 is not idle (state: ${NODE_STATE})"

OUTPUT_FILE="${JOB_DIR}/smoke-%j.out"

log "submitting accounting smoke job"
JOB_ID="$({
  runuser -u demo01 -- sbatch \
    --parsable \
    --account=research \
    --partition=compute \
    --job-name=demo-smoke \
    --cpus-per-task=1 \
    --mem=128M \
    --chdir="${JOB_DIR}" \
    --output="${OUTPUT_FILE}" \
    <<'JOB'
#!/usr/bin/env bash
set -euo pipefail

python3 <<'PY'
import time

payload = bytearray(32 * 1024 * 1024)
end = time.monotonic() + 6
value = 1

while time.monotonic() < end:
    value = (value * 1103515245 + 12345) & 0x7fffffff

payload[value % len(payload)] = value & 0xff
print(value)
PY
JOB
} | cut -d';' -f1)"

[[ "${JOB_ID}" =~ ^[0-9]+$ ]] || die "unexpected sbatch response: ${JOB_ID}"
log "submitted job ${JOB_ID}"

FINAL_STATE=""
for _ in $(seq 1 90); do
  FINAL_STATE="$(
    sacct -nP -j "${JOB_ID}" --starttime now-10minutes --format=JobIDRaw,State \
      | awk -F'|' -v id="${JOB_ID}" '$1 == id { print $2; exit }'
  )"

  case "${FINAL_STATE}" in
    COMPLETED*)
      break
      ;;
    FAILED*|CANCELLED*|TIMEOUT*|OUT_OF_MEMORY*|NODE_FAIL*)
      die "job ${JOB_ID} finished in state ${FINAL_STATE}"
      ;;
  esac

  sleep 2
done

[[ "${FINAL_STATE}" == COMPLETED* ]] || die "job ${JOB_ID} did not complete in time"

log "accounting record"
sacct \
  -j "${JOB_ID}" \
  --starttime now-10minutes \
  --format=JobID,JobName,User,Account,Partition,State,Elapsed,AllocCPUS,MaxRSS,TotalCPU

log "efficiency report"
seff "${JOB_ID}"

log "minimal cluster check passed"
