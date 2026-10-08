ARG ROCKY_MAJOR=10
FROM rockylinux/rockylinux:${ROCKY_MAJOR}

ARG ROCKY_MAJOR
ARG OPENHPC_MAJOR
ARG SLURM_VERSION
ARG SLURM_RELEASE
ARG SLURM_UID
ARG SLURM_GID

COPY scripts/demo-identities.sh /tmp/demo-identities.sh

RUN set -eux; \
    dnf install -y shadow-utils; \
    groupadd --gid "${SLURM_GID}" slurm; \
    useradd --uid "${SLURM_UID}" --gid "${SLURM_GID}" --no-create-home --home-dir /var/lib/slurm --shell /usr/sbin/nologin slurm; \
    bash -c 'set -euo pipefail; \
      source /tmp/demo-identities.sh; \
      for index in "${!DEMO_USERS[@]}"; do \
        user="${DEMO_USERS[$index]}"; \
        uid="${DEMO_UIDS[$index]}"; \
        groupadd --gid "${uid}" "${user}"; \
        useradd \
          --uid "${uid}" \
          --gid "${uid}" \
          --no-create-home \
          --home-dir "/srv/slurm-view-demo/shared-home/${user}" \
          --shell /usr/sbin/nologin \
          "${user}"; \
      done'; \
    rm -f /tmp/demo-identities.sh; \
    dnf install -y \
      "https://repos.openhpc.community/OpenHPC/${OPENHPC_MAJOR}/EL_${ROCKY_MAJOR}/x86_64/ohpc-release-${OPENHPC_MAJOR}-1.el${ROCKY_MAJOR}.x86_64.rpm"; \
    dnf install -y \
      munge \
      python3 \
      "slurm-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.x86_64" \
      "slurm-slurmctld-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.x86_64" \
      "slurm-slurmd-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.x86_64" \
      "slurm-slurmdbd-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.x86_64"; \
    dnf clean all; \
    rm -rf /var/cache/dnf; \
    install -d -o munge -g munge -m 0755 /run/munge /var/lib/munge /var/log/munge; \
    install -d -o slurm -g slurm -m 0755 /var/spool/slurmctld /var/spool/slurmdbd; \
    install -d -o root -g root -m 0755 /var/spool/slurmd /run/demo-secrets

COPY slurm/entrypoint.sh /usr/local/bin/slurm-demo-entrypoint
RUN chmod 0755 /usr/local/bin/slurm-demo-entrypoint

ENTRYPOINT ["/usr/local/bin/slurm-demo-entrypoint"]
