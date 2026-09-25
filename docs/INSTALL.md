# Установка NetroxBot

NetroxBot рассчитан на запуск через Docker. Один и тот же способ подходит для домашнего ПК и будущего VPS.

## 1. Что понадобится

- Git;
- Docker Desktop на Windows или Docker Engine + Compose на Linux;
- Discord-приложение с ботом;
- доступ к репозиторию NetroxBot.

## 2. Подготовка Discord-приложения

В Discord Developer Portal открой приложение NetroxBot.

На странице **Bot** включи Privileged Gateway Intents:

- Server Members Intent;
- Presence Intent;
- Message Content Intent.

Токен бота понадобится для `DISCORD_TOKEN`. Не публикуй его и не добавляй в GitHub.

Для веб-панели используется обычный Discord OAuth. В разделе OAuth2 добавь Redirect URI, который полностью совпадает с `DISCORD_OAUTH_REDIRECT_URI`.

Для локального запуска:

```text
http://localhost:3001/auth/discord/callback
```

Если позже панель переедет на домен, замени адрес и в Discord Developer Portal, и в `.env`.

## 3. Подготовка проекта

Клонируй репозиторий и перейди в папку проекта:

```bash
git clone https://github.com/Onmaynec/netroxbot.git
cd netroxbot
```

Для стабильной установки используй `main`.

Создай рабочий файл настроек.

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**Linux**

```bash
cp .env.example .env
```

Заполни `.env`:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
SUPERADMIN_DISCORD_ID=

PUBLIC_APP_URL=http://localhost:3000
PUBLIC_API_URL=http://localhost:3001
API_URL=http://localhost:3001

DISCORD_OAUTH_CLIENT_ID=
DISCORD_OAUTH_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT_URI=http://localhost:3001/auth/discord/callback
SESSION_SECRET=
```

Что здесь важно:

- `DISCORD_GUILD_ID` — ID сервера Mothers Fantastic;
- `SUPERADMIN_DISCORD_ID` — Discord ID владельца NetroxBot;
- `DISCORD_OAUTH_CLIENT_ID` и `DISCORD_OAUTH_CLIENT_SECRET` берутся из того же Discord-приложения; если они пока не заполнены, API и бот всё равно запустятся, но вход в веб-панель через Discord будет временно отключён;
- `SESSION_SECRET` должен быть длинной случайной строкой, минимум 32 символа; если оставить его пустым, NetroxBot создаст безопасный временный ключ на текущий запуск, поэтому после перезапуска веб-сессии сбросятся;
- `PUBLIC_APP_URL` — адрес веб-панели, который открывается в браузере;
- `PUBLIC_API_URL` — адрес API, доступный браузеру пользователя;
- пароли PostgreSQL и Lavalink в `.env.example` обязательно замени перед постоянным запуском.

## 4. Первый запуск

Для сборки из исходников:

```bash
docker compose up -d --build
```

При старте NetroxBot сам:

1. ждёт готовности PostgreSQL и Redis;
2. применяет миграции базы;
3. создаёт конфигурацию Mothers Fantastic;
4. назначает владельца из `SUPERADMIN_DISCORD_ID`;
5. создаёт настройки всех известных модулей;
6. запускает API;
7. после готовности API запускает Discord-бота и веб-панель.

После запуска:

- веб-панель: `http://localhost:3000`;
- API: `http://localhost:3001`;
- проверка готовности API: `http://localhost:3001/ready`.

В панель можно войти только через Discord-аккаунт, который уже есть в списке администраторов NetroxBot. Первый SuperAdmin создаётся автоматически из `SUPERADMIN_DISCORD_ID`. Остальных администраторов владелец добавляет через панель по Discord ID.

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

## 5. Production и автообновление

После выхода стабильного релиза можно использовать готовые образы из GitHub Container Registry:

```bash
docker compose -f docker-compose.prod.yml up -d
```

По умолчанию используется тег `latest`. Сервис обновления проверяет новые production-образы и перезапускает только контейнеры NetroxBot, для которых вышла новая версия.

Интервал проверки задаётся в `.env`:

```env
UPDATE_INTERVAL_SECONDS=300
```

Если нужно остаться на конкретной версии:

```env
NETROXBOT_IMAGE_TAG=v0.1.0
```

В этом режиме переход на следующую версию не произойдёт, пока тег не будет изменён вручную.

## 6. Локальный AI

Ollama не запускается по умолчанию. AI-модуль можно будет включать отдельным профилем:

```bash
docker compose --profile ai up -d
```

Модель задаётся через `OLLAMA_MODEL`. Сам AI-модуль будет добавлен отдельной версией; наличие Ollama сейчас не требуется для обычной работы NetroxBot.

## 7. Автозапуск после перезагрузки

Основные контейнеры используют `restart: unless-stopped`.

На Windows включи автозапуск Docker Desktop. На VPS Docker обычно запускается как системная служба, поэтому после перезагрузки машины NetroxBot поднимется автоматически.
