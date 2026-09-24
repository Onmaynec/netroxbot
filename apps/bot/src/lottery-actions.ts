import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction
} from "discord.js";
import {
  EconomyError,
  buyLotteryTickets,
  createLotteryRound,
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

async function gameSettings(guildId: string) {
  const row = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "games"
      }
    }
  });

  return {
    enabled: row?.enabled ?? true,
    settings: record(row?.settings)
  };
}

async function canAdmin(interaction: ChatInputCommandInteraction) {
  if (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { discordId: interaction.user.id }
  });

  return Boolean(admin && !admin.revokedAt);
}

function nec(value: bigint) {
  return "🪙 " + value.toLocaleString("ru-RU") + " NEC";
}

function toBps(percent: number) {
  return Math.max(0, Math.min(10000, Math.round(percent * 100)));
}

export async function showLotteries(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction
) {
  const rounds = await prisma.economyLotteryRound.findMany({
    where: {
      guildId: runtime.guildId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { gt: new Date() }
    },
    orderBy: { endsAt: "asc" },
    take: 25
  });

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🎟️ Лотереи NetroxBot")
    .setDescription(
      rounds.length === 0
        ? "Активных лотерей пока нет."
        : rounds
            .map(
              (round) =>
                "**" +
                round.title +
                "**\nБилет: " +
                nec(round.ticketPrice) +
                " • банк: " +
                nec(round.pot) +
                "\nID: " +
                round.id +
                "\nЗавершится <t:" +
                Math.floor(round.endsAt.getTime() / 1000) +
                ":R>"
            )
            .join("\n\n")
    );

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleLotteryCommand(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction
) {
  const config = await gameSettings(runtime.guildId);

  if (
    !config.enabled ||
    !booleanSetting(config.settings, "lotteryEnabled", true)
  ) {
    throw new EconomyError(
      "LOTTERY_DISABLED",
      "Лотерея сейчас выключена."
    );
  }

  const action = interaction.options.getSubcommand();

  if (action === "browse") {
    await showLotteries(runtime, interaction);
    return true;
  }

  if (action === "create") {
    if (!(await canAdmin(interaction))) {
      throw new EconomyError(
        "ADMIN_REQUIRED",
        "Создавать серверные лотереи может только администрация."
      );
    }

    const title = interaction.options.getString("название", true);
    const ticketPrice = BigInt(
      interaction.options.getInteger("цена", true)
    );
    const hours = interaction.options.getInteger("часы", true);
    const maxTickets = interaction.options.getInteger("билеты");
    const configuredUserLimit = Math.max(
      1,
      Math.trunc(
        numberSetting(
          config.settings,
          "lotteryMaxTicketsPerUser",
          100
        )
      )
    );
    const maxTicketsPerUser =
      interaction.options.getInteger("на_участника") ??
      configuredUserLimit;
    const feePercent = numberSetting(
      config.settings,
      "lotteryFeePercent",
      5
    );
    const startsAt = new Date();

    const round = await createLotteryRound({
      guildId: runtime.guildId,
      title,
      ticketPrice,
      maxTickets,
      maxTicketsPerUser,
      feeBps: toBps(feePercent),
      startsAt,
      endsAt: new Date(
        startsAt.getTime() + hours * 60 * 60 * 1000
      ),
      createdBy: interaction.user.id
    });

    await interaction.reply({
      content:
        "🎟️ Лотерея **" +
        round.title +
        "** создана. ID: " +
        round.id +
        ".",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === "buy") {
    const roundId = interaction.options.getString("id", true);
    const quantity = interaction.options.getInteger(
      "количество",
      true
    );

    const result = await buyLotteryTickets({
      guildId: runtime.guildId,
      roundId,
      userId: interaction.user.id,
      quantity
    });

    await interaction.reply({
      content:
        "🎟️ Куплено билетов: **" +
        quantity +
        "**. Списано " +
        nec(result.cost) +
        ".",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}
