#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# != 1 || "$1" == *:latest || "$1" != *:* ]]; then
  printf 'Usage: beta-rollback.sh PREVIOUS_IMMUTABLE_IMAGE_TAG\n' >&2
  exit 1
fi
export RELEASE_IMAGE="$1"
export BETA_ENV_FILE="${BETA_ENV_FILE:-.env.beta}"
compose=(docker compose --env-file "$BETA_ENV_FILE" -f compose.beta.yaml)
docker image inspect "$RELEASE_IMAGE" > /dev/null
# Refuse application rollback if the old build has pending schema requirements.
"${compose[@]}" run --rm --no-deps migrate node apps/api/dist/database/cli.js status
# Never restart the migration job or downgrade the database during app rollback.
"${compose[@]}" up -d --no-deps --wait api worker web proxy
