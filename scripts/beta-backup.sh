#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .backups
file=".backups/moodboard-$(date -u +%Y%m%dT%H%M%SZ).dump"
# A failed dump must never masquerade as a recoverable backup.
trap 'rm -f "$file.partial"' EXIT
docker compose --env-file "${BETA_ENV_FILE:-.env.beta}" -f compose.beta.yaml exec -T postgres pg_dump -U moodboard -d moodboard -Fc > "$file.partial"
test -s "$file.partial"
mv "$file.partial" "$file"
printf 'Backup saved to %s. Encrypt and copy it off-host; retain matching media.\n' "$file"
