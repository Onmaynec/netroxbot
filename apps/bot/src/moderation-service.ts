
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import { formatDurationSeconds } from "@netrox/core";
import { emitServerLog } from "./logging.js";
import {
  cancelModerationCaseRecord,
  createModerationCase,
  getDueModerationCases,
  getModerationCase,
  markModerationCaseExpired,
  prisma
} from "@netrox/database";

const ACCENT = 0x57f287;
const DANGER = 0xed4245;

export type ModerationRuntime = {
  client: Client;
  guildId: string;
};

export type ModerationSettings = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

export type ModerationCaseRecord = Awaited<
  ReturnType<typeof createModerationCase>
>;

export function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function stringSetting(
  settings: Record<string, unknown>,
  key: string
): string | null {
  const value = settings[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = settings[key];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

export function booleanSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = settings[key];

  return typeof value === "boolean" ? value : fallback;
}

export async function getModerationSettings(
  guildId: string
): Promise<ModerationSettings> {
  const config = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "moderation"
      }
    }
  });

  return {
    enabled: config?.enabled ?? true,
    settings: jsonRecord(config?.settings)
  };
}

export async function isNetroxAdmin(userId: string): Promise<boolean> {
  const admin = await prisma.adminUser.findUnique({
    where: { discordId: userId }
  });

  return Boolean(admin && !admin.revokedAt);
}

export async function canModerate(
  interaction: ChatInputCommandInteraction,
  permission: bigint
): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild) {
    return false;
  }

  if (await isNetroxAdmin(interaction.user.id)) {
    return true;
  }

  if (interaction.memberPermissions?.has(permission)) {
    return true;
  }

  const moderation = await getModerationSettings(interaction.guildId);
  const moderatorRoleId = stringSetting(
    moderation.settings,
    "moderatorRoleId"
  );

  if (!moderatorRoleId) {
    return false;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  return Boolean(member?.roles.cache.has(moderatorRoleId));
}

export async function requireModerator(
  interaction: ChatInputCommandInteraction,
  permission: bigint
): Promise<boolean> {
  if (!interaction.guildId) {
    return false;
  }

  const moderation = await getModerationSettings(interaction.guildId);

  if (!moderation.enabled) {
    await interaction.reply({
      content: "Модуль модерации выключен в /settings.",
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  if (!(await canModerate(interaction, permission))) {
    await interaction.reply({
      content: "У тебя нет прав для этого действия.",
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  return true;
}

export function caseTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    WARN: "Предупреждение",
    TIMEOUT: "Timeout",
    MUTE: "Mute",
    KICK: "Kick",
    BAN: "Ban",
    TEMP_BAN: "Временный ban",
    UNWARN: "Снятие warn",
    CLEAR: "Очистка сообщений",
    SLOWMODE: "Slowmode",
    LOCK: "Блокировка канала",
    UNLOCK: "Разблокировка канала"
  };

  return labels[type] ?? type;
}

export function statusLabel(status: string): string {
  if (status === "ACTIVE") return "🟢 активно";
  if (status === "CANCELLED") return "🔴 отменено";
  return "⚪ завершено";
}

export function caseEmbed(moderationCase: {
  caseNumber: number;
  type: string;
  status: string;
  moderatorId: string;
  reason: string;
  targetUserId: string | null;
  targetChannelId: string | null;
  durationSeconds: number | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  const embed = new EmbedBuilder()
    .setColor(
      moderationCase.status === "CANCELLED"
        ? DANGER
        : moderationCase.status === "ACTIVE"
          ? ACCENT
          : 0x747f8d
    )
    .setTitle(
      "Кейс #" +
        moderationCase.caseNumber +
        " • " +
        caseTypeLabel(moderationCase.type)
    )
    .addFields(
      {
        name: "Статус",
        value: statusLabel(moderationCase.status),
        inline: true
      },
      {
        name: "Модератор",
        value: "<@" + moderationCase.moderatorId + ">",
        inline: true
      },
      {
        name: "Причина",
        value: moderationCase.reason
      }
    )
    .setTimestamp(moderationCase.createdAt);

  if (moderationCase.targetUserId) {
    embed.addFields({
      name: "Пользователь",
      value: "<@" + moderationCase.targetUserId + ">",
      inline: true
    });
  }

  if (moderationCase.targetChannelId) {
    embed.addFields({
      name: "Канал",
      value: "<#" + moderationCase.targetChannelId + ">",
      inline: true
    });
  }

  if (moderationCase.durationSeconds) {
    embed.addFields({
      name: "Длительность",
      value: formatDurationSeconds(moderationCase.durationSeconds),
      inline: true
    });
  }

  if (moderationCase.expiresAt) {
    embed.addFields({
      name: "Истекает",
      value:
        "<t:" +
        Math.floor(moderationCase.expiresAt.getTime() / 1000) +
        ":R>",
      inline: true
    });
  }

  return embed;
}

async function recordModerationCaseEvent(
  runtime: ModerationRuntime,
  moderationCase: ModerationCaseRecord,
  eventType =
    "moderation.case." + moderationCase.status.toLowerCase()
) {
  await emitServerLog(runtime.client, runtime.guildId, {
    category: "moderation",
    eventType,
    summary:
      "Кейс #" +
      moderationCase.caseNumber +
      " • " +
      caseTypeLabel(moderationCase.type) +
      " • " +
      statusLabel(moderationCase.status),
    actorId:
      moderationCase.cancelledBy ??
      moderationCase.moderatorId,
    targetType: moderationCase.targetUserId
      ? "user"
      : moderationCase.targetChannelId
        ? "channel"
        : "moderation_case",
    targetId:
      moderationCase.targetUserId ??
      moderationCase.targetChannelId ??
      moderationCase.id,
    channelId: moderationCase.targetChannelId,
    payload: {
      caseId: moderationCase.id,
      caseNumber: moderationCase.caseNumber,
      type: moderationCase.type,
      status: moderationCase.status,
      reason: moderationCase.reason,
      durationSeconds: moderationCase.durationSeconds,
      expiresAt:
        moderationCase.expiresAt?.toISOString() ?? null,
      dmDelivered: moderationCase.dmDelivered,
      moderatorId: moderationCase.moderatorId,
      cancelledBy: moderationCase.cancelledBy,
      cancelledAt:
        moderationCase.cancelledAt?.toISOString() ?? null
    },
    color:
      moderationCase.status === "CANCELLED"
        ? 0xed4245
        : moderationCase.status === "EXPIRED"
          ? 0x747f8d
          : 0x57f287
  });
}

export async function sendCaseLog(
  runtime: ModerationRuntime,
  moderationCase: ModerationCaseRecord
) {
  await recordModerationCaseEvent(runtime, moderationCase);

  const guild =
    runtime.client.guilds.cache.get(runtime.guildId) ??
    (await runtime.client.guilds
      .fetch(runtime.guildId)
      .catch(() => null));

  if (!guild) {
    return;
  }

  const config = await getModerationSettings(runtime.guildId);
  const logChannelId = stringSetting(config.settings, "logChannelId");

  if (!logChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(logChannelId).catch(() => null);

  if (channel?.isTextBased() && "send" in channel) {
    await channel
      .send({
        embeds: [caseEmbed(moderationCase)]
      })
      .catch(() => undefined);
  }
}

export async function sendPunishmentDm(
  runtime: ModerationRuntime,
  userId: string,
  moderationCase: ModerationCaseRecord
): Promise<boolean> {
  const user = await runtime.client.users.fetch(userId).catch(() => null);

  if (!user) {
    return false;
  }

  const appealable = [
    "WARN",
    "TIMEOUT",
    "MUTE",
    "BAN",
    "TEMP_BAN"
  ].includes(moderationCase.type);

  const components = appealable
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              "appeal:create:" + moderationCase.caseNumber
            )
            .setLabel("Подать апелляцию")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    : [];

  const embed = new EmbedBuilder()
    .setColor(DANGER)
    .setTitle(
      "Mothers Fantastic • Кейс #" + moderationCase.caseNumber
    )
    .setDescription(
      "**" +
        caseTypeLabel(moderationCase.type) +
        "**\n" +
        moderationCase.reason
    )
    .setFooter({
      text: appealable
        ? "Если считаешь решение ошибочным, подай апелляцию кнопкой ниже."
        : "Сохрани номер кейса, если он понадобится администрации."
    });

  if (moderationCase.durationSeconds) {
    embed.addFields({
      name: "Длительность",
      value: formatDurationSeconds(moderationCase.durationSeconds)
    });
  }

  return user
    .send({
      embeds: [embed],
      components
    })
    .then(() => true)
    .catch(() => false);
}

export async function createUserCaseAndExecute(
  runtime: ModerationRuntime,
  input: {
    moderatorId: string;
    type: "TIMEOUT" | "MUTE" | "KICK" | "BAN" | "TEMP_BAN";
    targetUserId: string;
    reason: string;
    durationSeconds?: number | null;
    execute: () => Promise<unknown>;
  }
) {
  const expiresAt = input.durationSeconds
    ? new Date(Date.now() + input.durationSeconds * 1000)
    : null;

  const moderationCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: input.moderatorId,
    type: input.type,
    targetUserId: input.targetUserId,
    reason: input.reason,
    durationSeconds: input.durationSeconds ?? null,
    expiresAt,
    dmDelivered: null
  });

  const settings = await getModerationSettings(runtime.guildId);
  let dmDelivered: boolean | null = null;

  if (booleanSetting(settings.settings, "dmOnAction", true)) {
    dmDelivered = await sendPunishmentDm(
      runtime,
      input.targetUserId,
      moderationCase
    );
  }

  try {
    await input.execute();
  } catch (error) {
    await cancelModerationCaseRecord(
      runtime.guildId,
      moderationCase.caseNumber,
      input.moderatorId
    ).catch(() => undefined);

    throw error;
  }

  const updated = await prisma.moderationCase.update({
    where: { id: moderationCase.id },
    data: {
      dmDelivered,
      status: input.type === "KICK" ? "EXPIRED" : moderationCase.status
    }
  });

  await sendCaseLog(runtime, updated);

  return updated;
}

export async function reverseActiveCase(
  runtime: ModerationRuntime,
  moderatorId: string,
  caseNumber: number
) {
  const guild =
    runtime.client.guilds.cache.get(runtime.guildId) ??
    (await runtime.client.guilds
      .fetch(runtime.guildId)
      .catch(() => null));

  if (!guild) {
    throw new Error("Сервер не найден.");
  }

  const moderationCase = await getModerationCase(
    runtime.guildId,
    caseNumber
  );

  if (!moderationCase) {
    throw new Error("Кейс не найден.");
  }

  if (moderationCase.status !== "ACTIVE") {
    throw new Error("Этот кейс уже не активен.");
  }

  if (moderationCase.type === "WARN") {
    const cancelled = await cancelModerationCaseRecord(
      runtime.guildId,
      caseNumber,
      moderatorId
    );

    if (cancelled) {
      await recordModerationCaseEvent(
        runtime,
        cancelled,
        "moderation.case.cancelled"
      );
      return cancelled;
    }

    return moderationCase;
  }

  if (
    moderationCase.type === "TIMEOUT" &&
    moderationCase.targetUserId
  ) {
    const member = await guild.members
      .fetch(moderationCase.targetUserId)
      .catch(() => null);

    if (member) {
      await member.timeout(null, "Отмена кейса #" + caseNumber);
    }
  } else if (
    moderationCase.type === "MUTE" &&
    moderationCase.targetUserId
  ) {
    const config = await getModerationSettings(runtime.guildId);
    const muteRoleId = stringSetting(config.settings, "muteRoleId");

    if (!muteRoleId) {
      throw new Error("Mute-роль не настроена.");
    }

    const member = await guild.members
      .fetch(moderationCase.targetUserId)
      .catch(() => null);

    if (member?.roles.cache.has(muteRoleId)) {
      await member.roles.remove(
        muteRoleId,
        "Отмена кейса #" + caseNumber
      );
    }
  } else if (
    ["BAN", "TEMP_BAN"].includes(moderationCase.type) &&
    moderationCase.targetUserId
  ) {
    const ban = await guild.bans
      .fetch(moderationCase.targetUserId)
      .catch(() => null);

    if (ban) {
      await guild.members.unban(
        moderationCase.targetUserId,
        "Отмена кейса #" + caseNumber
      );
    }
  } else {
    throw new Error("Это действие нельзя автоматически отменить.");
  }

  const cancelled = await cancelModerationCaseRecord(
    runtime.guildId,
    caseNumber,
    moderatorId
  );

  if (cancelled) {
    await recordModerationCaseEvent(
      runtime,
      cancelled,
      "moderation.case.cancelled"
    );
    return cancelled;
  }

  return moderationCase;
}

async function processDueCases(runtime: ModerationRuntime) {
  const guild =
    runtime.client.guilds.cache.get(runtime.guildId) ??
    (await runtime.client.guilds
      .fetch(runtime.guildId)
      .catch(() => null));

  if (!guild) {
    return;
  }

  const due = await getDueModerationCases(runtime.guildId);

  for (const moderationCase of due) {
    try {
      if (
        moderationCase.type === "TEMP_BAN" &&
        moderationCase.targetUserId
      ) {
        const ban = await guild.bans
          .fetch(moderationCase.targetUserId)
          .catch(() => null);

        if (ban) {
          await guild.members.unban(
            moderationCase.targetUserId,
            "Истёк кейс #" + moderationCase.caseNumber
          );
        }
      }

      if (
        moderationCase.type === "TIMEOUT" &&
        moderationCase.targetUserId
      ) {
        const member = await guild.members
          .fetch(moderationCase.targetUserId)
          .catch(() => null);

        if (member?.isCommunicationDisabled()) {
          await member.timeout(
            null,
            "Истёк кейс #" + moderationCase.caseNumber
          );
        }
      }

      if (
        moderationCase.type === "MUTE" &&
        moderationCase.targetUserId
      ) {
        const config = await getModerationSettings(runtime.guildId);
        const muteRoleId = stringSetting(
          config.settings,
          "muteRoleId"
        );

        if (muteRoleId) {
          const member = await guild.members
            .fetch(moderationCase.targetUserId)
            .catch(() => null);

          if (member?.roles.cache.has(muteRoleId)) {
            await member.roles.remove(
              muteRoleId,
              "Истёк кейс #" + moderationCase.caseNumber
            );
          }
        }
      }

      const expired = await markModerationCaseExpired(
        moderationCase.id
      );
      await recordModerationCaseEvent(
        runtime,
        expired,
        "moderation.case.expired"
      );
    } catch (error) {
      console.error(
        "Не удалось завершить moderation-кейс #" +
          moderationCase.caseNumber,
        error
      );
    }
  }
}

let schedulerStarted = false;

export function startModerationScheduler(runtime: ModerationRuntime) {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;

  void processDueCases(runtime);

  setInterval(() => {
    void processDueCases(runtime);
  }, 30_000).unref();
}
