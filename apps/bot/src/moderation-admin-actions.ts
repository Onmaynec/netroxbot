
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from "discord.js";
import {
  createModerationCase,
  getAppeal,
  getModerationCase,
  getModeratorStats,
  getUserModerationHistory,
  listPendingAppeals,
  markModerationCaseExpired,
  reviewAppeal
} from "@netrox/database";
import {
  caseEmbed,
  caseTypeLabel,
  requireModerator,
  reverseActiveCase,
  sendCaseLog,
  statusLabel,
  type ModerationRuntime
} from "./moderation-service.js";

const ACCENT = 0x57f287;

function reasonOrDefault(
  interaction: ChatInputCommandInteraction
): string {
  return (
    interaction.options.getString("reason")?.trim() ||
    "Причина не указана."
  );
}

async function handleClear(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ManageMessages
    ))
  ) {
    return;
  }

  if (
    !interaction.guild ||
    !interaction.channel ||
    !interaction.channel.isTextBased() ||
    !("bulkDelete" in interaction.channel)
  ) {
    await interaction.reply({
      content: "В этом канале нельзя массово удалять сообщения.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const amount = interaction.options.getInteger("amount", true);
  const user = interaction.options.getUser("user");

  const fetched = await interaction.channel.messages.fetch({
    limit: Math.min(100, amount * (user ? 3 : 1))
  });

  const selected = user
    ? fetched
        .filter((message) => message.author.id === user.id)
        .first(amount)
    : fetched.first(amount);

  const deleted = await interaction.channel.bulkDelete(selected, true);
  const reason = reasonOrDefault(interaction);

  const moderationCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: interaction.user.id,
    type: "CLEAR",
    targetUserId: user?.id ?? null,
    targetChannelId: interaction.channel.id,
    reason,
    evidence: {
      requested: amount,
      deleted: deleted.size
    }
  });

  const completed = await markModerationCaseExpired(moderationCase.id);
  await sendCaseLog(runtime, completed);

  await interaction.reply({
    content:
      "Удалено сообщений: " +
      deleted.size +
      ". Кейс #" +
      completed.caseNumber +
      ".",
    flags: MessageFlags.Ephemeral
  });
}

async function handleSlowmode(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ManageChannels
    ))
  ) {
    return;
  }

  if (
    !interaction.guild ||
    !interaction.channel ||
    !("setRateLimitPerUser" in interaction.channel)
  ) {
    await interaction.reply({
      content: "В этом канале нельзя менять slowmode.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const seconds = interaction.options.getInteger("seconds", true);
  const reason = reasonOrDefault(interaction);

  await interaction.channel.setRateLimitPerUser(seconds, reason);

  const moderationCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: interaction.user.id,
    type: "SLOWMODE",
    targetChannelId: interaction.channel.id,
    reason,
    evidence: { seconds }
  });

  const completed = await markModerationCaseExpired(moderationCase.id);
  await sendCaseLog(runtime, completed);

  await interaction.reply({
    content:
      (seconds === 0
        ? "Slowmode выключен."
        : "Slowmode: " + seconds + " сек.") +
      " Кейс #" +
      completed.caseNumber +
      ".",
    flags: MessageFlags.Ephemeral
  });
}

async function handleChannelLock(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime,
  locked: boolean
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ManageChannels
    ))
  ) {
    return;
  }

  if (
    !interaction.guild ||
    !interaction.channel ||
    !("permissionOverwrites" in interaction.channel)
  ) {
    await interaction.reply({
      content: "Этот канал нельзя заблокировать таким способом.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reason = reasonOrDefault(interaction);

  await interaction.channel.permissionOverwrites.edit(
    interaction.guild.roles.everyone,
    {
      SendMessages: locked ? false : null
    },
    { reason }
  );

  const moderationCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: interaction.user.id,
    type: locked ? "LOCK" : "UNLOCK",
    targetChannelId: interaction.channel.id,
    reason
  });

  const completed = await markModerationCaseExpired(moderationCase.id);
  await sendCaseLog(runtime, completed);

  await interaction.reply({
    content:
      (locked ? "Канал закрыт." : "Канал открыт.") +
      " Кейс #" +
      completed.caseNumber +
      ".",
    flags: MessageFlags.Ephemeral
  });
}

async function handleHistory(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ModerateMembers
    ))
  ) {
    return;
  }

  const user = interaction.options.getUser("user", true);
  const history = await getUserModerationHistory(
    runtime.guildId,
    user.id,
    15
  );

  const lines = history.map((item) => {
    const timestamp = Math.floor(item.createdAt.getTime() / 1000);
    const reason =
      item.reason.length > 90
        ? item.reason.slice(0, 87) + "…"
        : item.reason;

    return (
      "#" +
      item.caseNumber +
      " • " +
      caseTypeLabel(item.type) +
      " • " +
      statusLabel(item.status) +
      " • <t:" +
      timestamp +
      ":R>\n" +
      reason
    );
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("История • " + user.username)
        .setDescription(
          lines.length > 0
            ? lines.join("\n\n")
            : "Moderation-кейсов пока нет."
        )
    ],
    flags: MessageFlags.Ephemeral
  });
}

async function handleCaseCommand(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ModerateMembers
    ))
  ) {
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const caseNumber = interaction.options.getInteger("number", true);

  if (subcommand === "view") {
    const moderationCase = await getModerationCase(
      runtime.guildId,
      caseNumber
    );

    if (!moderationCase) {
      await interaction.reply({
        content: "Кейс не найден.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = caseEmbed(moderationCase);

    if (moderationCase.appeals.length > 0) {
      embed.addFields({
        name: "Апелляции",
        value: moderationCase.appeals
          .slice(0, 5)
          .map(
            (appeal) =>
              appeal.id +
              " • " +
              appeal.status +
              " • <@" +
              appeal.userId +
              ">"
          )
          .join("\n")
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const original = await reverseActiveCase(
      runtime,
      interaction.user.id,
      caseNumber
    );

    await interaction.reply({
      content: "Кейс #" + original.caseNumber + " отменён.",
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    await interaction.reply({
      content:
        error instanceof Error
          ? error.message
          : "Не удалось отменить кейс.",
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleModStats(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ModerateMembers
    ))
  ) {
    return;
  }

  const moderator =
    interaction.options.getUser("moderator") ?? interaction.user;
  const period = interaction.options.getString("period") ?? "30d";

  const since =
    period === "all"
      ? undefined
      : new Date(
          Date.now() -
            (period === "7d" ? 7 : 30) *
              24 *
              60 *
              60 *
              1000
        );

  const stats = await getModeratorStats(
    runtime.guildId,
    moderator.id,
    since
  );

  const byType = Object.entries(stats.byType)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([type, count]) =>
        caseTypeLabel(type) + ": " + count
    )
    .join("\n");

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(
          "Статистика модератора • " + moderator.username
        )
        .addFields(
          {
            name: "Всего кейсов",
            value: String(stats.total),
            inline: true
          },
          {
            name: "Активных",
            value: String(stats.active),
            inline: true
          },
          {
            name: "Отменено",
            value: String(stats.cancelled),
            inline: true
          },
          {
            name: "Завершено",
            value: String(stats.expired),
            inline: true
          },
          {
            name: "По действиям",
            value: byType || "Нет данных"
          }
        )
    ],
    flags: MessageFlags.Ephemeral
  });
}

async function handleAppealsAdmin(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (
    !(await requireModerator(
      interaction,
      PermissionFlagsBits.ModerateMembers
    ))
  ) {
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const appeals = await listPendingAppeals(runtime.guildId, 20);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle("Ожидающие апелляции")
          .setDescription(
            appeals.length > 0
              ? appeals
                  .map(
                    (appeal) =>
                      "ID " +
                      appeal.id +
                      " • кейс #" +
                      appeal.case.caseNumber +
                      " • <@" +
                      appeal.userId +
                      ">\n" +
                      appeal.text.slice(0, 180)
                  )
                  .join("\n\n")
              : "Ожидающих апелляций нет."
          )
      ],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const id = interaction.options.getString("id", true);
  const note = interaction.options.getString("note");
  const appeal = await getAppeal(id);

  if (
    !appeal ||
    appeal.guildId !== runtime.guildId ||
    appeal.status !== "PENDING"
  ) {
    await interaction.reply({
      content: "Ожидающая апелляция с таким ID не найдена.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (
    subcommand === "accept" &&
    appeal.case.status === "ACTIVE"
  ) {
    try {
      await reverseActiveCase(
        runtime,
        interaction.user.id,
        appeal.case.caseNumber
      );
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? "Не удалось отменить наказание: " + error.message
            : "Не удалось отменить наказание.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  }

  const reviewed = await reviewAppeal({
    id,
    reviewerId: interaction.user.id,
    accepted: subcommand === "accept",
    note
  });

  const user = await runtime.client.users
    .fetch(reviewed.userId)
    .catch(() => null);

  await user
    ?.send(
      "Апелляция по кейсу #" +
        reviewed.case.caseNumber +
        ": " +
        (subcommand === "accept" ? "принята" : "отклонена") +
        "." +
        (note ? "\nКомментарий: " + note : "")
    )
    .catch(() => undefined);

  await interaction.reply({
    content:
      "Апелляция " +
      (subcommand === "accept" ? "принята" : "отклонена") +
      ".",
    flags: MessageFlags.Ephemeral
  });
}

export async function handleAdminModerationCommand(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
): Promise<boolean> {
  switch (interaction.commandName) {
    case "clear":
      await handleClear(interaction, runtime);
      return true;
    case "slowmode":
      await handleSlowmode(interaction, runtime);
      return true;
    case "lock":
      await handleChannelLock(interaction, runtime, true);
      return true;
    case "unlock":
      await handleChannelLock(interaction, runtime, false);
      return true;
    case "history":
      await handleHistory(interaction, runtime);
      return true;
    case "case":
      await handleCaseCommand(interaction, runtime);
      return true;
    case "modstats":
      await handleModStats(interaction, runtime);
      return true;
    case "appeals":
      await handleAppealsAdmin(interaction, runtime);
      return true;
    default:
      return false;
  }
}
