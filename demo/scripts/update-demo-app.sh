#!/usr/bin/env bash
set -euo pipefail

REPO="Anish-Chanda/slurm-view"
INSTALL_DIR="/opt/slurm-view"
RELEASES_DIR="${INSTALL_DIR}/releases"
CURRENT="${INSTALL_DIR}/current"
SERVICE="slurm-view.service"

log() { printf '[slurm-view update] %s\n' "$*"; }
die() { printf '[slurm-view update] error: %s\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || die "run as root (sudo ./demo/scripts/update-demo-app.sh)"

for cmd in curl node npm tar sha256sum mktemp systemctl readlink; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd is required"
done

[[ -d "$RELEASES_DIR" ]] || die "missing $RELEASES_DIR"
[[ -L "$CURRENT" ]] || die "$CURRENT must be a symlink"
systemctl cat "$SERVICE" >/dev/null || die "missing systemd unit $SERVICE"

case "${1:-}" in
  --release|release) MODE=release ;;
  --main|main) MODE=main ;;
  "")
    printf 'Update Slurm View from:\n  1) Latest stable release\n  2) Latest commit on main (build from source)\n'
    read -r -p 'Choose [1/2]: ' choice \
      || die "interactive input unavailable; pass --release or --main"
    case "$choice" in
      1) MODE=release ;;
      2) MODE=main ;;
      *) die "choose 1 or 2" ;;
    esac
    ;;
  *) die "usage: $0 [--release|--main]" ;;
esac

if [[ "$MODE" == main ]]; then
  command -v git >/dev/null 2>&1 || die "git is required for main updates"

  log "checking latest commit on main"
  SHA="$(
    git ls-remote "https://github.com/${REPO}.git" refs/heads/main | cut -f1
  )" || die "could not query main"

  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "unexpected main commit: $SHA"
  VERSION="main-${SHA:0:12}"
else
  log "checking latest stable GitHub release"
  VERSION="$(
    curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/${REPO}/releases/latest" \
      | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).tag_name'
  )" || die "could not find the latest release"

  [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die "unexpected release tag: $VERSION"
fi

TARGET="${RELEASES_DIR}/${VERSION}"
PREVIOUS="$(readlink -f "$CURRENT")"

if [[ "$PREVIOUS" == "$TARGET" ]]; then
  log "$VERSION is already deployed"
  exit 0
fi

log "current: $PREVIOUS"
log "target:  $VERSION"

TMP=""
STAGING=""
NEXT_LINK=""

cleanup() {
  [[ -z "$NEXT_LINK" ]] || rm -f -- "$NEXT_LINK"
  [[ -z "$STAGING" ]] || rm -rf -- "$STAGING"
  [[ -z "$TMP" ]] || rm -rf -- "$TMP"
}
trap cleanup EXIT

if [[ ! -d "$TARGET" ]]; then
  TMP="$(mktemp -d)"
  STAGING="$(mktemp -d "${RELEASES_DIR}/.install.XXXXXX")"

  if [[ "$MODE" == release ]]; then
    ARCHIVE="slurm-view-${VERSION}.tar.gz"
    BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"

    log "downloading release archive and checksum"
    curl -fL --retry 3 -o "${TMP}/${ARCHIVE}" "${BASE_URL}/${ARCHIVE}"
    curl -fL --retry 3 -o "${TMP}/${ARCHIVE}.sha256" "${BASE_URL}/${ARCHIVE}.sha256"

    (cd "$TMP" && sha256sum -c "${ARCHIVE}.sha256") \
      || die "checksum verification failed"

    tar -xzf "${TMP}/${ARCHIVE}" -C "$STAGING" --strip-components=1
  else
    log "cloning main and building application"

    git clone --quiet --depth 1 --single-branch --branch main \
      "https://github.com/${REPO}.git" "${TMP}/source"

    [[ "$(git -C "${TMP}/source" rev-parse HEAD)" == "$SHA" ]] \
      || die "main changed while cloning; run the update again"

    (
      cd "${TMP}/source"
      npm ci --no-audit --no-fund
      npm run build
      npm prune --omit=dev --no-audit --no-fund
    )

    cp -a \
      "${TMP}/source/app.js" \
      "${TMP}/source/manifest.yml" \
      "${TMP}/source/package.json" \
      "${TMP}/source/package-lock.json" \
      "${TMP}/source/LICENSE" \
      "${TMP}/source/config.d" \
      "${TMP}/source/dist" \
      "${TMP}/source/node_modules" \
      "$STAGING/"

    printf '%s\n' "$SHA" > "${STAGING}/REVISION"
  fi

  [[ -f "${STAGING}/app.js" && \
     -f "${STAGING}/package-lock.json" && \
     -f "${STAGING}/dist/server/index.js" && \
     -f "${STAGING}/dist/client/index.html" && \
     -f "${STAGING}/config.d/default.yaml" ]] \
    || die "application files are incomplete"

  if [[ "$MODE" == release ]]; then
    log "installing production dependencies"
    (cd "$STAGING" && npm ci --omit=dev --no-audit --no-fund)
  fi

  (
    cd "$STAGING"
    node -e 'if (typeof require("./dist/server/index.js").startServer !== "function") process.exit(1)'
  )

  mv -- "$STAGING" "$TARGET"
  STAGING=""

  log "installed $VERSION in $TARGET"
else
  [[ -f "$TARGET/app.js" && \
     -f "$TARGET/dist/server/index.js" && \
     -f "$TARGET/dist/client/index.html" && \
     -d "$TARGET/node_modules" ]] \
    || die "existing directory is incomplete: $TARGET"

  log "using existing directory: $TARGET"
fi

NEXT_LINK="${INSTALL_DIR}/.current.$$"
ln -s "$TARGET" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT"
NEXT_LINK=""

log "restarting $SERVICE"
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE" \
  || die "$SERVICE is not active; check journalctl -u $SERVICE"

log "deployed $VERSION (previous: $PREVIOUS)"
