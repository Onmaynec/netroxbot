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

type SettingValue = string | number | boolean | null;

type SettingOption = {
  label: string;
  value: string;
};

type SettingField = {
  key: string;
  label: string;
  description: string;
  kind: "boolean" | "number" | "text" | "channel" | "role" | "select";
  defaultValue?: SettingValue;
  min?: number;
  max?: number;
  options?: SettingOption[];
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
  fields: SettingField[];
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

type DiscordResources = {
  channels: Array<{
    id: string;
    name: string;
    type: number;
    parentId: string | null;
  }>;
  roles: Array<{
    id: string;
    name: string;
    color: number;
    managed: boolean;
  }>;
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

function settingValue(value: unknown, fallback: SettingValue): SettingValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return fallback;
}

export default function DashboardClient({ apiUrl }: DashboardProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [categories, setCategories] = useState<SettingsCategory[]>([]);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [resources, setResources] = useState<DiscordResources | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("security");
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<Record<string, SettingValue>>({});
  const [newAdminId, setNewAdminId] = useState("");
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
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

  const selectedModule = useMemo(
    () => modules.find((module) => module.key === selectedModuleKey) ?? null,
    [modules, selectedModuleKey]
  );

  async function loadDiscordResources() {
    if (resources) {
      return resources;
    }

    const response = await apiFetch<DiscordResources & { ok: true }>(
      apiUrl,
      "/api/v1/discord/resources"
    );

    const nextResources = {
      channels: response.channels,
      roles: response.roles
    };

    setResources(nextResources);
    return nextResources;
  }

  async function openModuleSettings(module: ModuleEntry) {
    setMessage(null);
    setSelectedModuleKey(module.key);

    const draft: Record<string, SettingValue> = {};

    for (const field of module.fields) {
      draft[field.key] = settingValue(
        module.settings[field.key],
        field.defaultValue ?? null
      );
    }

    setDraftSettings(draft);

    if (module.fields.some((field) => field.kind === "channel" || field.kind === "role")) {
      try {
        await loadDiscordResources();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить каналы и роли Discord."
        );
      }
    }
  }

  function changeSetting(key: string, value: SettingValue) {
    setDraftSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function saveModuleSettings() {
    if (!selectedModule) {
      return;
    }

    setSavingSettings(true);
    setMessage(null);

    try {
      const response = await apiFetch<{
        ok: true;
        module: ModuleEntry;
      }>(apiUrl, `/api/v1/settings/modules/${selectedModule.key}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: draftSettings
        })
      });

      setModules((current) =>
        current.map((entry) =>
          entry.key === selectedModule.key
            ? { ...entry, ...response.module }
            : entry
        )
      );
      setMessage(`Параметры «${selectedModule.title}» сохранены.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить параметры."
      );
    } finally {
      setSavingSettings(false);
    }
  }

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
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить настройку."
      );
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
      setMessage(
        error instanceof Error ? error.message : "Не удалось выдать доступ."
      );
    }
  }

  async function requestRevokeAdmin(discordId: string) {
    if (pendingRevokeId !== discordId) {
      setPendingRevokeId(discordId);
      setMessage("Нажми «Подтвердить отзыв», чтобы выполнить действие.");
      return;
    }

    setMessage(null);

    try {
      await apiFetch(apiUrl, `/api/v1/admins/${discordId}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: true })
      });

      setAdmins((current) =>
        current.map((admin) =>
          admin.discordId === discordId
            ? { ...admin, revokedAt: new Date().toISOString() }
            : admin
        )
      );
      setPendingRevokeId(null);
      setMessage(`Доступ для ${discordId} отозван.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось отозвать доступ."
      );
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
    setResources(null);
  }

  function selectCategory(categoryKey: string) {
    setActiveCategory(categoryKey);
    setSelectedModuleKey(null);
    setMessage(null);
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
              onClick={() => selectCategory(category.key)}
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
              onClick={() => selectCategory("admins")}
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
            onClick={() => selectCategory("audit")}
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
              {selectedModule
                ? `${selectedModule.emoji} ${selectedModule.title}`
                : activeCategory === "admins"
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
              <button
                className="primaryButton compact"
                onClick={() => void addAdmin()}
                type="button"
              >
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
                      className={
                        pendingRevokeId === admin.discordId
                          ? "dangerButton confirm"
                          : "dangerButton"
                      }
                      onClick={() => void requestRevokeAdmin(admin.discordId)}
                      type="button"
                    >
                      {pendingRevokeId === admin.discordId
                        ? "Подтвердить отзыв"
                        : "Отозвать"}
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
              <button
                className="ghostButton"
                onClick={() => void loadDashboard()}
                type="button"
              >
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
                        {entry.actorId ?? "система"} →{" "}
                        {entry.targetId ?? entry.targetType ?? "—"}
                      </span>
                    </div>
                    <time>{new Date(entry.createdAt).toLocaleString("ru-RU")}</time>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : selectedModule ? (
          <section className="panel settingsEditor">
            <div className="panelHeader">
              <div>
                <h2>Параметры модуля</h2>
                <p>{selectedModule.description}</p>
              </div>
              <button
                className="ghostButton"
                onClick={() => setSelectedModuleKey(null)}
                type="button"
              >
                Назад
              </button>
            </div>

            <div className="editorFields">
              {selectedModule.fields.length === 0 ? (
                <p className="empty">У этого модуля пока нет дополнительных параметров.</p>
              ) : (
                selectedModule.fields.map((field) => {
                  const value = draftSettings[field.key] ?? field.defaultValue ?? null;

                  return (
                    <label className="editorField" key={field.key}>
                      <div>
                        <strong>{field.label}</strong>
                        <span>{field.description}</span>
                      </div>

                      {field.kind === "boolean" ? (
                        <label className="switch">
                          <input
                            checked={Boolean(value)}
                            onChange={(event) =>
                              changeSetting(field.key, event.target.checked)
                            }
                            type="checkbox"
                          />
                          <span />
                        </label>
                      ) : field.kind === "number" ? (
                        <input
                          className="fieldInput"
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={typeof value === "number" ? value : ""}
                          onChange={(event) =>
                            changeSetting(
                              field.key,
                              event.target.value === ""
                                ? null
                                : Number(event.target.value)
                            )
                          }
                        />
                      ) : field.kind === "select" ? (
                        <select
                          className="fieldInput"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) =>
                            changeSetting(field.key, event.target.value)
                          }
                        >
                          <option value="">Не выбрано</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : field.kind === "channel" ? (
                        <select
                          className="fieldInput"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) =>
                            changeSetting(
                              field.key,
                              event.target.value || null
                            )
                          }
                        >
                          <option value="">Не выбрано</option>
                          {(resources?.channels ?? []).map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              # {channel.name}
                            </option>
                          ))}
                        </select>
                      ) : field.kind === "role" ? (
                        <select
                          className="fieldInput"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) =>
                            changeSetting(
                              field.key,
                              event.target.value || null
                            )
                          }
                        >
                          <option value="">Не выбрано</option>
                          {(resources?.roles ?? []).map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="fieldInput"
                          type="text"
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) =>
                            changeSetting(field.key, event.target.value)
                          }
                        />
                      )}
                    </label>
                  );
                })
              )}
            </div>

            <div className="editorActions">
              <button
                className="primaryButton"
                disabled={savingSettings}
                onClick={() => void saveModuleSettings()}
                type="button"
              >
                {savingSettings ? "Сохраняю…" : "Сохранить изменения"}
              </button>
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
                <div className="moduleFooter">
                  <div className={module.enabled ? "state enabled" : "state"}>
                    {module.enabled ? "Включён" : "Выключен"}
                  </div>
                  <button
                    className="ghostButton"
                    onClick={() => void openModuleSettings(module)}
                    type="button"
                  >
                    Настроить
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
