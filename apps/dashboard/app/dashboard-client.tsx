"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SessionUser = {
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  level: "SUPERADMIN" | "ADMIN";
};

type SettingsCategory = {
  key: string;
  title: string;
  description: string;
  emoji: string;
};

type ModuleEntry = {
  key: string;
  category: string;
  title: string;
  description: string;
  emoji: string;
  defaultEnabled: boolean;
  enabled: boolean;
  settings: Record<string, unknown>;
};

type AdminEntry = {
  discordId: string;
  level: "SUPERADMIN" | "ADMIN";
  addedBy: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type AuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
};

type DashboardProps = {
  apiUrl: string;
};

async function apiFetch<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export default function DashboardClient({ apiUrl }: DashboardProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [categories, setCategories] = useState<SettingsCategory[]>([]);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("security");
  const [newAdminId, setNewAdminId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const me = await apiFetch<{ ok: true; user: SessionUser }>(
        apiUrl,
        "/api/v1/auth/me"
      );
      setUser(me.user);

      const settings = await apiFetch<{
        ok: true;
        categories: SettingsCategory[];
        modules: ModuleEntry[];
      }>(apiUrl, "/api/v1/settings");

      setCategories(settings.categories);
      setModules(settings.modules);

      const auditResponse = await apiFetch<{
        ok: true;
        entries: AuditEntry[];
      }>(apiUrl, "/api/v1/audit");
      setAudit(auditResponse.entries);

      if (me.user.level === "SUPERADMIN") {
        const adminResponse = await apiFetch<{
          ok: true;
          admins: AdminEntry[];
        }>(apiUrl, "/api/v1/admins");
        setAdmins(adminResponse.admins);
      }
    } catch {
      setUser(null);
      setCategories([]);
      setModules([]);
      setAdmins([]);
      setAudit([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const activeModules = useMemo(
    () => modules.filter((module) => module.category === activeCategory),
    [modules, activeCategory]
  );

  async function toggleModule(module: ModuleEntry) {
    setMessage(null);

    try {
      const response = await apiFetch<{
        ok: true;
        module: ModuleEntry;
      }>(apiUrl, `/api/v1/settings/modules/${module.key}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !module.enabled })
      });

      setModules((current) =>
        current.map((entry) =>
          entry.key === module.key ? { ...entry, ...response.module } : entry
        )
      );
      setMessage(
        `${module.title}: ${response.module.enabled ? "включён" : "выключен"}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройку.");
    }
  }

  async function addAdmin() {
    const discordId = newAdminId.trim();

    if (!discordId) {
      return;
    }

    setMessage(null);

    try {
      await apiFetch(apiUrl, "/api/v1/admins", {
        method: "POST",
        body: JSON.stringify({ discordId })
      });

      setNewAdminId("");
      const response = await apiFetch<{ ok: true; admins: AdminEntry[] }>(
        apiUrl,
        "/api/v1/admins"
      );
      setAdmins(response.admins);
      setMessage(`Доступ для ${discordId} выдан.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выдать доступ.");
    }
  }

  async function revokeAdmin(discordId: string) {
    setMessage(null);

    try {
      await apiFetch(apiUrl, `/api/v1/admins/${discordId}`, {
        method: "DELETE"
      });

      setAdmins((current) =>
        current.map((admin) =>
          admin.discordId === discordId
            ? { ...admin, revokedAt: new Date().toISOString() }
            : admin
        )
      );
      setMessage(`Доступ для ${discordId} отозван.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отозвать доступ.");
    }
  }

  async function logout() {
    await apiFetch(apiUrl, "/api/v1/auth/logout", {
      method: "POST"
    }).catch(() => undefined);

    setUser(null);
    setModules([]);
    setCategories([]);
    setAdmins([]);
    setAudit([]);
  }

  if (loading) {
    return (
      <main className="centerScreen">
        <div className="loadingMark" />
        <p>Подключаюсь к NetroxBot…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="loginShell">
        <section className="loginCard">
          <div className="brandMark">N</div>
          <p className="eyebrow">Mothers Fantastic</p>
          <h1>NetroxBot</h1>
          <p className="lead">
            Панель управления сервером. Вход доступен только владельцу и
            администраторам, добавленным в NetroxBot.
          </p>
          <a className="primaryButton" href={`${apiUrl}/auth/discord`}>
            Войти через Discord
          </a>
          <p className="hint">
            Авторизация идёт через официальный Discord OAuth. Пароль Discord
            NetroxBot не получает.
          </p>
        </section>
      </main>
    );
  }

  const displayName = user.globalName ?? user.username;

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark small">N</div>
          <div>
            <strong>NetroxBot</strong>
            <span>Mothers Fantastic</span>
          </div>
        </div>

        <nav className="navList">
          {categories.map((category) => (
            <button
              className={activeCategory === category.key ? "navItem active" : "navItem"}
              key={category.key}
              onClick={() => setActiveCategory(category.key)}
              type="button"
            >
              <span>{category.emoji}</span>
              <div>
                <strong>{category.title}</strong>
                <small>{category.description}</small>
              </div>
            </button>
          ))}

          {user.level === "SUPERADMIN" && (
            <button
              className={activeCategory === "admins" ? "navItem active" : "navItem"}
              onClick={() => setActiveCategory("admins")}
              type="button"
            >
              <span>🔐</span>
              <div>
                <strong>Доступ к панели</strong>
                <small>Администраторы по Discord ID</small>
              </div>
            </button>
          )}

          <button
            className={activeCategory === "audit" ? "navItem active" : "navItem"}
            onClick={() => setActiveCategory("audit")}
            type="button"
          >
            <span>🧾</span>
            <div>
              <strong>Журнал действий</strong>
              <small>Последние изменения настроек</small>
            </div>
          </button>
        </nav>

        <div className="account">
          <div>
            <strong>{displayName}</strong>
            <span>{user.level === "SUPERADMIN" ? "Владелец" : "Администратор"}</span>
          </div>
          <button type="button" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Панель управления</p>
            <h1>
              {activeCategory === "admins"
                ? "Доступ к панели"
                : activeCategory === "audit"
                  ? "Журнал действий"
                  : categories.find((category) => category.key === activeCategory)?.title ??
                    "Настройки"}
            </h1>
          </div>
          <div className="onlinePill">
            <span className="dot" />
            API подключён
          </div>
        </header>

        {message && <div className="notice">{message}</div>}

        {activeCategory === "admins" && user.level === "SUPERADMIN" ? (
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Администраторы NetroxBot</h2>
                <p>
                  Добавляй людей по Discord ID. Отозванный доступ можно вернуть,
                  повторно добавив тот же ID.
                </p>
              </div>
            </div>

            <div className="adminAdd">
              <input
                value={newAdminId}
                onChange={(event) => setNewAdminId(event.target.value)}
                placeholder="Discord ID"
                inputMode="numeric"
              />
              <button className="primaryButton compact" onClick={() => void addAdmin()} type="button">
                Добавить
              </button>
            </div>

            <div className="adminList">
              {admins.map((admin) => (
                <div className="adminRow" key={admin.discordId}>
                  <div>
                    <strong>{admin.discordId}</strong>
                    <span>
                      {admin.level === "SUPERADMIN" ? "Владелец" : "Администратор"}
                      {admin.revokedAt ? " • доступ отозван" : ""}
                    </span>
                  </div>
                  {admin.level !== "SUPERADMIN" && !admin.revokedAt && (
                    <button
                      className="dangerButton"
                      onClick={() => void revokeAdmin(admin.discordId)}
                      type="button"
                    >
                      Отозвать
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : activeCategory === "audit" ? (
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Последние действия</h2>
                <p>Показываются последние 100 записей внутреннего аудита.</p>
              </div>
              <button className="ghostButton" onClick={() => void loadDashboard()} type="button">
                Обновить
              </button>
            </div>

            <div className="auditList">
              {audit.length === 0 ? (
                <p className="empty">Записей пока нет.</p>
              ) : (
                audit.map((entry) => (
                  <div className="auditRow" key={entry.id}>
                    <div>
                      <strong>{entry.action}</strong>
                      <span>
                        {entry.actorId ?? "система"} → {entry.targetId ?? entry.targetType ?? "—"}
                      </span>
                    </div>
                    <time>{new Date(entry.createdAt).toLocaleString("ru-RU")}</time>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="moduleGrid">
            {activeModules.map((module) => (
              <article className="moduleCard" key={module.key}>
                <div className="moduleTop">
                  <div className="moduleIcon">{module.emoji}</div>
                  <label className="switch">
                    <input
                      checked={module.enabled}
                      onChange={() => void toggleModule(module)}
                      type="checkbox"
                    />
                    <span />
                  </label>
                </div>
                <h2>{module.title}</h2>
                <p>{module.description}</p>
                <div className={module.enabled ? "state enabled" : "state"}>
                  {module.enabled ? "Включён" : "Выключен"}
                </div>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
