# Установка NetroxBot

Эта инструкция рассчитана на запуск NetroxBot через Docker. Такой вариант одинаково подходит для домашнего ПК и будущего VPS.

## 1. Что понадобится

- Git;
- Docker Desktop на Windows или Docker Engine + Compose на Linux;
- Discord-приложение с ботом;
- доступ к репозиторию NetroxBot.

## 2. Подготовка

Клонируй репозиторий и перейди в папку проекта:

```bash
git clone https://github.com/Onmaynec/netroxbot.git
cd netroxbot
```

Для стабильной установки используй `main`.

Создай рабочий файл настроек:

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**Linux**

```bash
cp .env.example .env
```

После этого открой `.env` и заполни как минимум:

- `DISCORD_TOKEN`;
- `DISCORD_CLIENT_ID`;
- `DISCORD_GUILD_ID`;
- `SUPERADMIN_DISCORD_ID`;
- пароли PostgreSQL и Lavalink;
- длинный случайный `SESSION_SECRET`.

OAuth-параметры понадобятся для веб-панели.

## 3. Обычный запуск

Для сборки из исходников:

```bash
docker compose up -d --build
```

При старте NetroxBot сам:

1. ждёт готовности PostgreSQL и Redis;
2. применяет миграции базы;
3. создаёт базовую конфигурацию сервера;
4. назначает владельца из `SUPERADMIN_DISCORD_ID`;
5. запускает API;
6. после готовности API запускает бот и веб-панель.

Проверить контейнеры:

```bash
docker compose ps
```

Посмотреть логи:

```bash
docker compose logs -f
```

Остановить:

```bash
docker compose down
```

Данные PostgreSQL и Redis лежат в Docker volumes и не удаляются обычной командой `docker compose down`.

## 4. Production и автообновление

После появления первого стабильного релиза можно использовать готовые образы из GitHub Container Registry:

```bash
docker compose -f docker-compose.prod.yml up -d
```

По умолчанию используется тег `latest`. Сервис обновления периодически проверяет новые production-образы и перезапускает только контейнеры NetroxBot, для которых вышла новая версия.

Интервал задаётся в `.env`:

```env
UPDATE_INTERVAL_SECONDS=300
```

Если нужно закрепиться на конкретной версии, укажи тег образов:

```env
NETROXBOT_IMAGE_TAG=v0.1.0
```

В таком режиме автоматический переход на следующий релиз не произойдёт, пока тег не будет изменён вручную.

## 5. Локальный AI

Ollama не запускается по умолчанию. Когда AI-модуль будет готов, его можно будет включить отдельным профилем:

```bash
docker compose --profile ai up -d
```

Модель задаётся через `OLLAMA_MODEL`.

## 6. После перезагрузки

Основные контейнеры используют `restart: unless-stopped`. Если Docker запускается вместе с системой, NetroxBot поднимется автоматически.

На Windows для этого должен быть включён автозапуск Docker Desktop. На VPS Docker обычно запускается как системная служба.
