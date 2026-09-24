
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Interaction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { parseDurationSeconds } from "@netrox/core";
import {
  cancelModerationCaseRecord,
  consumeActiveWarnings,
  createAppeal,
  createModerationCase,
  getActiveWarnings,
  getModerationCase,
  markModerationCaseExpired,
  prisma
} from "@netrox/database";
import {
  booleanSetting,
  caseEmbed,
  caseTypeLabel,
  createUserCaseAndExecute,
  getModerationSettings,
  numberSetting,
  requireModerator,
  sendCaseLog,
  sendPunishmentDm,
  stringSetting,
  type ModerationRuntime
} from "./moderation-service.js";

const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

function reasonOrDefault(
  interaction: ChatInputCommandInteraction
): string {
  return (
    interaction.options.getString("reason")?.trim() ||
    "Причина не указана."
  );
}

async function autoPunishForWarnings(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime,
  targetUserId: string,
  reason: string
) {
  if (!interaction.guild) {
    return null;
  }

  const config = await getModerationSettings(runtime.guildId);
  const settings = config.settings;
  const limit = Math.max(
    1,
    Math.floor(numberSetting(settings, "warnLimit", 3))
  );

  const warnings = await getActiveWarnings(
    runtime.guildId,
    targetUserId
  );

  if (warnings.length < limit) {
    return null;
  }

  const member = await interaction.guild.members
    .fetch(targetUserId)
    .catch(() => null);

  if (!member) {
    return null;
  }

  const action = stringSetting(settings, "warnAction") ?? "timeout";
  const autoReason =
    "Автонаказание: достигнут лимит " +
    warnings.length +
    "/" +
    limit +
    " предупреждений. Последняя причина: " +
    reason;

  let moderationCase = null;

  if (action === "kick") {
    if (!member.kickable) {
      return null;
    }

    moderationCase = await createUserCaseAndExecute(runtime, {
      moderatorId: interaction.user.id,
      type: "KICK",
      targetUserId,
      reason: autoReason,
      execute: () => member.kick(autoReason)
    });
  } else if (action === "ban") {
    if (!member.bannable) {
      return null;
    }

    moderationCase = await createUserCaseAndExecute(runtime, {
      moderatorId: interaction.user.id,
      type: "BAN",
      targetUserId,
      reason: autoReason,
      execute: () =>
        interaction.guild!.members.ban(targetUserId, {
          reason: autoReason
        })
    });
  } else {
    if (!member.moderatable) {
      return null;
    }

    const minutes = Math.max(
      1,
      Math.floor(
        numberSetting(settings, "warnTimeoutMinutes", 60)
      )
    );

    const durationSeconds = Math.min(
      minutes * 60,
      MAX_TIMEOUT_SECONDS
    );

    moderationCase = await createUserCaseAndExecute(runtime, {
      moderatorId: interaction.user.id,
      type: "TIMEOUT",
      targetUserId,
      reason: autoReason,
      durationSeconds,
      execute: () =>
        member.timeout(durationSeconds * 1000, autoReason)
    });
  }

  await consumeActiveWarnings(runtime.guildId, targetUserId);

  return moderationCase;
}

async function handleBan(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (!(await requireModerator(interaction, PermissionFlagsBits.BanMembers))) {
    return;
  }

  if (!interaction.guild) {
    return;
  }

  const user = interaction.options.getUser("user", true);
  const rawDuration = interaction.options.getString("duration");
  const durationSeconds = rawDuration
    ? parseDurationSeconds(rawDuration, {
        minSeconds: 60,
        maxSeconds: 52 * 7 * 24 * 60 * 60
      })
    : null;

  if (rawDuration && !durationSeconds) {
    await interaction.reply({
      content:
        "Некорректная длительность. Примеры: 30m, 2h, 7d, 1w.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (user.id === interaction.user.id) {
    await interaction.reply({
      content: "Нельзя применить ban к самому себе.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);

  if (member && !member.bannable) {
    await interaction.reply({
      content:
        "Я не могу забанить этого участника из-за иерархии ролей.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reason = reasonOrDefault(interaction);

  const moderationCase = await createUserCaseAndExecute(runtime, {
    moderatorId: interaction.user.id,
    type: durationSeconds ? "TEMP_BAN" : "BAN",
    targetUserId: user.id,
    reason,
    durationSeconds,
    execute: () =>
      interaction.guild!.members.ban(user.id, {
        reason
      })
  });

  await interaction.reply({
    embeds: [caseEmbed(moderationCase)],
    flags: MessageFlags.Ephemeral
  });
}

async function handleKick(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  if (!(await requireModerator(interaction, PermissionFlagsBits.KickMembers))) {
    return;
  }

  if (!interaction.guild) {
    return;
  }

  const user = interaction.options.getUser("user", true);
  const member = await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);

  if (!member?.kickable) {
    await interaction.reply({
      content:
        "Я не могу кикнуть этого участника из-за иерархии ролей.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reason = reasonOrDefault(interaction);

  const moderationCase = await createUserCaseAndExecute(runtime, {
    moderatorId: interaction.user.id,
    type: "KICK",
    targetUserId: user.id,
    reason,
    execute: () => member.kick(reason)
  });

  await interaction.reply({
    embeds: [caseEmbed(moderationCase)],
    flags: MessageFlags.Ephemeral
  });
}

async function handleTimeout(
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

  if (!interaction.guild) {
    return;
  }

  const user = interaction.options.getUser("user", true);
  const rawDuration = interaction.options.getString("duration", true);
  const durationSeconds = parseDurationSeconds(rawDuration, {
    minSeconds: 5,
    maxSeconds: MAX_TIMEOUT_SECONDS
  });

  if (!durationSeconds) {
    await interaction.reply({
      content:
        "Некорректная длительность. Discord timeout максимум 28 дней.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);

  if (!member?.moderatable) {
    await interaction.reply({
      content:
        "Я не могу выдать timeout этому участнику из-за иерархии ролей.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reason = reasonOrDefault(interaction);

  const moderationCase = await createUserCaseAndExecute(runtime, {
    moderatorId: interaction.user.id,
    type: "TIMEOUT",
    targetUserId: user.id,
    reason,
    durationSeconds,
    execute: () => member.timeout(durationSeconds * 1000, reason)
  });

  await interaction.reply({
    embeds: [caseEmbed(moderationCase)],
    flags: MessageFlags.Ephemeral
  });
}

async function handleMute(
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

  if (!interaction.guild) {
    return;
  }

  const config = await getModerationSettings(runtime.guildId);
  const muteRoleId = stringSetting(config.settings, "muteRoleId");

  if (!muteRoleId) {
    await interaction.reply({
      content:
        "Сначала укажи Mute-роль в /settings, раздел Модерация.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const member = await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);

  if (!member?.manageable) {
    await interaction.reply({
      content: "Я не могу изменить роли этого участника.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const rawDuration = interaction.options.getString("duration");
  const durationSeconds = rawDuration
    ? parseDurationSeconds(rawDuration, {
        minSeconds: 5,
        maxSeconds: 52 * 7 * 24 * 60 * 60
      })
    : null;

  if (rawDuration && !durationSeconds) {
    await interaction.reply({
      content: "Некорректная длительность.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reason = reasonOrDefault(interaction);

  const moderationCase = await createUserCaseAndExecute(runtime, {
    moderatorId: interaction.user.id,
    type: "MUTE",
    targetUserId: user.id,
    reason,
    durationSeconds,
    execute: () => member.roles.add(muteRoleId, reason)
  });

  await interaction.reply({
    embeds: [caseEmbed(moderationCase)],
    flags: MessageFlags.Ephemeral
  });
}

async function handleWarn(
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
  const reason = interaction.options.getString("reason", true);

  const moderationCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: interaction.user.id,
    type: "WARN",
    targetUserId: user.id,
    reason,
    dmDelivered: null
  });

  const settings = await getModerationSettings(runtime.guildId);
  let dmDelivered: boolean | null = null;

  if (booleanSetting(settings.settings, "dmOnAction", true)) {
    dmDelivered = await sendPunishmentDm(
      runtime,
      user.id,
      moderationCase
    );
  }

  const updated = await prisma.moderationCase.update({
    where: { id: moderationCase.id },
    data: { dmDelivered }
  });

  await sendCaseLog(runtime, updated);

  const automatic = await autoPunishForWarnings(
    interaction,
    runtime,
    user.id,
    reason
  );

  const embed = caseEmbed(updated);

  if (automatic) {
    embed.addFields({
      name: "Автонаказание",
      value:
        "Создан дополнительный кейс #" +
        automatic.caseNumber +
        ": " +
        caseTypeLabel(automatic.type) +
        "."
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function handleUnwarn(
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

  const caseNumber = interaction.options.getInteger("case", true);
  const original = await getModerationCase(
    runtime.guildId,
    caseNumber
  );

  if (
    !original ||
    original.type !== "WARN" ||
    original.status !== "ACTIVE" ||
    !original.targetUserId
  ) {
    await interaction.reply({
      content: "Активный warn-кейс с таким номером не найден.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await cancelModerationCaseRecord(
    runtime.guildId,
    caseNumber,
    interaction.user.id
  );

  const reason =
    interaction.options.getString("reason")?.trim() ||
    "Снятие предупреждения #" + caseNumber;

  const unwarnCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: interaction.user.id,
    type: "UNWARN",
    targetUserId: original.targetUserId,
    reason,
    evidence: {
      originalCaseNumber: caseNumber
    }
  });

  const completed = await markModerationCaseExpired(unwarnCase.id);
  await sendCaseLog(runtime, completed);

  await interaction.reply({
    embeds: [caseEmbed(completed)],
    flags: MessageFlags.Ephemeral
  });
}

async function handleAppealCommand(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
) {
  const caseNumber = interaction.options.getInteger("case", true);
  const appealText = interaction.options.getString("text", true);

  const result = await createAppeal({
    guildId: runtime.guildId,
    caseNumber,
    userId: interaction.user.id,
    text: appealText
  });

  await interaction.reply({
    content: result.ok
      ? "Апелляция создана. ID: " + result.appeal.id + "."
      : result.error === "ALREADY_PENDING"
        ? "На этот кейс уже есть ожидающая апелляция."
        : "Этот кейс не найден среди твоих наказаний.",
    flags: MessageFlags.Ephemeral
  });
}

export async function handleUserModerationCommand(
  interaction: ChatInputCommandInteraction,
  runtime: ModerationRuntime
): Promise<boolean> {
  switch (interaction.commandName) {
    case "ban":
      await handleBan(interaction, runtime);
      return true;
    case "kick":
      await handleKick(interaction, runtime);
      return true;
    case "timeout":
      await handleTimeout(interaction, runtime);
      return true;
    case "mute":
      await handleMute(interaction, runtime);
      return true;
    case "warn":
      await handleWarn(interaction, runtime);
      return true;
    case "unwarn":
      await handleUnwarn(interaction, runtime);
      return true;
    case "appeal":
      await handleAppealCommand(interaction, runtime);
      return true;
    default:
      return false;
  }
}

export async function handleAppealComponent(
  interaction: Interaction,
  runtime: ModerationRuntime
): Promise<boolean> {
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("appeal:create:")
  ) {
    const caseNumber = Number(
      interaction.customId.slice("appeal:create:".length)
    );

    if (!Number.isInteger(caseNumber) || caseNumber <= 0) {
      await interaction.reply({
        content: "Некорректный номер кейса."
      });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId("appeal:modal:" + caseNumber)
      .setTitle("Апелляция, кейс #" + caseNumber)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("text")
            .setLabel("Почему решение нужно пересмотреть?")
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(10)
            .setMaxLength(1500)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
    return true;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("appeal:modal:")
  ) {
    const caseNumber = Number(
      interaction.customId.slice("appeal:modal:".length)
    );

    const appealText = interaction.fields
      .getTextInputValue("text")
      .trim();

    const result = await createAppeal({
      guildId: runtime.guildId,
      caseNumber,
      userId: interaction.user.id,
      text: appealText
    });

    const content = result.ok
      ? "Апелляция отправлена. ID: " + result.appeal.id + "."
      : result.error === "ALREADY_PENDING"
        ? "На этот кейс уже есть ожидающая апелляция."
        : "Этот кейс не найден среди твоих наказаний.";

    if (interaction.inGuild()) {
      await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral
      });
    } else {
      await interaction.reply({ content });
    }

    return true;
  }

  return false;
}
