#!/bin/sh
set -eu

SERVICE="${1:-}"

if [ -z "$SERVICE" ]; then
  echo "[NetroxBot] Не указано имя сервиса."
  exit 1
fi

echo "[NetroxBot] Применяю миграции базы..."
pnpm db:deploy

if [ -n "${DISCORD_GUILD_ID:-}" ] && [ -n "${SUPERADMIN_DISCORD_ID:-}" ]; then
  echo "[NetroxBot] Проверяю базовую конфигурацию сервера..."
  if ! pnpm db:bootstrap; then
    echo "[NetroxBot] ВНИМАНИЕ: bootstrap не выполнен. Сервис продолжит запуск; проверь DISCORD_GUILD_ID, SUPERADMIN_DISCORD_ID и состояние базы."
  fi
else
  echo "[NetroxBot] Bootstrap пропущен: DISCORD_GUILD_ID или SUPERADMIN_DISCORD_ID ещё не настроены."
fi

echo "[NetroxBot] Запускаю $SERVICE..."
exec pnpm --filter "$SERVICE" start
