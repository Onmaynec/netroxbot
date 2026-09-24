"use client";

import { useCallback, useEffect, useState } from "react";

type EconomyPanelProps = {
  apiUrl: string;
};

type Overview = {
  accounts: number;
  walletSupply: string;
  bankSupply: string;
  totalSupply: string;
  lifetimeEarned: string;
  lifetimeSpent: string;
  treasury: {
    balance: string;
    minted: string;
    burned: string;
    collectedFees: string;
  };
  activeLoans: number;
  overdueLoans: number;
  shopItems: number;
  activeSeason: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string | null;
    resetBalances: boolean;
  } | null;
};

type EconomyItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  rarity: string;
  itemType: string;
  imageUrl: string | null;
  roleId: string | null;
  price: string;
  stock: number | null;
  maxPerUser: number | null;
  tradable: boolean;
  giftable: boolean;
  active: boolean;
};

type EconomyLoan = {
  id: string;
  userId: string;
  principal: string;
  balance: string;
  interestBps: number;
  status: string;
  dueAt: string;
  createdAt: string;
};

type EconomySeason = {
  id: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  resetBalances: boolean;
};

type EconomyTransaction = {
  id: string;
  userId: string;
  counterpartyUserId: string | null;
  amount: string;
  walletDelta: string;
  bankDelta: string;
  type: string;
  createdAt: string;
};

type NewItemForm = {
  sku: string;
  name: string;
  price: string;
  rarity: string;
  itemType: string;
  description: string;
  imageUrl: string;
  roleId: string;
  stock: string;
  maxPerUser: string;
  tradable: boolean;
  giftable: boolean;
};

const EMPTY_ITEM: NewItemForm = {
  sku: "",
  name: "",
  price: "0",
  rarity: "COMMON",
  itemType: "COLLECTIBLE",
  description: "",
  imageUrl: "",
  roleId: "",
  stock: "",
  maxPerUser: "",
  tradable: true,
  giftable: true
};

async function apiFetch<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "HTTP " + response.status);
  }

  return response.json() as Promise<T>;
}

function nec(value: string) {
  try {
    return "🪙 " + BigInt(value).toLocaleString("ru-RU") + " NEC";
  } catch {
    return "🪙 0 NEC";
  }
}

function percentFromBps(value: number) {
  return (value / 100).toLocaleString("ru-RU", {
    maximumFractionDigits: 2
  }) + "%";
}

function date(value: string) {
  return new Date(value).toLocaleString("ru-RU");
}

export default function EconomyPanel({ apiUrl }: EconomyPanelProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [items, setItems] = useState<EconomyItem[]>([]);
  const [loans, setLoans] = useState<EconomyLoan[]>([]);
  const [seasons, setSeasons] = useState<EconomySeason[]>([]);
  const [transactions, setTransactions] = useState<EconomyTransaction[]>([]);
  const [form, setForm] = useState<NewItemForm>(EMPTY_ITEM);
  const [seasonName, setSeasonName] = useState("");
  const [seasonReset, setSeasonReset] = useState(false);
  const [tab, setTab] = useState<"overview" | "shop" | "loans" | "seasons">("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const [overviewData, itemData, loanData, seasonData, transactionData] =
        await Promise.all([
          apiFetch<{ ok: true; overview: Overview }>(
            apiUrl,
            "/api/v1/economy/overview"
          ),
          apiFetch<{ ok: true; items: EconomyItem[] }>(
            apiUrl,
            "/api/v1/economy/items"
          ),
          apiFetch<{ ok: true; loans: EconomyLoan[] }>(
            apiUrl,
            "/api/v1/economy/loans"
          ),
          apiFetch<{ ok: true; seasons: EconomySeason[] }>(
            apiUrl,
            "/api/v1/economy/seasons"
          ),
          apiFetch<{ ok: true; transactions: EconomyTransaction[] }>(
            apiUrl,
            "/api/v1/economy/transactions?take=30"
          )
        ]);

      setOverview(overviewData.overview);
      setItems(itemData.items);
      setLoans(loanData.loans);
      setSeasons(seasonData.seasons);
      setTransactions(transactionData.transactions);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить Economy Center."
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createItem() {
    setMessage(null);

    try {
      await apiFetch(apiUrl, "/api/v1/economy/items", {
        method: "POST",
        body: JSON.stringify({
          sku: form.sku.trim(),
          name: form.name.trim(),
          price: form.price.trim() || "0",
          rarity: form.rarity,
          itemType: form.itemType,
          description: form.description.trim() || null,
          imageUrl: form.imageUrl.trim() || null,
          roleId: form.roleId.trim() || null,
          stock: form.stock.trim() ? Number(form.stock) : null,
          maxPerUser: form.maxPerUser.trim()
            ? Number(form.maxPerUser)
            : null,
          tradable: form.tradable,
          giftable: form.giftable
        })
      });

      setForm(EMPTY_ITEM);
      setMessage("Предмет добавлен в магазин.");
      await load();
      setTab("shop");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось создать предмет."
      );
    }
  }

  async function toggleItem(item: EconomyItem) {
    setMessage(null);

    try {
      await apiFetch(apiUrl, "/api/v1/economy/items/" + item.id, {
        method: "PATCH",
        body: JSON.stringify({
          active: !item.active
        })
      });

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, active: !entry.active }
            : entry
        )
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось изменить предмет."
      );
    }
  }

  async function createSeason() {
    const name = seasonName.trim();

    if (!name) {
      setMessage("Укажи название сезона.");
      return;
    }

    setMessage(null);

    try {
      await apiFetch(apiUrl, "/api/v1/economy/seasons", {
        method: "POST",
        body: JSON.stringify({
          name,
          resetBalances: seasonReset
        })
      });

      setSeasonName("");
      setSeasonReset(false);
      setMessage("Сезон создан. Он пока не активирован.");
      await load();
      setTab("seasons");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось создать сезон."
      );
    }
  }

  async function activateSeason(season: EconomySeason) {
    const confirmed = window.confirm(
      season.resetBalances
        ? "Этот сезон настроен со сбросом кошельков и банков. Активировать?"
        : "Активировать сезон «" + season.name + "»?"
    );

    if (!confirmed) return;

    setMessage(null);

    try {
      await apiFetch(
        apiUrl,
        "/api/v1/economy/seasons/" + season.id + "/activate",
        { method: "POST" }
      );

      setMessage("Сезон активирован.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось активировать сезон."
      );
    }
  }

  if (loading && !overview) {
    return (
      <section className="panel">
        <p className="empty">Загружаю Economy Center…</p>
      </section>
    );
  }

  return (
    <section className="economyCenter">
      <div className="centerTabs">
        <button
          className={tab === "overview" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("overview")}
          type="button"
        >
          Обзор
        </button>
        <button
          className={tab === "shop" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("shop")}
          type="button"
        >
          Магазин
        </button>
        <button
          className={tab === "loans" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("loans")}
          type="button"
        >
          Кредиты
        </button>
        <button
          className={tab === "seasons" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("seasons")}
          type="button"
        >
          Сезоны
        </button>
        <button className="ghostButton" onClick={() => void load()} type="button">
          Обновить
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      {tab === "overview" && overview && (
        <>
          <div className="economyStats">
            <article className="moduleCard economyStat">
              <span>Денежная масса</span>
              <strong>{nec(overview.totalSupply)}</strong>
              <small>
                кошельки {nec(overview.walletSupply)} • банки {nec(overview.bankSupply)}
              </small>
            </article>
            <article className="moduleCard economyStat">
              <span>Казна</span>
              <strong>{nec(overview.treasury.balance)}</strong>
              <small>комиссии {nec(overview.treasury.collectedFees)}</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Выпущено / сожжено</span>
              <strong>{nec(overview.treasury.minted)}</strong>
              <small>сожжено {nec(overview.treasury.burned)}</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Аккаунты</span>
              <strong>{overview.accounts.toLocaleString("ru-RU")}</strong>
              <small>активных кредитов {overview.activeLoans}</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Магазин</span>
              <strong>{overview.shopItems}</strong>
              <small>активных позиций</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Сезон</span>
              <strong>{overview.activeSeason?.name ?? "Нет активного"}</strong>
              <small>
                {overview.activeSeason
                  ? "с " + date(overview.activeSeason.startsAt)
                  : "создай сезон во вкладке «Сезоны»"}
              </small>
            </article>
          </div>

          <section className="panel economyBlock">
            <div className="panelHeader">
              <div>
                <h2>Последние транзакции</h2>
                <p>Ledger хранит изменения кошелька и банка отдельно.</p>
              </div>
            </div>

            <div className="auditList">
              {transactions.length === 0 ? (
                <p className="empty">Транзакций пока нет.</p>
              ) : (
                transactions.map((entry) => (
                  <div className="auditRow" key={entry.id}>
                    <div>
                      <strong>{entry.type}</strong>
                      <span>
                        {entry.userId}
                        {entry.counterpartyUserId
                          ? " ↔ " + entry.counterpartyUserId
                          : ""}
                      </span>
                    </div>
                    <div className="economyTransactionAmount">
                      <strong>{nec(entry.amount)}</strong>
                      <time>{date(entry.createdAt)}</time>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {tab === "shop" && (
        <div className="economyColumns">
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Добавить предмет</h2>
                <p>Каждая покупка создаёт отдельный экземпляр с серийным номером.</p>
              </div>
            </div>

            <div className="economyForm">
              <input
                className="fieldInput"
                placeholder="SKU, например neon_cat"
                value={form.sku}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sku: event.target.value }))
                }
              />
              <input
                className="fieldInput"
                placeholder="Название"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <input
                className="fieldInput"
                placeholder="Цена NEC"
                inputMode="numeric"
                value={form.price}
                onChange={(event) =>
                  setForm((current) => ({ ...current, price: event.target.value }))
                }
              />
              <select
                className="fieldInput"
                value={form.rarity}
                onChange={(event) =>
                  setForm((current) => ({ ...current, rarity: event.target.value }))
                }
              >
                <option value="COMMON">Обычная</option>
                <option value="UNCOMMON">Необычная</option>
                <option value="RARE">Редкая</option>
                <option value="EPIC">Эпическая</option>
                <option value="LEGENDARY">Легендарная</option>
                <option value="MYTHIC">Мифическая</option>
                <option value="UNIQUE">Уникальная</option>
              </select>
              <select
                className="fieldInput"
                value={form.itemType}
                onChange={(event) =>
                  setForm((current) => ({ ...current, itemType: event.target.value }))
                }
              >
                <option value="COLLECTIBLE">Коллекционный</option>
                <option value="COSMETIC">Косметика</option>
                <option value="ROLE">Роль</option>
                <option value="BADGE">Значок</option>
                <option value="OTHER">Другое</option>
              </select>
              <input
                className="fieldInput"
                placeholder="Discord Role ID для типа ROLE"
                value={form.roleId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, roleId: event.target.value }))
                }
              />
              <input
                className="fieldInput"
                placeholder="HTTPS-ссылка на картинку"
                value={form.imageUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, imageUrl: event.target.value }))
                }
              />
              <input
                className="fieldInput"
                placeholder="Остаток, пусто = без лимита"
                inputMode="numeric"
                value={form.stock}
                onChange={(event) =>
                  setForm((current) => ({ ...current, stock: event.target.value }))
                }
              />
              <input
                className="fieldInput"
                placeholder="Лимит на пользователя"
                inputMode="numeric"
                value={form.maxPerUser}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    maxPerUser: event.target.value
                  }))
                }
              />
              <textarea
                className="fieldInput economyTextarea"
                placeholder="Описание"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value
                  }))
                }
              />
              <label className="economyCheck">
                <input
                  type="checkbox"
                  checked={form.tradable}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      tradable: event.target.checked
                    }))
                  }
                />
                Можно будет продавать на маркетплейсе
              </label>
              <label className="economyCheck">
                <input
                  type="checkbox"
                  checked={form.giftable}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      giftable: event.target.checked
                    }))
                  }
                />
                Можно дарить
              </label>
              <button
                className="primaryButton"
                onClick={() => void createItem()}
                type="button"
              >
                Создать предмет
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Позиции магазина</h2>
                <p>Неактивные предметы остаются в базе и инвентарях.</p>
              </div>
            </div>

            <div className="economyItemList">
              {items.length === 0 ? (
                <p className="empty">Предметов пока нет.</p>
              ) : (
                items.map((item) => (
                  <div className="economyItemRow" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.rarity} • {nec(item.price)} • SKU {item.sku}
                      </span>
                    </div>
                    <button
                      className={item.active ? "dangerButton" : "ghostButton"}
                      onClick={() => void toggleItem(item)}
                      type="button"
                    >
                      {item.active ? "Снять" : "Вернуть"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "loans" && (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Кредиты</h2>
              <p>Последние 100 кредитных договоров.</p>
            </div>
          </div>

          <div className="auditList">
            {loans.length === 0 ? (
              <p className="empty">Кредитов пока нет.</p>
            ) : (
              loans.map((loan) => (
                <div className="auditRow" key={loan.id}>
                  <div>
                    <strong>{loan.userId}</strong>
                    <span>
                      {loan.status} • ставка {percentFromBps(loan.interestBps)}
                    </span>
                  </div>
                  <div className="economyTransactionAmount">
                    <strong>{nec(loan.balance)}</strong>
                    <time>до {date(loan.dueAt)}</time>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "seasons" && (
        <div className="economyColumns">
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Новый сезон</h2>
                <p>
                  Сброс балансов — опасное действие. История транзакций при этом
                  не удаляется.
                </p>
              </div>
            </div>

            <div className="economyForm">
              <input
                className="fieldInput"
                placeholder="Название сезона"
                value={seasonName}
                onChange={(event) => setSeasonName(event.target.value)}
              />
              <label className="economyCheck dangerCheck">
                <input
                  type="checkbox"
                  checked={seasonReset}
                  onChange={(event) => setSeasonReset(event.target.checked)}
                />
                Сбросить кошельки и банки при активации
              </label>
              <button
                className="primaryButton"
                onClick={() => void createSeason()}
                type="button"
              >
                Создать сезон
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Сезоны экономики</h2>
                <p>Одновременно активен только один сезон.</p>
              </div>
            </div>

            <div className="economyItemList">
              {seasons.length === 0 ? (
                <p className="empty">Сезонов пока нет.</p>
              ) : (
                seasons.map((season) => (
                  <div className="economyItemRow" key={season.id}>
                    <div>
                      <strong>{season.name}</strong>
                      <span>
                        {season.status} • с {date(season.startsAt)}
                        {season.resetBalances ? " • со сбросом балансов" : ""}
                      </span>
                    </div>
                    {season.status !== "ACTIVE" && (
                      <button
                        className={
                          season.resetBalances
                            ? "dangerButton"
                            : "ghostButton"
                        }
                        onClick={() => void activateSeason(season)}
                        type="button"
                      >
                        Активировать
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
