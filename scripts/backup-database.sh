#!/bin/sh
set -e

MODE=loop
if [ "$#" -gt 0 ]; then
  MODE="$1"
fi

if [ -z "$BACKUP_DIR" ]; then BACKUP_DIR=/backups; fi
if [ -z "$BACKUP_INTERVAL_SECONDS" ]; then BACKUP_INTERVAL_SECONDS=86400; fi
if [ -z "$BACKUP_RETENTION_DAYS" ]; then BACKUP_RETENTION_DAYS=14; fi
if [ -z "$POSTGRES_HOST" ]; then POSTGRES_HOST=postgres; fi
if [ -z "$POSTGRES_PORT" ]; then POSTGRES_PORT=5432; fi

export PGHOST="$POSTGRES_HOST"
export PGPORT="$POSTGRES_PORT"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGDATABASE="$POSTGRES_DB"

mkdir -p "$BACKUP_DIR"

record_success() {
  psql -v ON_ERROR_STOP=1 \
    -v backup_id="$1" \
    -v file_name="$2" \
    -v checksum="$3" \
    -v size_bytes="$4" \
    <<'SQL'
INSERT INTO "BackupRecord" (
  "id",
  "fileName",
  "status",
  "sizeBytes",
  "checksum",
  "startedAt",
  "completedAt"
)
VALUES (
  :'backup_id',
  :'file_name',
  'VALID',
  :'size_bytes'::bigint,
  :'checksum',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("fileName")
DO UPDATE SET
  "status" = 'VALID',
  "sizeBytes" = EXCLUDED."sizeBytes",
  "checksum" = EXCLUDED."checksum",
  "completedAt" = CURRENT_TIMESTAMP,
  "error" = NULL;
SQL
}

record_failure() {
  psql -v ON_ERROR_STOP=1 \
    -v backup_id="$1" \
    -v file_name="$2" \
    <<'SQL' || true
INSERT INTO "BackupRecord" (
  "id",
  "fileName",
  "status",
  "error",
  "startedAt",
  "completedAt"
)
VALUES (
  :'backup_id',
  :'file_name',
  'FAILED',
  'pg_dump_or_validation_failed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("fileName")
DO UPDATE SET
  "status" = 'FAILED',
  "completedAt" = CURRENT_TIMESTAMP,
  "error" = 'pg_dump_or_validation_failed';
SQL
}

run_backup() {
  if [ -d "$BACKUP_DIR/.restore-lock" ]; then
    echo "[NetroxBot Backup] Восстановление активно, backup пропущен."
    return 0
  fi

  if ! mkdir "$BACKUP_DIR/.backup-lock" 2>/dev/null; then
    echo "[NetroxBot Backup] Другой backup уже выполняется."
    return 0
  fi

  trap 'rm -rf "$BACKUP_DIR/.backup-lock"' EXIT INT TERM

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_id="backup_$timestamp"
  file_name="netroxbot-$timestamp.dump"
  temp_file="$BACKUP_DIR/.$file_name.tmp"
  final_file="$BACKUP_DIR/$file_name"
  checksum_file="$final_file.sha256"

  echo "[NetroxBot Backup] Создаю $file_name..."
  if ! pg_dump \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --file="$temp_file"
  then
    rm -f "$temp_file"
    record_failure "$backup_id" "$file_name"
    rm -rf "$BACKUP_DIR/.backup-lock"
    trap - EXIT INT TERM
    return 1
  fi

  if ! pg_restore --list "$temp_file" >/dev/null 2>&1; then
    echo "[NetroxBot Backup] Проверка архива не пройдена."
    rm -f "$temp_file"
    record_failure "$backup_id" "$file_name"
    rm -rf "$BACKUP_DIR/.backup-lock"
    trap - EXIT INT TERM
    return 1
  fi

  mv "$temp_file" "$final_file"

  checksum="$(sha256sum "$final_file" | awk '{print $1}')"
  size_bytes="$(stat -c '%s' "$final_file")"
  printf '%s  %s\n' "$checksum" "$file_name" > "$checksum_file"

  record_success "$backup_id" "$file_name" "$checksum" "$size_bytes"

  find "$BACKUP_DIR" \
    -type f \
    \( -name 'netroxbot-*.dump' -o -name 'netroxbot-*.dump.sha256' \) \
    -mtime "+$BACKUP_RETENTION_DAYS" \
    -delete

  echo "[NetroxBot Backup] Готово: $file_name ($size_bytes байт)."

  rm -rf "$BACKUP_DIR/.backup-lock"
  trap - EXIT INT TERM
}

if [ "$MODE" = "once" ]; then
  run_backup
  exit "$?"
fi

if [ "$MODE" != "loop" ]; then
  echo "Использование: $0 [once|loop]"
  exit 2
fi

while true; do
  run_backup || true
  sleep "$BACKUP_INTERVAL_SECONDS"
done
