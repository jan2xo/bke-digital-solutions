#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
ENV_TEMPLATE="$ROOT_DIR/.env.example"
COMPOSE_FILE="$ROOT_DIR/docker-compose.production.yml"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

require_base_tools() {
  have git || die "git is required."
  have docker || die "docker is required."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
  have node || die "Node.js is required."
  have npm || die "npm is required."
}

require_env() {
  [[ -f "$ENV_FILE" ]] || die "Missing .env. Run ./bke.sh setup first."
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

read_env_value() {
  local key="$1"
  awk -F= -v key="$key" '
    $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/\r$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "$ENV_FILE"
}

health_url() {
  local url="${BKE_HEALTH_URL:-}"
  if [[ -z "$url" ]]; then
    url="$(read_env_value APP_URL)"
  fi
  [[ -n "$url" ]] || die "APP_URL is missing from .env and BKE_HEALTH_URL is not set."
  printf '%s\n' "$url"
}

cmd_setup() {
  require_base_tools
  [[ -f "$ENV_TEMPLATE" ]] || die "Missing .env.example."
  if [[ -f "$ENV_FILE" ]]; then
    chmod 600 "$ENV_FILE"
    printf '.env already exists; left unchanged.\n'
    return
  fi
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf 'Created %s from .env.example and set mode 600.\n' "$ENV_FILE"
  printf 'Edit it with: ./bke.sh env\n'
}

cmd_env() {
  require_env
  local editor="${EDITOR:-}"
  if [[ -z "$editor" ]]; then
    if have nano; then
      editor="nano"
    elif have vi; then
      editor="vi"
    else
      die "Set EDITOR to your preferred editor."
    fi
  fi
  "$editor" "$ENV_FILE"
}

cmd_validate() {
  require_base_tools
  require_env
  npm run config:validate
  DEPLOYMENT_ENV_FILE="$ENV_FILE" DEPLOYMENT_COMPOSE_FILE="$COMPOSE_FILE" npm run ops:validate
  compose config --quiet
  printf 'V3 configuration validation passed.\n'
}

cmd_build() {
  require_base_tools
  require_env
  compose build app scheduler backup-worker migrate
}

cmd_migrate() {
  require_base_tools
  require_env
  compose --profile operations run --rm migrate
}

cmd_start() {
  require_base_tools
  require_env
  compose up -d app scheduler backup-worker caddy
  compose ps
}

cmd_deploy() {
  require_base_tools
  require_env
  local url
  url="$(health_url)"
  BKE_HEALTH_URL="$url" bash "$ROOT_DIR/scripts/deploy-production.sh"
}

cmd_update() {
  require_base_tools
  require_env
  if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
    die "Working tree is dirty; refusing update."
  fi
  git fetch origin
  git pull --ff-only origin main
  cmd_deploy
}

cmd_status() {
  require_base_tools
  require_env
  compose ps
}

cmd_logs() {
  require_base_tools
  require_env
  local tail="${BKE_LOG_TAIL:-150}"
  if (($#)); then
    compose logs --tail="$tail" "$@"
  else
    compose logs --tail="$tail"
  fi
}

cmd_restart() {
  require_base_tools
  require_env
  compose restart app scheduler backup-worker caddy
  compose ps
}

cmd_stop() {
  require_base_tools
  require_env
  compose down
}

cmd_health() {
  require_base_tools
  require_env
  npm run ops:health -- "$(health_url)"
}

cmd_doctor() {
  require_base_tools
  require_env
  printf 'Repository: %s\n' "$ROOT_DIR"
  printf 'Commit: %s\n' "$(git rev-parse HEAD)"
  printf 'Branch: %s\n' "$(git symbolic-ref --quiet --short HEAD || printf detached)"
  printf 'APP_URL: %s\n' "$(health_url)"
  cmd_validate
  cmd_status
}

cmd_disposable() {
  require_base_tools
  local action="$1"
  shift || true
  node "$ROOT_DIR/scripts/v3-disposable-compose.mjs" "$action" "$@"
}

usage() {
  cat <<'EOF'
BKE Digital Solutions V3 operator

Usage:
  ./bke.sh                 Interactive menu
  ./bke.sh setup           Create .env from .env.example (never overwrites)
  ./bke.sh env             Edit .env
  ./bke.sh validate        Validate application + Compose configuration
  ./bke.sh build           Build production images
  ./bke.sh migrate         Run production migrations once
  ./bke.sh start           Start runtime services
  ./bke.sh deploy          Validate + build + migrate + start + health check
  ./bke.sh update          git pull --ff-only main, then deploy
  ./bke.sh status          Show service status
  ./bke.sh logs [service]  Show logs (BKE_LOG_TAIL defaults to 150)
  ./bke.sh restart         Restart runtime services
  ./bke.sh stop            Stop stack without deleting volumes
  ./bke.sh health          Run live/readiness verification
  ./bke.sh doctor              Validate configuration and show status
  ./bke.sh disposable-up       Build/start disposable LAN certification and run doctor
  ./bke.sh disposable-doctor   Verify TLS, readiness dependencies, and Agent session start
  ./bke.sh disposable-status   Show disposable service status
  ./bke.sh disposable-logs     Show disposable logs
  ./bke.sh disposable-smoke    Run disposable DB smoke check
  ./bke.sh disposable-down     Stop disposable stack without deleting volumes
  ./bke.sh disposable-reset    Remove disposable containers and volumes
  ./bke.sh help                Show this help

The canonical production/runtime environment file is always .env.
Disposable LAN certification materializes ignored .env.certification from .bke-disposable.
EOF
}

menu() {
  while true; do
    cat <<'EOF'

BKE DIGITAL SOLUTIONS V3
1) Setup .env
2) Edit .env
3) Validate
4) Deploy
5) Update + Deploy
6) Status
7) Logs
8) Restart
9) Stop
10) Build
11) Migrate
12) Health
13) Doctor
14) Disposable Up + Doctor
15) Disposable Doctor
16) Disposable Status
17) Disposable Logs
18) Disposable Down
19) Disposable Reset
0) Exit
EOF
    printf '> '
    read -r choice
    case "$choice" in
      1) cmd_setup ;;
      2) cmd_env ;;
      3) cmd_validate ;;
      4) cmd_deploy ;;
      5) cmd_update ;;
      6) cmd_status ;;
      7) cmd_logs ;;
      8) cmd_restart ;;
      9) cmd_stop ;;
      10) cmd_build ;;
      11) cmd_migrate ;;
      12) cmd_health ;;
      13) cmd_doctor ;;
      14) cmd_disposable up ;;
      15) cmd_disposable doctor ;;
      16) cmd_disposable status ;;
      17) cmd_disposable logs ;;
      18) cmd_disposable down ;;
      19) cmd_disposable reset ;;
      0) exit 0 ;;
      *) printf 'Unknown selection.\n' >&2 ;;
    esac
  done
}

command="${1:-}"
if [[ -z "$command" ]]; then
  if [[ -t 0 && -t 1 ]]; then
    menu
  else
    usage
  fi
  exit 0
fi
shift

case "$command" in
  setup) cmd_setup "$@" ;;
  env|edit-env) cmd_env "$@" ;;
  validate) cmd_validate "$@" ;;
  build) cmd_build "$@" ;;
  migrate) cmd_migrate "$@" ;;
  start) cmd_start "$@" ;;
  deploy) cmd_deploy "$@" ;;
  update) cmd_update "$@" ;;
  status) cmd_status "$@" ;;
  logs) cmd_logs "$@" ;;
  restart) cmd_restart "$@" ;;
  stop|down) cmd_stop "$@" ;;
  health) cmd_health "$@" ;;
  doctor) cmd_doctor "$@" ;;
  disposable-up) cmd_disposable up "$@" ;;
  disposable-refresh) cmd_disposable refresh "$@" ;;
  disposable-doctor) cmd_disposable doctor "$@" ;;
  disposable-status) cmd_disposable status "$@" ;;
  disposable-logs) cmd_disposable logs "$@" ;;
  disposable-smoke) cmd_disposable smoke "$@" ;;
  disposable-down) cmd_disposable down "$@" ;;
  disposable-reset) cmd_disposable reset "$@" ;;
  help|-h|--help) usage ;;
  *) usage; die "Unknown command: $command" ;;
esac
