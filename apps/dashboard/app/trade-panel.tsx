"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TradePanelProps = {
  apiUrl: string;
  canRunDangerous: boolean;
};

type Overview = {
  activeListings: number;
  activeAuctions: number;
  activeGames: number;
  activeLotteries: number;
  heldEscrows: number;
  heldNec: string;
};

type Listing = {
  id: string;
  sellerId: string;
  buyerId: string | null;
  itemInstanceId: string;
  price: string;
  feeBps: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

type Bid = {
  id: string;
  bidderId: string;
  amount: string;
  createdAt: string;
};

type Auction = {
  id: string;
  source: string;
  sellerId: string | null;
  itemInstanceId: string | null;
  itemDefinitionId: string | null;
  startPrice: string;
  minIncrement: string;
  buyoutPrice: string | null;
  currentBid: string | null;
  currentBidderId: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  bids: Bid[];
};

type Game = {
  id: string;
  gameType: string;
  hostId: string;
  opponentId: string | null;
  status: string;
  stake: string;
  pot: string;
  winnerId: string | null;
  createdAt: string;
  expiresAt: string | null;
};

type Lottery = {
  id: string;
  title: string;
  status: string;
  ticketPrice: string;
  pot: string;
  winnerId: string | null;
  startsAt: string;
  endsAt: string;
};

type Escrow = {
  id: string;
  kind: string;
  referenceId: string;
  userId: string;
  amount: string;
  status: string;
  createdAt: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
  price: string;
  rarity: string;
  active: boolean;
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
    const error = await response.json().catch(() => null);
    throw new Error(
      error?.message ?? "HTTP " + response.status
    );
  }

  return response.json() as Promise<T>;
}

function nec(value: string | bigint) {
  const amount =
    typeof value === "bigint" ? value : BigInt(value || "0");

  return "🪙 " + amount.toLocaleString("ru-RU") + " NEC";
}

function date(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}

export default function TradePanel({
  apiUrl,
  canRunDangerous
}: TradePanelProps) {
  const [tab, setTab] = useState<
    "overview" | "market" | "auctions" | "games" | "lotteries" | "escrow"
  >("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [lotteries, setLotteries] = useState<Lottery[]>([]);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [auctionForm, setAuctionForm] = useState({
    itemDefinitionId: "",
    startPrice: "100",
    minIncrement: "10",
    buyoutPrice: "",
    hours: "12"
  });
  const [lotteryForm, setLotteryForm] = useState({
    title: "",
    ticketPrice: "10",
    maxTickets: "",
    maxTicketsPerUser: "100",
    feePercent: "5",
    hours: "24"
  });

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const [
        overviewResponse,
        marketplaceResponse,
        auctionsResponse,
        gamesResponse,
        lotteriesResponse,
        escrowResponse,
        itemsResponse
      ] = await Promise.all([
        apiFetch<{ ok: true; overview: Overview }>(
          apiUrl,
          "/api/v1/trade/overview"
        ),
        apiFetch<{ ok: true; listings: Listing[] }>(
          apiUrl,
          "/api/v1/trade/marketplace?take=100"
        ),
        apiFetch<{ ok: true; auctions: Auction[] }>(
          apiUrl,
          "/api/v1/trade/auctions?take=100"
        ),
        apiFetch<{ ok: true; games: Game[] }>(
          apiUrl,
          "/api/v1/trade/games?take=100"
        ),
        apiFetch<{ ok: true; lotteries: Lottery[] }>(
          apiUrl,
          "/api/v1/trade/lotteries?take=100"
        ),
        apiFetch<{ ok: true; escrow: Escrow[] }>(
          apiUrl,
          "/api/v1/trade/escrow?take=100"
        ),
        apiFetch<{ ok: true; items: Item[] }>(
          apiUrl,
          "/api/v1/economy/items"
        )
      ]);

      setOverview(overviewResponse.overview);
      setListings(marketplaceResponse.listings);
      setAuctions(auctionsResponse.auctions);
      setGames(gamesResponse.games);
      setLotteries(lotteriesResponse.lotteries);
      setEscrows(escrowResponse.escrow);
      setItems(itemsResponse.items);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить Trade Center."
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeItems = useMemo(
    () => items.filter((item) => item.active),
    [items]
  );

  async function createServerAuction() {
    setMessage(null);

    try {
      const hours = Math.max(
        1,
        Number(auctionForm.hours) || 1
      );
      const endsAt = new Date(
        Date.now() + hours * 60 * 60 * 1000
      );

      await apiFetch(apiUrl, "/api/v1/trade/auctions/server", {
        method: "POST",
        body: JSON.stringify({
          itemDefinitionId: auctionForm.itemDefinitionId,
          startPrice: auctionForm.startPrice,
          minIncrement: auctionForm.minIncrement,
          buyoutPrice:
            auctionForm.buyoutPrice.trim() === ""
              ? null
              : auctionForm.buyoutPrice,
          endsAt: endsAt.toISOString()
        })
      });

      setMessage("Серверный аукцион создан.");
      await load();
      setTab("auctions");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось создать аукцион."
      );
    }
  }

  async function createLottery() {
    setMessage(null);

    try {
      const hours = Math.max(
        1,
        Number(lotteryForm.hours) || 1
      );
      const endsAt = new Date(
        Date.now() + hours * 60 * 60 * 1000
      );

      await apiFetch(apiUrl, "/api/v1/trade/lotteries", {
        method: "POST",
        body: JSON.stringify({
          title: lotteryForm.title,
          ticketPrice: lotteryForm.ticketPrice,
          maxTickets:
            lotteryForm.maxTickets.trim() === ""
              ? null
              : Number(lotteryForm.maxTickets),
          maxTicketsPerUser:
            lotteryForm.maxTicketsPerUser.trim() === ""
              ? null
              : Number(lotteryForm.maxTicketsPerUser),
          feePercent: Number(lotteryForm.feePercent) || 0,
          endsAt: endsAt.toISOString()
        })
      });

      setLotteryForm((current) => ({
        ...current,
        title: ""
      }));
      setMessage("Лотерея создана.");
      await load();
      setTab("lotteries");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось создать лотерею."
      );
    }
  }

  async function forceCancelAuction(id: string) {
    if (!canRunDangerous) return;

    setMessage(null);

    try {
      await apiFetch(
        apiUrl,
        "/api/v1/trade/auctions/" + id + "/cancel",
        {
          method: "POST",
          body: JSON.stringify({ confirm: true })
        }
      );

      setMessage("Аукцион принудительно отменён, escrow возвращён.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось отменить аукцион."
      );
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <p className="empty">Загружаю Trade Center…</p>
      </section>
    );
  }

  return (
    <div className="tradeCenter">
      <div className="centerTabs">
        <button
          className={tab === "overview" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("overview")}
          type="button"
        >
          Обзор
        </button>
        <button
          className={tab === "market" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("market")}
          type="button"
        >
          Маркетплейс
        </button>
        <button
          className={tab === "auctions" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("auctions")}
          type="button"
        >
          Аукционы
        </button>
        <button
          className={tab === "games" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("games")}
          type="button"
        >
          Игры
        </button>
        <button
          className={tab === "lotteries" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("lotteries")}
          type="button"
        >
          Лотереи
        </button>
        <button
          className={tab === "escrow" ? "ghostButton activeTab" : "ghostButton"}
          onClick={() => setTab("escrow")}
          type="button"
        >
          Escrow
        </button>
        <button
          className="ghostButton"
          onClick={() => void load()}
          type="button"
        >
          Обновить
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      {tab === "overview" && overview && (
        <>
          <div className="economyStats">
            <article className="moduleCard economyStat">
              <span>Объявления</span>
              <strong>{overview.activeListings}</strong>
              <small>активных продаж</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Аукционы</span>
              <strong>{overview.activeAuctions}</strong>
              <small>включая scheduled/settling</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Игровые сессии</span>
              <strong>{overview.activeGames}</strong>
              <small>WAITING / ACTIVE / SETTLING</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Лотереи</span>
              <strong>{overview.activeLotteries}</strong>
              <small>текущих раундов</small>
            </article>
            <article className="moduleCard economyStat">
              <span>Escrow</span>
              <strong>{overview.heldEscrows}</strong>
              <small>{nec(overview.heldNec)} удержано</small>
            </article>
          </div>

          <div className="economyColumns">
            <section className="panel">
              <div className="panelHeader">
                <div>
                  <h2>Серверный аукцион</h2>
                  <p>
                    Выбери предмет магазина. Победителю будет создан новый
                    серийный экземпляр.
                  </p>
                </div>
              </div>
              <div className="economyForm">
                <select
                  className="fieldInput"
                  value={auctionForm.itemDefinitionId}
                  onChange={(event) =>
                    setAuctionForm((current) => ({
                      ...current,
                      itemDefinitionId: event.target.value
                    }))
                  }
                >
                  <option value="">Выбрать предмет</option>
                  {activeItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} • {item.rarity} • {nec(item.price)}
                    </option>
                  ))}
                </select>
                <input
                  className="fieldInput"
                  value={auctionForm.startPrice}
                  onChange={(event) =>
                    setAuctionForm((current) => ({
                      ...current,
                      startPrice: event.target.value
                    }))
                  }
                  placeholder="Стартовая цена NEC"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={auctionForm.minIncrement}
                  onChange={(event) =>
                    setAuctionForm((current) => ({
                      ...current,
                      minIncrement: event.target.value
                    }))
                  }
                  placeholder="Минимальный шаг NEC"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={auctionForm.buyoutPrice}
                  onChange={(event) =>
                    setAuctionForm((current) => ({
                      ...current,
                      buyoutPrice: event.target.value
                    }))
                  }
                  placeholder="Выкуп, необязательно"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={auctionForm.hours}
                  onChange={(event) =>
                    setAuctionForm((current) => ({
                      ...current,
                      hours: event.target.value
                    }))
                  }
                  placeholder="Длительность, часов"
                  inputMode="numeric"
                />
                <button
                  className="primaryButton"
                  disabled={!auctionForm.itemDefinitionId}
                  onClick={() => void createServerAuction()}
                  type="button"
                >
                  Запустить аукцион
                </button>
              </div>
            </section>

            <section className="panel">
              <div className="panelHeader">
                <div>
                  <h2>Новая лотерея</h2>
                  <p>
                    Деньги билетов хранятся в escrow до автоматического розыгрыша.
                  </p>
                </div>
              </div>
              <div className="economyForm">
                <input
                  className="fieldInput"
                  value={lotteryForm.title}
                  onChange={(event) =>
                    setLotteryForm((current) => ({
                      ...current,
                      title: event.target.value
                    }))
                  }
                  placeholder="Название"
                />
                <input
                  className="fieldInput"
                  value={lotteryForm.ticketPrice}
                  onChange={(event) =>
                    setLotteryForm((current) => ({
                      ...current,
                      ticketPrice: event.target.value
                    }))
                  }
                  placeholder="Цена билета NEC"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={lotteryForm.hours}
                  onChange={(event) =>
                    setLotteryForm((current) => ({
                      ...current,
                      hours: event.target.value
                    }))
                  }
                  placeholder="Длительность, часов"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={lotteryForm.maxTickets}
                  onChange={(event) =>
                    setLotteryForm((current) => ({
                      ...current,
                      maxTickets: event.target.value
                    }))
                  }
                  placeholder="Общий лимит билетов"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={lotteryForm.maxTicketsPerUser}
                  onChange={(event) =>
                    setLotteryForm((current) => ({
                      ...current,
                      maxTicketsPerUser: event.target.value
                    }))
                  }
                  placeholder="Лимит на участника"
                  inputMode="numeric"
                />
                <input
                  className="fieldInput"
                  value={lotteryForm.feePercent}
                  onChange={(event) =>
                    setLotteryForm((current) => ({
                      ...current,
                      feePercent: event.target.value
                    }))
                  }
                  placeholder="Комиссия %"
                  inputMode="decimal"
                />
                <button
                  className="primaryButton"
                  disabled={!lotteryForm.title.trim()}
                  onClick={() => void createLottery()}
                  type="button"
                >
                  Создать лотерею
                </button>
              </div>
            </section>
          </div>
        </>
      )}

      {tab === "market" && (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Объявления маркетплейса</h2>
              <p>Последние 100 объявлений, включая завершённые.</p>
            </div>
          </div>
          <div className="auditList">
            {listings.length === 0 ? (
              <p className="empty">Объявлений пока нет.</p>
            ) : (
              listings.map((listing) => (
                <div className="auditRow" key={listing.id}>
                  <div>
                    <strong>{listing.status} • {nec(listing.price)}</strong>
                    <span>
                      {listing.sellerId}
                      {listing.buyerId ? " → " + listing.buyerId : ""}
                      {" • item " + listing.itemInstanceId}
                    </span>
                  </div>
                  <time>{date(listing.createdAt)}</time>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "auctions" && (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Аукционы</h2>
              <p>История ставок и текущее состояние каждого аукциона.</p>
            </div>
          </div>
          <div className="auditList">
            {auctions.length === 0 ? (
              <p className="empty">Аукционов пока нет.</p>
            ) : (
              auctions.map((auction) => (
                <div className="tradeAuctionRow" key={auction.id}>
                  <div>
                    <strong>
                      {auction.source} • {auction.status} •{" "}
                      {nec(auction.currentBid ?? auction.startPrice)}
                    </strong>
                    <span>
                      ID {auction.id} • лидер{" "}
                      {auction.currentBidderId ?? "нет"} • конец{" "}
                      {date(auction.endsAt)}
                    </span>
                    <small>
                      Ставок: {auction.bids.length}
                      {auction.buyoutPrice
                        ? " • выкуп " + nec(auction.buyoutPrice)
                        : ""}
                    </small>
                  </div>
                  {canRunDangerous &&
                    ["SCHEDULED", "ACTIVE"].includes(auction.status) && (
                      <button
                        className="dangerButton"
                        onClick={() => void forceCancelAuction(auction.id)}
                        type="button"
                      >
                        Принудительно отменить
                      </button>
                    )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "games" && (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Игровые сессии</h2>
              <p>Состояние PvP и казино-игр.</p>
            </div>
          </div>
          <div className="auditList">
            {games.length === 0 ? (
              <p className="empty">Игровых сессий пока нет.</p>
            ) : (
              games.map((game) => (
                <div className="auditRow" key={game.id}>
                  <div>
                    <strong>
                      {game.gameType} • {game.status}
                    </strong>
                    <span>
                      {game.hostId}
                      {game.opponentId ? " vs " + game.opponentId : ""}
                      {game.winnerId ? " • winner " + game.winnerId : ""}
                    </span>
                  </div>
                  <div className="economyTransactionAmount">
                    <strong>{nec(game.pot)}</strong>
                    <time>{date(game.createdAt)}</time>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "lotteries" && (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Лотереи</h2>
              <p>Текущие и завершённые раунды.</p>
            </div>
          </div>
          <div className="auditList">
            {lotteries.length === 0 ? (
              <p className="empty">Лотерей пока нет.</p>
            ) : (
              lotteries.map((lottery) => (
                <div className="auditRow" key={lottery.id}>
                  <div>
                    <strong>
                      {lottery.title} • {lottery.status}
                    </strong>
                    <span>
                      билет {nec(lottery.ticketPrice)}
                      {lottery.winnerId
                        ? " • winner " + lottery.winnerId
                        : ""}
                    </span>
                  </div>
                  <div className="economyTransactionAmount">
                    <strong>{nec(lottery.pot)}</strong>
                    <time>{date(lottery.endsAt)}</time>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "escrow" && (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Escrow</h2>
              <p>
                Удержанные ставки и деньги сделок. HELD не должны зависать после
                завершения операции.
              </p>
            </div>
          </div>
          <div className="auditList">
            {escrows.length === 0 ? (
              <p className="empty">Записей escrow пока нет.</p>
            ) : (
              escrows.map((entry) => (
                <div className="auditRow" key={entry.id}>
                  <div>
                    <strong>
                      {entry.kind} • {entry.status}
                    </strong>
                    <span>
                      {entry.userId} • ref {entry.referenceId}
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
      )}
    </div>
  );
}
