#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${NEXUS_REPO_URL:-https://github.com/lusya123/Nexus.git}"
BRANCH="${NEXUS_BRANCH:-main}"
INSTALL_ROOT="${NEXUS_HOME:-$HOME/.nexus}"
APP_DIR="$INSTALL_ROOT/app"
BIN_DIR="${NEXUS_BIN_DIR:-$HOME/.local/bin}"
NEXUS_CMD="$BIN_DIR/nexus"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[install] Missing required command: $1" >&2
    exit 1
  fi
}

echo "[install] Nexus installer"
echo "[install] repo: $REPO_URL"
echo "[install] app : $APP_DIR"

need_cmd git
need_cmd node
need_cmd npm

mkdir -p "$INSTALL_ROOT"

if [[ -d "$APP_DIR/.git" ]]; then
  echo "[install] Existing install found, updating..."
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  echo "[install] Cloning repository..."
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "[install] Installing dependencies..."
npm install --prefix "$APP_DIR"
npm install --prefix "$APP_DIR/client"

echo "[install] Building frontend..."
npm run build --prefix "$APP_DIR/client"

mkdir -p "$BIN_DIR"
cat >"$NEXUS_CMD" <<EOF
#!/usr/bin/env bash
exec "$APP_DIR/scripts/nexusctl.sh" "\$@"
EOF
chmod +x "$NEXUS_CMD"
chmod +x "$APP_DIR/scripts/nexusctl.sh"

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    echo "[install] $BIN_DIR is not in PATH."
    echo "[install] Add this line to ~/.zshrc or ~/.bashrc:"
    echo "export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo ""
echo "[install] Done."
echo "Run:"
echo "  nexus start      # production mode"
echo "  nexus dev-start  # development mode"
echo "  nexus status"
echo "  nexus logs prod"
