import { randomInt } from "node:crypto";
import type { Client } from "discord.js";
import {
  createServerAuction,
  expireGameSessions,
  expireMarketplaceListings,
  prisma,
  settleDueAuctions,
  settleDueLotteries
} from "@netrox/database";
import type { TradeRuntime } from "./trade-actions.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function booleanSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: boolean
) {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(
  settings: Record<string, unknown>,
  key: string
) {
  const value = settings[key];
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

async function maybeCreateAutoAuction(
  client: Client,
  runtime: TradeRuntime
) {
  const config = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId: runtime.guildId,
        moduleKey: "market"
      }
    }
  });

  if (!config?.enabled) {
    return;
  }

  const settings = record(config.settings);

  if (!booleanSetting(settings, "autoAuction", true)) {
    return;
  }

  const now = new Date();
  const active = await prisma.economyAuction.findFirst({
    where: {
      guildId: runtime.guildId,
      source: "AUTO",
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { gt: now }
    }
  });

  if (active) {
    return;
  }

  const intervalHours = Math.max(
    1,
    Math.trunc(
      numberSetting(settings, "auctionIntervalHours", 48)
    )
  );
  const latest = await prisma.economyAuction.findFirst({
    where: {
      guildId: runtime.guildId,
      source: "AUTO"
    },
    orderBy: { createdAt: "desc" }
  });

  if (
    latest &&
    now.getTime() - latest.createdAt.getTime() <
      intervalHours * 60 * 60 * 1000
  ) {
    return;
  }

  const items = await prisma.economyItemDefinition.findMany({
    where: {
      guildId: runtime.guildId,
      active: true,
      tradable: true
    },
    orderBy: { createdAt: "asc" },
    take: 250
  });

  if (items.length === 0) {
    return;
  }

  const item = items[randomInt(items.length)];

  if (!item) {
    return;
  }

  const durationHours = Math.max(
    1,
    Math.trunc(
      numberSetting(
        settings,
        "autoAuctionDurationHours",
        12
      )
    )
  );
  const startPercent = Math.max(
    1,
    Math.trunc(
      numberSetting(
        settings,
        "autoAuctionStartPricePercent",
        50
      )
    )
  );
  const minIncrement = BigInt(
    Math.max(
      1,
      Math.trunc(
        numberSetting(
          settings,
          "auctionMinIncrement",
          10
        )
      )
    )
  );
  const startPrice =
    item.price > 0n
      ? (item.price * BigInt(startPercent) + 99n) / 100n
      : 1n;
  const startsAt = new Date();

  const auction = await createServerAuction({
    guildId: runtime.guildId,
    itemDefinitionId: item.id,
    createdBy: "system",
    source: "AUTO",
    startPrice: startPrice > 0n ? startPrice : 1n,
    minIncrement,
    startsAt,
    endsAt: new Date(
      startsAt.getTime() + durationHours * 60 * 60 * 1000
    )
  });

  const channelId = stringSetting(settings, "channelId");

  if (!channelId) {
    return;
  }

  const channel = await client.channels
    .fetch(channelId)
    .catch(() => null);

  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  await channel
    .send({
      embeds: [
        {
          color: 5763719,
          title: "🔨 Новый серверный аукцион",
          description:
            "**" +
            item.name +
            "**\nСтартовая цена: 🪙 " +
            auction.startPrice.toLocaleString("ru-RU") +
            " NEC\nМинимальный шаг: 🪙 " +
            auction.minIncrement.toLocaleString("ru-RU") +
            " NEC\n\nID: " +
            auction.id +
            "\nЗавершится <t:" +
            Math.floor(auction.endsAt.getTime() / 1000) +
            ":R>.",
          ...(item.imageUrl
            ? { image: { url: item.imageUrl } }
            : {})
        }
      ]
    })
    .catch(() => undefined);
}

async function runTick(
  client: Client,
  runtime: TradeRuntime
) {
  await expireMarketplaceListings(runtime.guildId);
  await settleDueAuctions(runtime.guildId);
  await settleDueLotteries(runtime.guildId);
  await expireGameSessions(runtime.guildId);
  await maybeCreateAutoAuction(client, runtime);
}

export function startTradeScheduler(
  client: Client,
  runtime: TradeRuntime
) {
  let running = false;

  const execute = async () => {
    if (running) return;
    running = true;

    try {
      await runTick(client, runtime);
    } catch (error) {
      console.error(
        "Ошибка scheduler рынка и мини-игр",
        error
      );
    } finally {
      running = false;
    }
  };

  void execute();

  const timer = setInterval(() => {
    void execute();
  }, 60_000);

  timer.unref();

  return () => clearInterval(timer);
}
