# Логи и резервные копии NetroxBot

В версии 0.4.0 NetroxBot ведёт два уровня истории:

1. **Discord-логи** — красивые embed-сообщения в выбранных каналах.
2. **ServerEvent / AuditLog** — внутренняя история в PostgreSQL.

Внутренняя история не зависит от того, настроен ли Discord-канал логов. Если внешний лог выключен или сообщение в Discord удалено, важное событие всё равно остаётся в базе.

## Что логируется

NetroxBot отслеживает:

- удаление и изменение сообщений;
- вход и выход участников;
- изменение ника и ролей участника;
- вход, выход и перемещение в голосовых каналах;
- создание, удаление и изменение каналов;
- создание, удаление и изменение ролей;
- создание и удаление приглашений;
- изменения webhook;
- ban и unban;
- moderation-кейсы, их отмену и автоматическое завершение;
- изменения настроек NetroxBot и административного доступа.

Для сообщений можно отдельно отключить хранение текста, оставив сам факт события.

## Настройка каналов логов

В `/settings → Логи и аудит` или в веб-панели можно назначить:

- общий fallback-канал;
- отдельный канал сообщений;
- отдельный канал участников;
- отдельный канал голосовых событий;
- отдельный канал структуры сервера;
- отдельный канал модерации;
- отдельный канал изменений настроек.

Также категории можно включать и выключать отдельно.

## Logs & Backups Center

В веб-панели есть центр логов и резервных копий. Он показывает:

- последние ServerEvent;
- фильтрацию по категории;
- поиск по типу события и ID;
- список созданных backup;
- размер архива;
- SHA-256;
- статус копии;
- дату последней исправной копии.

## Автоматические backup

В production backup-сервис запускается автоматически.

По умолчанию:

```env
BACKUP_INTERVAL_SECONDS=86400
BACKUP_RETENTION_DAYS=14
BACKUP_STORAGE=backup_data
```

То есть база копируется раз в сутки, а старые архивы удаляются через 14 дней.

Если нужно хранить архивы в обычной папке на диске, можно указать, например:

```env
BACKUP_STORAGE=./backups
```

Для домашнего ПК лучше хранить эту папку ещё и на другом физическом диске или в отдельном резервном хранилище.

## Backup вручную

Для dev-сборки:

```bash
docker compose --profile backup run --rm backup sh /scripts/backup-database.sh once
```

Для production:

```bash
docker compose -f docker-compose.prod.yml run --rm backup sh /scripts/backup-database.sh once
```

Каждый архив создаётся в формате PostgreSQL custom dump, затем проверяется через `pg_restore --list` и получает SHA-256.

Только после успешной проверки копия получает статус `VALID`.

## Восстановление

Восстановление намеренно не запускается кнопкой из панели. Это опасная операция, которая полностью заменяет текущую базу.

Сначала останови сервисы, которые работают с БД.

### Dev

```bash
docker compose stop api bot dashboard backup
docker compose up -d postgres
```

Запусти восстановление:

```bash
docker compose --profile backup run --rm --no-deps \
  -e CONFIRM_RESTORE=YES \
  backup sh /scripts/restore-latest-backup.sh
```

После завершения:

```bash
docker compose up -d
```

### Production

```bash
docker compose -f docker-compose.prod.yml stop api bot dashboard backup
docker compose -f docker-compose.prod.yml up -d postgres
```

Затем:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -e CONFIRM_RESTORE=YES \
  backup sh /scripts/restore-latest-backup.sh
```

После успешного восстановления:

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Как выбирается копия

Если `BACKUP_FILE` не указан, NetroxBot проверяет архивы от самого свежего к старым.

Для каждого файла проверяются:

1. наличие `.sha256`;
2. совпадение SHA-256;
3. корректность архива через `pg_restore --list`.

Повреждённая копия пропускается. Восстановление начинается только с первой исправной копии.

Можно явно выбрать архив:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -e CONFIRM_RESTORE=YES \
  -e BACKUP_FILE=netroxbot-20260924T200000Z.dump \
  backup sh /scripts/restore-latest-backup.sh
```

Если указанная копия повреждена, восстановление не начнётся.

## Важное

Не удаляй backup-хранилище вместе с Docker volumes, если копии ещё нужны.

Команда вида:

```bash
docker compose down -v
```

удаляет named volumes и может уничтожить локальные backup, если используется `BACKUP_STORAGE=backup_data`.
