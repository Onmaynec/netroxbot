
import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import {
  EconomyError,
  buyMarketplaceListing,
  cancelMarketplaceListing,
  createMarketplaceListing,
  listMarketplaceListings,
  prisma
} from "@netrox/database";

const ACCENT = 0x57f287;

export type TradeRuntime = {
  guildId: string;
};

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

export async function showMarketplace(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction
) {
  const listings = await listMarketplaceListings(runtime.guildId, 25);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("💎 Торговая площадка")
    .setDescription(
      listings.length === 0
        ? "Активных объявлений пока нет."
        : listings
            .map(
              (listing, index) =>
                "**" +
                (index + 1) +
                ". " +
                nec(listing.price) +
                "**\nПродавец: <@" +
                listing.sellerId +
                ">\nID объявления: " +
                listing.id +
                (listing.expiresAt
                  ? "\nСнимется <t:" +
                    Math.floor(listing.expiresAt.getTime() / 1000) +
                    ":R>"
                  : "")
            )
            .join("\n\n")
    )
    .setFooter({
      text: "Покупка переводит конкретный серийный экземпляр предмета."
    });

  if (listings.length === 0) {
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("trade:market-buy:" + interaction.user.id)
    .setPlaceholder("Выбрать объявление для покупки")
    .addOptions(
      listings.map((listing, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            (
              index +
              1 +
              ". " +
              listing.price.toLocaleString("ru-RU") +
              " NEC"
            ).slice(0, 100)
          )
          .setDescription(
            ("Продавец " + listing.sellerId).slice(0, 100)
          )
          .setValue(listing.id)
      )
    );

  await interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
    ],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleMarketCommand(
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
    await showMarketplace(runtime, interaction);
    return true;
  }

  if (action === "sell") {
    if (
      !booleanSetting(
        config.settings,
        "marketplaceEnabled",
        true
      )
    ) {
      throw new EconomyError(
        "MARKETPLACE_DISABLED",
        "Торговая площадка отключена в настройках."
      );
    }

    const itemInstanceId = interaction.options.getString("id", true);
    const price = BigInt(
      interaction.options.getInteger("цена", true)
    );
    const hours = Math.max(
      1,
      Math.trunc(
        numberSetting(
          config.settings,
          "listingDurationHours",
          72
        )
      )
    );
    const feePercent = numberSetting(
      config.settings,
      "marketplaceFeePercent",
      5
    );

    const listing = await createMarketplaceListing({
      guildId: runtime.guildId,
      sellerId: interaction.user.id,
      itemInstanceId,
      price,
      feeBps: toBps(feePercent),
      expiresAt: new Date(
        Date.now() + hours * 60 * 60 * 1000
      )
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle("✅ Предмет выставлен")
          .setDescription(
            "Цена: **" +
              nec(listing.price) +
              "**\nID объявления: " +
              listing.id
          )
      ],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === "buy") {
    const listingId = interaction.options.getString("id", true);
    const listing = await buyMarketplaceListing({
      guildId: runtime.guildId,
      listingId,
      buyerId: interaction.user.id
    });

    await interaction.reply({
      content:
        "✅ Покупка завершена. Объявление " +
        listing.id +
        " закрыто.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === "cancel") {
    const listingId = interaction.options.getString("id", true);

    await cancelMarketplaceListing({
      guildId: runtime.guildId,
      listingId,
      sellerId: interaction.user.id
    });

    await interaction.reply({
      content: "Объявление снято, предмет снова доступен.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

export async function handleMarketSelect(
  runtime: TradeRuntime,
  interaction: StringSelectMenuInteraction
) {
  if (!interaction.customId.startsWith("trade:market-buy:")) {
    return false;
  }

  const ownerId = interaction.customId.slice(
    "trade:market-buy:".length
  );

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Это меню открыто другим участником.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const listingId = interaction.values[0];

  if (!listingId) {
    await interaction.reply({
      content: "Объявление не выбрано.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const listing = await buyMarketplaceListing({
    guildId: runtime.guildId,
    listingId,
    buyerId: interaction.user.id
  });

  await interaction.update({
    content:
      "✅ Покупка завершена. Объявление " +
      listing.id +
      " закрыто.",
    embeds: [],
    components: []
  });

  return true;
}
