#!/bin/sh
set -e

if [ -z "$BACKUP_DIR" ]; then BACKUP_DIR=/backups; fi
if [ -z "$POSTGRES_HOST" ]; then POSTGRES_HOST=postgres; fi
if [ -z "$POSTGRES_PORT" ]; then POSTGRES_PORT=5432; fi

export PGHOST="$POSTGRES_HOST"
export PGPORT="$POSTGRES_PORT"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGDATABASE="$POSTGRES_DB"

if [ "$CONFIRM_RESTORE" != "YES" ]; then
  echo "[NetroxBot Restore] Восстановление отменено."
  echo "Запусти с CONFIRM_RESTORE=YES после остановки api, bot и dashboard."
  exit 2
fi

if [ -d "$BACKUP_DIR/.backup-lock" ]; then
  echo "[NetroxBot Restore] Сейчас выполняется backup. Повтори позже."
  exit 1
fi

if ! mkdir "$BACKUP_DIR/.restore-lock" 2>/dev/null; then
  echo "[NetroxBot Restore] Другое восстановление уже выполняется."
  exit 1
fi

trap 'rm -rf "$BACKUP_DIR/.restore-lock"' EXIT INT TERM

is_valid_backup() {
  candidate="$1"
  checksum_file="$candidate.sha256"

  if [ ! -f "$candidate" ] || [ ! -f "$checksum_file" ]; then
    return 1
  fi

  expected_checksum="$(awk '{print $1}' "$checksum_file")"
  actual_checksum="$(sha256sum "$candidate" | awk '{print $1}')"

  if [ -z "$expected_checksum" ] || [ "$expected_checksum" != "$actual_checksum" ]; then
    return 1
  fi

  if ! pg_restore --list "$candidate" >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

file=""

if [ -n "$BACKUP_FILE" ]; then
  requested="$BACKUP_DIR/$BACKUP_FILE"

  if ! is_valid_backup "$requested"; then
    echo "[NetroxBot Restore] Указанная копия отсутствует или не прошла проверку."
    exit 1
  fi

  file="$requested"
else
  for candidate in $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'netroxbot-*.dump' | sort -r); do
    if is_valid_backup "$candidate"; then
      file="$candidate"
      break
    fi

    echo "[NetroxBot Restore] Пропускаю повреждённую копию: $(basename "$candidate")."
  done
fi

if [ -z "$file" ]; then
  echo "[NetroxBot Restore] Ни одной исправной копии не найдено."
  exit 1
fi

checksum_file="$file.sha256"
expected="$(awk '{print $1}' "$checksum_file")"
actual="$(sha256sum "$file" | awk '{print $1}')"

echo "[NetroxBot Restore] Выбрана последняя исправная копия: $(basename "$file")."
echo "[NetroxBot Restore] Восстанавливаю базу..."

psql --dbname=postgres -v ON_ERROR_STOP=1 \
  -v db_name="$POSTGRES_DB" \
  <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'db_name'
  AND pid <> pg_backend_pid();
SQL

dropdb --if-exists "$POSTGRES_DB"
createdb "$POSTGRES_DB"

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname="$POSTGRES_DB" \
  "$file"

restored_file_name="$(basename "$file")"
restored_size="$(stat -c '%s' "$file")"
restore_id="restore_$(date -u +%Y%m%dT%H%M%SZ)"

psql -v ON_ERROR_STOP=1 \
  -v restore_id="$restore_id" \
  -v file_name="$restored_file_name" \
  -v checksum="$actual" \
  -v size_bytes="$restored_size" \
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
  :'restore_id',
  :'file_name',
  'RESTORED',
  :'size_bytes'::bigint,
  :'checksum',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("fileName")
DO UPDATE SET
  "status" = 'RESTORED',
  "sizeBytes" = EXCLUDED."sizeBytes",
  "checksum" = EXCLUDED."checksum",
  "completedAt" = CURRENT_TIMESTAMP,
  "error" = NULL;
SQL

echo "[NetroxBot Restore] Восстановление завершено."
echo "[NetroxBot Restore] Теперь можно снова запустить api, bot и dashboard."
