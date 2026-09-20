#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

ENV_INPUT=".env"
COMPOSE_INPUT="docker-compose.production.yml"
HEALTH_URL="${BKE_HEALTH_URL:-}"

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

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$ROOT_DIR" "$1" ;;
  esac
}

ENV_FILE="$(resolve_path "$ENV_INPUT")"
COMPOSE_FILE="$(resolve_path "$COMPOSE_INPUT")"

[[ -f "$ENV_FILE" ]] || { echo "Missing production environment file: $ENV_INPUT" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "Missing production Compose file: $COMPOSE_INPUT" >&2; exit 1; }
if [[ -z "$HEALTH_URL" ]]; then
  HEALTH_URL="$(read_env_value APP_URL)"
fi
[[ -n "$HEALTH_URL" ]] || { echo "APP_URL is missing from .env and BKE_HEALTH_URL is not set." >&2; exit 1; }
[[ "$HEALTH_URL" =~ ^https:// ]] || { echo "Production health URL must use https://." >&2; exit 1; }

if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Refusing deployment: working tree is dirty." >&2
  exit 1
fi

BRANCH="$(git symbolic-ref --quiet --short HEAD || printf '%s' 'detached')"
DEPLOY_SHA="$(git rev-parse HEAD)"
printf 'Deploying branch %s at %s\n' "$BRANCH" "$DEPLOY_SHA"

echo "Running read-only production preflight..."
DEPLOYMENT_ENV_FILE="$ENV_FILE" DEPLOYMENT_COMPOSE_FILE="$COMPOSE_FILE" npm run ops:validate

echo "Validating production Compose configuration..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

echo "Building production application services..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build app scheduler backup-worker migrate

echo "Running production database migrations..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile operations run --rm migrate

echo "Starting production runtime services..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d app scheduler backup-worker caddy

echo "Production service status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "Running deterministic production health verification..."
npm run ops:health -- "$HEALTH_URL"

printf 'Production deployment completed at Git SHA %s\n' "$DEPLOY_SHA"
