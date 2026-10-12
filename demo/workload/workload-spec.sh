#!/usr/bin/env bash

DEMO_WORKLOAD_OWNER=slurm-view-demo
DEMO_RESERVATION_NAME=demo-calibration
DEMO_RESERVATION_USER=demo04
DEMO_RESERVATION_NODE=gpu01
DEMO_RESERVATION_DURATION_MINUTES=30
DEMO_RESERVATION_LEAD_HOURS=24
DEMO_RESERVATION_ROTATE_HOURS=12

DEMO_RUNNING_SLOTS=(
  gromacs-md
  lammps-solvation
  wrf-member-07
  cfd-mesh
  memcap-baseline
  ml-lab-session
  vision-pretrain
  legacy-cuda-forecast
  render-batch
  ocean-rocm
  wrf-restart
  cfd-factorization
  climate-restart
)

DEMO_PENDING_SLOTS=(
  replica-expansion
  h100-eval
  ml-lab-next
  wrf-ensemble-extra
  mesh-refine-large
  diffusion-eval
  large-mesh-solve
  urgent-sim
  forecast-regrid
  md-postprocess
  checkpoint-restart
  reserved-calibration
)

DEMO_PENDING_REASONS=(
  AssocGrpCpuLimit
  AssocGrpGRES
  AssocMaxJobsLimit
  QOSGrpCpuLimit
  QOSMaxMemoryPerUser
  Resources
  Resources
  Resources
  Priority
  Dependency
  ReqNodeNotAvail
  Reservation
)

DEMO_ARRAY_SLOT=parameter-sweep
DEMO_ARRAY_NAME=parameter-sweep
DEMO_ARRAY_USER=demo04
DEMO_ARRAY_SIZE=256
DEMO_ARRAY_THROTTLE=4

workload_comment_for() {
  local slot=$1
  printf '%s:%s\n' "${DEMO_WORKLOAD_OWNER}" "${slot}"
}
