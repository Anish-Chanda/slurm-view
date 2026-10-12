#!/usr/bin/env bash
set -euo pipefail

task_id="${SLURM_ARRAY_TASK_ID:?SLURM_ARRAY_TASK_ID is required}"

# Deterministic but varied runtimes keep the array map moving without burning
# CPU on the physical demo VM. Tasks take roughly 8-18 minutes, and a small
# fraction fail deliberately so the map contains realistic terminal states.
# At four concurrent tasks a 256-task generation lasts roughly fourteen hours,
# which gives the public demo a useful mix without excessive accounting churn.
duration=$((480 + (task_id * 53) % 601))
steps=8
sleep_per_step=$((duration / steps))
[[ ${sleep_per_step} -ge 1 ]] || sleep_per_step=1

printf 'Synthetic parameter sweep\n'
printf 'array_job_id=%s\n' "${SLURM_ARRAY_JOB_ID:-unknown}"
printf 'task_id=%s\n' "${task_id}"
printf 'planned_runtime_seconds=%s\n' "${duration}"

for step in $(seq 1 "${steps}"); do
  printf '%s task=%s step=%s/%s\n' \
    "$(date --iso-8601=seconds)" \
    "${task_id}" \
    "${step}" \
    "${steps}"
  sleep "${sleep_per_step}"
done

if (( task_id % 23 == 0 )); then
  printf 'task=%s synthetic_result=failed\n' "${task_id}" >&2
  exit 2
fi

printf 'task=%s synthetic_result=completed\n' "${task_id}"
