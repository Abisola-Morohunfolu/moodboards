#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export BETA_ENV_FILE="${BETA_ENV_FILE:-.env.beta}"
compose=(docker compose --env-file "$BETA_ENV_FILE" -f compose.beta.yaml)
# This command accepts backward-compatible migrations only; see the runbook.
"${compose[@]}" config --quiet
"${compose[@]}" build api
"${compose[@]}" up -d --wait postgres redis
if "${compose[@]}" exec -T postgres psql -U moodboard -d moodboard -Atc "select to_regclass('public.users') is not null" | grep -qx t; then
  bash scripts/beta-backup.sh
fi
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" up -d --wait api worker web proxy
