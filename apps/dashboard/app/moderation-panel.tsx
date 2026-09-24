
"use client";

import { useEffect, useMemo, useState } from "react";

type ModerationCase = {
  id: string;
  caseNumber: number;
  targetUserId: string | null;
  targetChannelId: string | null;
  moderatorId: string;
  type: string;
  status: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
};

type Appeal = {
  id: string;
  userId: string;
  text: string;
  status: string;
  createdAt: string;
  case: ModerationCase;
};

type AutomodEvent = {
  id: string;
  userId: string;
  channelId: string;
  ruleKey: string;
  action: string;
  createdAt: string;
};

type Props = {
  apiUrl: string;
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

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    WARN: "Warn",
    TIMEOUT: "Timeout",
    MUTE: "Mute",
    KICK: "Kick",
    BAN: "Ban",
    TEMP_BAN: "Temp Ban",
    UNWARN: "Unwarn",
    CLEAR: "Clear",
    SLOWMODE: "Slowmode",
    LOCK: "Lock",
    UNLOCK: "Unlock"
  };

  return labels[type] ?? type;
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Активно";
  if (status === "CANCELLED") return "Отменено";
  return "Завершено";
}

export default function ModerationPanel({ apiUrl }: Props) {
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [automod, setAutomod] = useState<AutomodEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [casesResponse, appealsResponse, automodResponse] =
        await Promise.all([
          apiFetch<{ ok: true; cases: ModerationCase[] }>(
            apiUrl,
            "/api/v1/moderation/cases?take=50"
          ),
          apiFetch<{ ok: true; appeals: Appeal[] }>(
            apiUrl,
            "/api/v1/moderation/appeals"
          ),
          apiFetch<{ ok: true; events: AutomodEvent[] }>(
            apiUrl,
            "/api/v1/moderation/automod?take=50"
          )
        ]);

      setCases(casesResponse.cases);
      setAppeals(appealsResponse.appeals);
      setAutomod(automodResponse.events);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить Moderation Center."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiUrl]);

  const overview = useMemo(() => {
    return {
      activeCases: cases.filter((item) => item.status === "ACTIVE").length,
      warnings: cases.filter((item) => item.type === "WARN").length,
      pendingAppeals: appeals.length,
      automodEvents: automod.length
    };
  }, [cases, appeals, automod]);

  if (loading) {
    return (
      <section className="panel">
        <p className="empty">Загружаю Moderation Center…</p>
      </section>
    );
  }

  return (
    <div className="moderationCenter">
      {error && <div className="notice errorNotice">{error}</div>}

      <section className="metricGrid">
        <article className="metricCard">
          <span>Активные кейсы</span>
          <strong>{overview.activeCases}</strong>
        </article>
        <article className="metricCard">
          <span>Warn в последних 50</span>
          <strong>{overview.warnings}</strong>
        </article>
        <article className="metricCard">
          <span>Апелляции</span>
          <strong>{overview.pendingAppeals}</strong>
        </article>
        <article className="metricCard">
          <span>Автомод, последние 50</span>
          <strong>{overview.automodEvents}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Последние moderation-кейсы</h2>
            <p>
              Единая история warn, timeout, mute, kick, ban и канальных
              действий.
            </p>
          </div>
          <button className="ghostButton" onClick={() => void load()} type="button">
            Обновить
          </button>
        </div>

        <div className="moderationList">
          {cases.length === 0 ? (
            <p className="empty">Кейсов пока нет.</p>
          ) : (
            cases.map((item) => (
              <div className="moderationRow" key={item.id}>
                <div className="caseNumber">#{item.caseNumber}</div>
                <div className="moderationMain">
                  <div className="moderationTitle">
                    <strong>{typeLabel(item.type)}</strong>
                    <span className={"caseStatus " + item.status.toLowerCase()}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p>{item.reason}</p>
                  <small>
                    {item.targetUserId
                      ? "Пользователь: " + item.targetUserId
                      : item.targetChannelId
                        ? "Канал: " + item.targetChannelId
                        : "Без цели"}
                    {" • "}
                    Модератор: {item.moderatorId}
                  </small>
                </div>
                <time>{new Date(item.createdAt).toLocaleString("ru-RU")}</time>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="moderationColumns">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Апелляции</h2>
              <p>Рассмотрение выполняется через Discord командой /appeals.</p>
            </div>
          </div>

          <div className="moderationList compactList">
            {appeals.length === 0 ? (
              <p className="empty">Ожидающих апелляций нет.</p>
            ) : (
              appeals.map((appeal) => (
                <div className="appealRow" key={appeal.id}>
                  <strong>Кейс #{appeal.case.caseNumber}</strong>
                  <span>{appeal.userId}</span>
                  <p>{appeal.text}</p>
                  <small>ID: {appeal.id}</small>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Автомод</h2>
              <p>Последние срабатывания фильтров NetroxBot.</p>
            </div>
          </div>

          <div className="moderationList compactList">
            {automod.length === 0 ? (
              <p className="empty">Срабатываний пока нет.</p>
            ) : (
              automod.map((event) => (
                <div className="automodRow" key={event.id}>
                  <div>
                    <strong>{event.ruleKey}</strong>
                    <span>{event.action}</span>
                  </div>
                  <p>
                    {event.userId} → {event.channelId}
                  </p>
                  <time>{new Date(event.createdAt).toLocaleString("ru-RU")}</time>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
