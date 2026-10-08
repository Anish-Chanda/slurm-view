#!/usr/bin/env bash
set -euo pipefail

DEMO_STATE_ROOT="${SLURM_VIEW_DEMO_STATE_DIR:-/srv/slurm-view-demo}"
PLUGIN_DIR="/usr/lib64/slurm"
PLUGIN_PATH="${PLUGIN_DIR}/serializer_json.so"

log() {
  printf '[demo json serializer] %s\n' "$*"
}

die() {
  printf '[demo json serializer] error: %s\n' "$*" >&2
  exit 1
}

if [[ ${EUID} -ne 0 ]]; then
  die "run this script as root"
fi

if [[ $# -ne 2 ]]; then
  die "usage: $0 SLURM_VERSION SLURM_RELEASE"
fi

SLURM_VERSION="$1"
SLURM_RELEASE="$2"

[[ "$(uname -m)" == "x86_64" ]] || \
  die "this demo currently supports x86_64 only"

command -v dnf >/dev/null 2>&1 || die "dnf is required"
command -v rpm >/dev/null 2>&1 || die "rpm is required"
command -v scontrol >/dev/null 2>&1 || die "scontrol is required"

INSTALLED_SLURM="$(
  rpm -q --qf '%{VERSION}-%{RELEASE}' slurm-ohpc
)"
EXPECTED_SLURM="${SLURM_VERSION}-${SLURM_RELEASE}"

[[ "${INSTALLED_SLURM}" == "${EXPECTED_SLURM}" ]] || \
  die "expected slurm-ohpc ${EXPECTED_SLURM}, found ${INSTALLED_SLURM}"

if [[ -f "${PLUGIN_PATH}" ]] &&
   scontrol --json=list >/dev/null 2>&1; then
  log "JSON serializer is already available"
  exit 0
fi

log "installing JSON serializer build prerequisites"

dnf install -y dnf-plugins-core

dnf config-manager --set-enabled crb

dnf install -y \
  rpm-build \
  json-c-devel \
  cpio \
  lmod-ohpc

BUILD_ROOT="${DEMO_STATE_ROOT}/state/build/json-serializer"
RPMBUILD_TOP="${BUILD_ROOT}/rpmbuild"
BUILD_HOME="${BUILD_ROOT}/home"

rm -rf "${BUILD_ROOT}"

install -d -m 0755 \
  "${BUILD_ROOT}" \
  "${BUILD_HOME}" \
  "${RPMBUILD_TOP}/BUILD" \
  "${RPMBUILD_TOP}/BUILDROOT" \
  "${RPMBUILD_TOP}/RPMS" \
  "${RPMBUILD_TOP}/SOURCES" \
  "${RPMBUILD_TOP}/SPECS" \
  "${RPMBUILD_TOP}/SRPMS"

log "downloading matching OpenHPC Slurm source RPM"

(
  cd "${BUILD_ROOT}"

  dnf download \
    --source \
    --disablerepo='*' \
    --enablerepo='OpenHPC' \
    --enablerepo='OpenHPC-updates' \
    "slurm-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.x86_64"
)

SOURCE_RPM="$(
  find "${BUILD_ROOT}" \
    -maxdepth 1 \
    -type f \
    -name "slurm-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.src.rpm" \
    -print \
    -quit
)"

[[ -n "${SOURCE_RPM}" ]] || \
  die "matching Slurm source RPM was not downloaded"

SOURCE_VERSION="$(
  rpm -qp --qf '%{VERSION}-%{RELEASE}' "${SOURCE_RPM}"
)"

[[ "${SOURCE_VERSION}" == "${EXPECTED_SLURM}" ]] || \
  die "source RPM version mismatch: expected ${EXPECTED_SLURM}, found ${SOURCE_VERSION}"

log "installing OpenHPC Slurm build dependencies"

dnf builddep -y \
  --nobest \
  --disablerepo='*-source' \
  "${SOURCE_RPM}"

[[ -f /etc/profile.d/lmod.sh ]] || \
  die "Lmod initialization script was not installed"

pkg-config --exists json-c || \
  die "json-c development files are not available"

BUILD_USER="${SUDO_USER:-root}"

if [[ "${BUILD_USER}" != "root" ]]; then
  id "${BUILD_USER}" >/dev/null 2>&1 || \
    die "build user ${BUILD_USER} does not exist"

  BUILD_GROUP="$(id -gn "${BUILD_USER}")"

  chown -R \
    "${BUILD_USER}:${BUILD_GROUP}" \
    "${BUILD_ROOT}"

  log "building Slurm RPMs as ${BUILD_USER}"

  runuser -u "${BUILD_USER}" -- \
    env \
      HOME="${BUILD_HOME}" \
      RPMBUILD_TOP="${RPMBUILD_TOP}" \
      SOURCE_RPM="${SOURCE_RPM}" \
    bash -c '
      set -euo pipefail

      set +u
      source /etc/profile.d/lmod.sh
      set -u
      export -f module

      rpmbuild \
        --rebuild \
        --target x86_64 \
        --define "_topdir ${RPMBUILD_TOP}" \
        "${SOURCE_RPM}"
    '
else
  log "building Slurm RPMs as root"

  set +u
  source /etc/profile.d/lmod.sh
  set -u
  export -f module

  rpmbuild \
    --rebuild \
    --target x86_64 \
    --define "_topdir ${RPMBUILD_TOP}" \
    "${SOURCE_RPM}"
fi

REBUILT_RPM="$(
  find "${RPMBUILD_TOP}/RPMS/x86_64" \
    -maxdepth 1 \
    -type f \
    -name "slurm-ohpc-${SLURM_VERSION}-${SLURM_RELEASE}.x86_64.rpm" \
    -print \
    -quit
)"

[[ -n "${REBUILT_RPM}" ]] || \
  die "rebuilt slurm-ohpc RPM was not produced"

rpm -qlp "${REBUILT_RPM}" \
  | grep -Fx '/usr/lib64/slurm/serializer_json.so' >/dev/null || \
  die "rebuilt Slurm package does not contain serializer_json.so"

EXTRACT_ROOT="${BUILD_ROOT}/extract"
install -d -m 0755 "${EXTRACT_ROOT}"

(
  cd "${EXTRACT_ROOT}"

  rpm2cpio "${REBUILT_RPM}" \
    | cpio -idm --quiet \
      './usr/lib64/slurm/serializer_json.so'
)

EXTRACTED_PLUGIN="${EXTRACT_ROOT}/usr/lib64/slurm/serializer_json.so"

[[ -f "${EXTRACTED_PLUGIN}" ]] || \
  die "failed to extract serializer_json.so"

if ldd "${EXTRACTED_PLUGIN}" | grep -q 'not found'; then
  ldd "${EXTRACTED_PLUGIN}" >&2
  die "serializer_json.so has unresolved runtime dependencies"
fi

log "installing serializer_json.so"

install \
  -o root \
  -g root \
  -m 0755 \
  "${EXTRACTED_PLUGIN}" \
  "${PLUGIN_PATH}"

if command -v restorecon >/dev/null 2>&1; then
  restorecon -F "${PLUGIN_PATH}"
fi

scontrol --json=list >/dev/null 2>&1 || \
  die "Slurm JSON serializer failed validation after installation"

log "JSON serializer installed successfully"

rm -rf "${BUILD_ROOT}"
