#!/usr/bin/env bash
set -euo pipefail

MUNGE_SOURCE=/run/demo-secrets/munge.key
MUNGE_TARGET=/etc/munge/munge.key

[[ -s "${MUNGE_SOURCE}" ]] || {
  echo "missing MUNGE key: ${MUNGE_SOURCE}" >&2
  exit 1
}

install -o munge -g munge -m 0400 "${MUNGE_SOURCE}" "${MUNGE_TARGET}"
install -d -o munge -g munge -m 0755 /run/munge /var/lib/munge /var/log/munge

munged --force

for _ in $(seq 1 20); do
  if munge -n | unmunge >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

munge -n | unmunge >/dev/null 2>&1 || {
  echo "MUNGE failed to become ready" >&2
  exit 1
}

case "${SLURM_ROLE:-}" in
  slurmdbd)
    install -d -o slurm -g slurm -m 0755 /var/spool/slurmdbd
    exec slurmdbd -Dvv
    ;;

  slurmctld)
    install -d -o slurm -g slurm -m 0755 /var/spool/slurmctld
    exec slurmctld -Dvv
    ;;

  slurmd)
    : "${SLURM_NODE_NAME:?SLURM_NODE_NAME must be set for slurmd}"
    install -d -o root -g root -m 0755 /var/spool/slurmd
    exec slurmd -Dvv -N "${SLURM_NODE_NAME}"
    ;;

  *)
    echo "unsupported SLURM_ROLE: ${SLURM_ROLE:-<unset>}" >&2
    exit 1
    ;;
esac
