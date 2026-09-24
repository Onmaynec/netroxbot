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

if [ -n "$BACKUP_FILE" ]; then
  file="$BACKUP_DIR/$BACKUP_FILE"
else
  file="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'netroxbot-*.dump' | sort -r | head -n 1)"
fi

if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "[NetroxBot Restore] Исправная копия не найдена."
  exit 1
fi

checksum_file="$file.sha256"

if [ ! -f "$checksum_file" ]; then
  echo "[NetroxBot Restore] Нет SHA-256 для $(basename "$file")."
  exit 1
fi

expected="$(awk '{print $1}' "$checksum_file")"
actual="$(sha256sum "$file" | awk '{print $1}')"

if [ "$expected" != "$actual" ]; then
  echo "[NetroxBot Restore] SHA-256 не совпадает. Восстановление остановлено."
  exit 1
fi

if ! pg_restore --list "$file" >/dev/null 2>&1; then
  echo "[NetroxBot Restore] Архив повреждён или не является pg_dump custom archive."
  exit 1
fi

echo "[NetroxBot Restore] Восстанавливаю $(basename "$file")..."

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

echo "[NetroxBot Restore] Восстановление завершено."
echo "[NetroxBot Restore] Теперь можно снова запустить api, bot и dashboard."
