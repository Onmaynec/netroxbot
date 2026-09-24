"use client";

import { useEffect, useMemo, useState } from "react";

type ServerEvent = {
  id: string;
  category: string;
  eventType: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  channelId: string | null;
  messageId: string | null;
  summary: string;
  payload: unknown;
  occurredAt: string;
};

type BackupRecord = {
  id: string;
  fileName: string;
  status: string;
  sizeBytes: string | null;
  checksum: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

type Props = {
  apiUrl: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  messages: "Сообщения",
  members: "Участники",
  voice: "Голосовые",
  server: "Сервер",
  moderation: "Модерация",
  settings: "Настройки"
};

async function apiFetch<T>(apiUrl: string, path: string): Promise<T> {
  const response = await fetch(apiUrl + path, {
    credentials: "include"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "Не удалось загрузить данные.");
  }

  return response.json() as Promise<T>;
}

function formatBytes(raw: string | null) {
  if (!raw) {
    return "—";
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return raw + " B";
  }

  if (value >= 1024 ** 3) {
    return (value / 1024 ** 3).toFixed(2) + " GB";
  }

  if (value >= 1024 ** 2) {
    return (value / 1024 ** 2).toFixed(2) + " MB";
  }

  if (value >= 1024) {
    return (value / 1024).toFixed(1) + " KB";
  }

  return value + " B";
}

function compactId(value: string | null) {
  if (!value) {
    return "—";
  }

  if (value.length <= 20) {
    return value;
  }

  return value.slice(0, 10) + "…" + value.slice(-6);
}

export default function EventsPanel({ apiUrl }: Props) {
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [eventsResponse, backupsResponse] = await Promise.all([
        apiFetch<{ ok: true; events: ServerEvent[] }>(
          apiUrl,
          "/api/v1/events?take=250"
        ),
        apiFetch<{ ok: true; backups: BackupRecord[] }>(
          apiUrl,
          "/api/v1/backups?take=30"
        )
      ]);

      setEvents(eventsResponse.events);
      setBackups(backupsResponse.backups);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить журнал."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiUrl]);

  const categories = useMemo(
    () =>
      Array.from(new Set(events.map((event) => event.category))).sort(),
    [events]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return events.filter((event) => {
      if (category !== "all" && event.category !== category) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return [
        event.eventType,
        event.summary,
        event.actorId,
        event.targetId,
        event.channelId
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [events, category, query]);

  const lastGoodBackup = backups.find((backup) =>
    ["VALID", "RESTORED"].includes(backup.status)
  );

  if (loading) {
    return (
      <section className="panel">
        <p className="empty">Загружаю журнал событий…</p>
      </section>
    );
  }

  return (
    <div className="eventsCenter">
      {error && <div className="notice errorNotice">{error}</div>}

      <section className="metricGrid">
        <article className="metricCard">
          <span>События в выборке</span>
          <strong>{events.length}</strong>
        </article>
        <article className="metricCard">
          <span>Категории</span>
          <strong>{categories.length}</strong>
        </article>
        <article className="metricCard">
          <span>Backup-записи</span>
          <strong>{backups.length}</strong>
        </article>
        <article className="metricCard">
          <span>Последняя исправная копия</span>
          <strong className="metricSmall">
            {lastGoodBackup
              ? new Date(
                  lastGoodBackup.completedAt ??
                    lastGoodBackup.startedAt
                ).toLocaleDateString("ru-RU")
              : "Нет"}
          </strong>
        </article>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>ServerEvent</h2>
            <p>
              История хранится в PostgreSQL независимо от сообщений в
              Discord-логах.
            </p>
          </div>
          <button
            className="ghostButton"
            onClick={() => void load()}
            type="button"
          >
            Обновить
          </button>
        </div>

        <div className="eventFilters">
          <select
            className="fieldInput"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">Все категории</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {CATEGORY_LABELS[item] ?? item}
              </option>
            ))}
          </select>

          <input
            className="fieldInput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по типу, ID или описанию"
          />
        </div>

        <div className="eventList">
          {filtered.length === 0 ? (
            <p className="empty">Подходящих событий нет.</p>
          ) : (
            filtered.map((event) => (
              <article className="eventRow" key={event.id}>
                <div className="eventMeta">
                  <span className="eventCategory">
                    {CATEGORY_LABELS[event.category] ?? event.category}
                  </span>
                  <strong>{event.eventType}</strong>
                </div>

                <div className="eventBody">
                  <p>{event.summary}</p>
                  <small>
                    actor {compactId(event.actorId)}
                    {" • "}
                    target {compactId(event.targetId)}
                    {" • "}
                    channel {compactId(event.channelId)}
                  </small>
                </div>

                <time>
                  {new Date(event.occurredAt).toLocaleString("ru-RU")}
                </time>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Резервные копии PostgreSQL</h2>
            <p>
              VALID — архив создан и проверен; RESTORED — из него выполнялось
              успешное восстановление.
            </p>
          </div>
        </div>

        <div className="backupList">
          {backups.length === 0 ? (
            <p className="empty">
              Записей пока нет. В production первая копия создаётся backup-сервисом.
            </p>
          ) : (
            backups.map((backup) => (
              <article className="backupRow" key={backup.id}>
                <div>
                  <strong>{backup.fileName}</strong>
                  <span>
                    {formatBytes(backup.sizeBytes)}
                    {" • "}
                    {backup.checksum
                      ? "SHA-256 " + compactId(backup.checksum)
                      : "checksum —"}
                  </span>
                </div>

                <span
                  className={
                    "backupStatus " + backup.status.toLowerCase()
                  }
                >
                  {backup.status}
                </span>

                <time>
                  {new Date(
                    backup.completedAt ?? backup.startedAt
                  ).toLocaleString("ru-RU")}
                </time>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
