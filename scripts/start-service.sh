#!/bin/sh
set -eu

SERVICE="${1:-}"

if [ -z "$SERVICE" ]; then
  echo "[NetroxBot] Не указано имя сервиса."
  exit 1
fi

echo "[NetroxBot] Применяю миграции базы..."
pnpm db:deploy

echo "[NetroxBot] Проверяю базовую конфигурацию сервера..."
pnpm db:bootstrap

echo "[NetroxBot] Запускаю $SERVICE..."
exec pnpm --filter "$SERVICE" start
