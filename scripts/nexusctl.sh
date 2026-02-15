#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_STATE_DIR="${NEXUS_STATE_DIR:-$HOME/.nexus}"
STATE_DIR="$DEFAULT_STATE_DIR"
if ! mkdir -p "$STATE_DIR" >/dev/null 2>&1; then
  STATE_DIR="$REPO_ROOT/.nexus-runtime"
fi
RUN_DIR="$STATE_DIR/run"
LOG_DIR="$STATE_DIR/logs"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
PROD_PID_FILE="$RUN_DIR/prod.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PROD_LOG="$LOG_DIR/prod.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd npm

ensure_deps() {
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "[nexus] Installing root dependencies..."
    npm install --prefix "$REPO_ROOT"
  fi
  if [[ ! -d "$REPO_ROOT/client/node_modules" ]]; then
    echo "[nexus] Installing client dependencies..."
    npm install --prefix "$REPO_ROOT/client"
  fi
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

stop_from_pid_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$file"
    return 0
  fi

  if is_pid_running "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.3
    if is_pid_running "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "[nexus] Stopped $label (pid=$pid)"
  fi
  rm -f "$file"
}

wait_for_port() {
  local port="$1"
  local tries=40
  while (( tries > 0 )); do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
    tries=$((tries - 1))
  done
  return 1
}

build_frontend_if_needed() {
  if [[ ! -f "$REPO_ROOT/dist/index.html" ]]; then
    echo "[nexus] Building frontend..."
    npm run build --prefix "$REPO_ROOT/client"
  fi
}

start_prod() {
  ensure_deps
  build_frontend_if_needed
  stop_prod >/dev/null 2>&1 || true
  stop_dev >/dev/null 2>&1 || true

  echo "[nexus] Starting Nexus (prod mode)..."
  nohup env NODE_ENV=production node "$REPO_ROOT/server/index.js" >"$PROD_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$PROD_PID_FILE"

  if wait_for_port 3000; then
    echo "[nexus] Started (pid=$pid)"
    echo "[nexus] Open: http://localhost:3000"
    return 0
  fi

  echo "[nexus] Failed to start, check logs: $PROD_LOG" >&2
  return 1
}

stop_prod() {
  stop_from_pid_file "$PROD_PID_FILE" "prod server"
}

restart_prod() {
  stop_prod
  start_prod
}

start_dev() {
  ensure_deps
  stop_prod >/dev/null 2>&1 || true
  stop_dev >/dev/null 2>&1 || true

  echo "[nexus] Starting backend dev server..."
  nohup npm run dev:backend --prefix "$REPO_ROOT" >"$BACKEND_LOG" 2>&1 &
  local backend_pid=$!
  echo "$backend_pid" >"$BACKEND_PID_FILE"

  if ! wait_for_port 3000; then
    echo "[nexus] Backend failed to start, check logs: $BACKEND_LOG" >&2
    return 1
  fi

  echo "[nexus] Starting frontend dev server..."
  nohup npm run dev --prefix "$REPO_ROOT/client" -- --host 0.0.0.0 >"$FRONTEND_LOG" 2>&1 &
  local frontend_pid=$!
  echo "$frontend_pid" >"$FRONTEND_PID_FILE"

  if wait_for_port 5173; then
    echo "[nexus] Dev started"
    echo "[nexus] Frontend: http://localhost:5173"
    echo "[nexus] Backend:  http://localhost:3000"
    return 0
  fi

  echo "[nexus] Frontend failed to start, check logs: $FRONTEND_LOG" >&2
  return 1
}

stop_dev() {
  stop_from_pid_file "$BACKEND_PID_FILE" "dev backend"
  stop_from_pid_file "$FRONTEND_PID_FILE" "dev frontend"
}

restart_dev() {
  stop_dev
  start_dev
}

status() {
  local has=0

  if [[ -f "$PROD_PID_FILE" ]]; then
    local pid
    pid="$(cat "$PROD_PID_FILE" 2>/dev/null || true)"
    if is_pid_running "$pid"; then
      echo "prod: running (pid=$pid)"
      has=1
    else
      echo "prod: stale pid file"
    fi
  else
    echo "prod: stopped"
  fi

  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local bpid
    bpid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if is_pid_running "$bpid"; then
      echo "dev-backend: running (pid=$bpid)"
      has=1
    else
      echo "dev-backend: stale pid file"
    fi
  else
    echo "dev-backend: stopped"
  fi

  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    local fpid
    fpid="$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)"
    if is_pid_running "$fpid"; then
      echo "dev-frontend: running (pid=$fpid)"
      has=1
    else
      echo "dev-frontend: stale pid file"
    fi
  else
    echo "dev-frontend: stopped"
  fi

  if [[ "$has" -eq 0 ]]; then
    return 1
  fi
}

logs() {
  local target="${1:-all}"
  case "$target" in
    prod) tail -n 120 -f "$PROD_LOG" ;;
    backend) tail -n 120 -f "$BACKEND_LOG" ;;
    frontend) tail -n 120 -f "$FRONTEND_LOG" ;;
    all)
      echo "prod: $PROD_LOG"
      echo "backend: $BACKEND_LOG"
      echo "frontend: $FRONTEND_LOG"
      ;;
    *)
      echo "Unknown log target: $target" >&2
      exit 1
      ;;
  esac
}

usage() {
  cat <<'EOF'
Usage: nexus <command>

Commands:
  start           Start production server (serves built frontend)
  stop            Stop production server
  restart         Restart production server
  dev-start       Start backend + frontend in dev mode
  dev-stop        Stop backend + frontend in dev mode
  dev-restart     Restart backend + frontend in dev mode
  status          Show running status
  logs [target]   Show logs path or tail logs (prod|backend|frontend|all)
  install-deps    Install root and client dependencies
  build           Build frontend dist assets
EOF
}

cmd="${1:-}"
case "$cmd" in
  start) start_prod ;;
  stop) stop_prod ;;
  restart) restart_prod ;;
  dev-start) start_dev ;;
  dev-stop) stop_dev ;;
  dev-restart) restart_dev ;;
  status) status ;;
  logs) logs "${2:-all}" ;;
  install-deps) ensure_deps ;;
  build) npm run build --prefix "$REPO_ROOT/client" ;;
  ""|-h|--help|help) usage ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
