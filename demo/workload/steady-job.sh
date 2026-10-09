#!/usr/bin/env bash
set -euo pipefail

job_name="${SLURM_JOB_NAME:-synthetic-workload}"

case "${job_name}" in
  gromacs-md)
    description="molecular dynamics trajectory"
    ;;
  lammps-solvation)
    description="solvation simulation"
    ;;
  wrf-member-07)
    description="WRF ensemble member"
    ;;
  cfd-mesh)
    description="OpenFOAM mesh preparation"
    ;;
  mesh-preconditioner)
    description="mesh preconditioner"
    ;;
  ml-lab-session)
    description="A100 teaching lab"
    ;;
  vision-pretrain)
    description="H100 vision pretraining"
    ;;
  legacy-cuda-forecast)
    description="V100 forecast kernel"
    ;;
  render-batch)
    description="L40S rendering batch"
    ;;
  ocean-rocm)
    description="MI250 ocean model"
    ;;
  wrf-restart)
    description="high-memory WRF restart"
    ;;
  cfd-factorization)
    description="high-memory sparse factorization"
    ;;
  climate-restart)
    description="large climate restart"
    ;;
  *)
    description="synthetic demo workload"
    ;;
esac

printf 'Synthetic Slurm View demo workload\n'
printf 'job=%s\n' "${job_name}"
printf 'description=%s\n' "${description}"
printf 'job_id=%s\n' "${SLURM_JOB_ID:-unknown}"
printf 'nodes=%s\n' "${SLURM_JOB_NODELIST:-unknown}"
printf 'started=%s\n' "$(date --iso-8601=seconds)"

iteration=0
while :; do
  printf '%s iteration=%d status=running\n' \
    "$(date --iso-8601=seconds)" \
    "${iteration}"
  iteration=$((iteration + 1))
  sleep 60
done
