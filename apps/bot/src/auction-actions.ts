
import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction
} from "discord.js";
import {
  EconomyError,
  cancelAuction,
  createUserAuction,
  listActiveAuctions,
  placeAuctionBid,
  prisma
} from "@netrox/database";
import type { TradeRuntime } from "./market-actions.js";

const ACCENT = 0x57f287;

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

async function marketSettings(guildId: string) {
  const row = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "market"
      }
    }
  });

  return {
    enabled: row?.enabled ?? true,
    settings: record(row?.settings)
  };
}

function nec(value: bigint) {
  return "🪙 " + value.toLocaleString("ru-RU") + " NEC";
}

function toBps(percent: number) {
  return Math.max(0, Math.min(10000, Math.round(percent * 100)));
}

export async function showAuctions(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction
) {
  const auctions = await listActiveAuctions(runtime.guildId, 25);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🔨 Аукционы NetroxBot")
    .setDescription(
      auctions.length === 0
        ? "Активных аукционов пока нет."
        : auctions
            .map((auction, index) => {
              const current = auction.currentBid ?? auction.startPrice;
              const source =
                auction.source === "USER"
                  ? "Пользовательский"
                  : auction.source === "AUTO"
                    ? "Автоматический серверный"
                    : "Серверный";

              return (
                "**" +
                (index + 1) +
                ". " +
                source +
                "**\nТекущая цена: " +
                nec(current) +
                " • шаг " +
                nec(auction.minIncrement) +
                "\nID: " +
                auction.id +
                "\nКонец <t:" +
                Math.floor(auction.endsAt.getTime() / 1000) +
                ":R>" +
                (auction.currentBidderId
                  ? " • лидер <@" + auction.currentBidderId + ">"
                  : "")
              );
            })
            .join("\n\n")
    );

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleAuctionCommand(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction
) {
  const config = await marketSettings(runtime.guildId);

  if (!config.enabled) {
    throw new EconomyError(
      "MARKET_DISABLED",
      "Модуль рынка сейчас выключен."
    );
  }

  const action = interaction.options.getSubcommand();

  if (action === "browse") {
    await showAuctions(runtime, interaction);
    return true;
  }

  if (!booleanSetting(config.settings, "auctionEnabled", true)) {
    throw new EconomyError(
      "AUCTIONS_DISABLED",
      "Пользовательские аукционы отключены."
    );
  }

  if (action === "create") {
    const itemInstanceId = interaction.options.getString("id", true);
    const startPrice = BigInt(
      interaction.options.getInteger("старт", true)
    );
    const defaultStep = Math.max(
      1,
      Math.trunc(
        numberSetting(
          config.settings,
          "auctionMinIncrement",
          10
        )
      )
    );
    const minIncrement = BigInt(
      interaction.options.getInteger("шаг") ?? defaultStep
    );
    const defaultHours = Math.max(
      1,
      Math.trunc(
        numberSetting(
          config.settings,
          "auctionDefaultHours",
          24
        )
      )
    );
    const hours =
      interaction.options.getInteger("часы") ?? defaultHours;
    const buyout = interaction.options.getInteger("выкуп");
    const feePercent = numberSetting(
      config.settings,
      "auctionFeePercent",
      5
    );
    const startsAt = new Date();

    const auction = await createUserAuction({
      guildId: runtime.guildId,
      sellerId: interaction.user.id,
      itemInstanceId,
      startPrice,
      minIncrement,
      buyoutPrice:
        buyout === null ? null : BigInt(buyout),
      feeBps: toBps(feePercent),
      startsAt,
      endsAt: new Date(
        startsAt.getTime() + hours * 60 * 60 * 1000
      )
    });

    await interaction.reply({
      content:
        "🔨 Аукцион создан. ID: " +
        auction.id +
        ". Старт: " +
        nec(auction.startPrice) +
        ".",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === "bid") {
    const auctionId = interaction.options.getString("id", true);
    const amount = BigInt(
      interaction.options.getInteger("сумма", true)
    );

    const auction = await placeAuctionBid({
      guildId: runtime.guildId,
      auctionId,
      bidderId: interaction.user.id,
      amount
    });

    await interaction.reply({
      content:
        "✅ Ставка " +
        nec(amount) +
        " принята на аукцион " +
        auction.id +
        ".",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === "cancel") {
    const auctionId = interaction.options.getString("id", true);

    await cancelAuction({
      guildId: runtime.guildId,
      auctionId,
      actorId: interaction.user.id
    });

    await interaction.reply({
      content: "Аукцион отменён, предмет разблокирован.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}
