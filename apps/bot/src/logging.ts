import {
  Client,
  EmbedBuilder,
  GuildChannel,
  GuildMember,
  Message,
  PartialGuildMember,
  Role,
  VoiceState
} from "discord.js";
import { prisma, recordServerEvent } from "@netrox/database";

type LogConfig = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

type LogCategory =
  | "messages"
  | "members"
  | "voice"
  | "server"
  | "moderation"
  | "settings";

type EmitInput = {
  category: LogCategory;
  eventType: string;
  summary: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  payload?: Record<string, unknown> | null;
  color?: number;
};

const CATEGORY_CHANNEL_KEYS: Record<LogCategory, string> = {
  messages: "messageChannelId",
  members: "memberChannelId",
  voice: "voiceChannelId",
  server: "serverChannelId",
  moderation: "moderationChannelId",
  settings: "settingsChannelId"
};

const CATEGORY_TOGGLES: Partial<Record<LogCategory, string>> = {
  messages: "messageLogs",
  members: "memberLogs",
  voice: "voiceLogs",
  server: "serverLogs"
};

const CATEGORY_NAMES: Record<LogCategory, string> = {
  messages: "Сообщения",
  members: "Участники",
  voice: "Голосовые каналы",
  server: "Сервер",
  moderation: "Модерация",
  settings: "Настройки"
};

let cache:
  | {
      guildId: string;
      expiresAt: number;
      value: LogConfig;
    }
  | null = null;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function stringSetting(
  settings: Record<string, unknown>,
  key: string
): string | null {
  const value = settings[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

async function getLogConfig(guildId: string): Promise<LogConfig> {
  if (
    cache &&
    cache.guildId === guildId &&
    cache.expiresAt > Date.now()
  ) {
    return cache.value;
  }

  const row = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "logs"
      }
    }
  });

  const value: LogConfig = {
    enabled: row?.enabled ?? true,
    settings: record(row?.settings)
  };

  cache = {
    guildId,
    expiresAt: Date.now() + 10_000,
    value
  };

  return value;
}

function shortJson(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return null;
  }

  const raw = JSON.stringify(payload, null, 2);

  if (raw.length <= 900) {
    return raw;
  }

  return raw.slice(0, 897) + "…";
}

export async function emitServerLog(
  client: Client,
  guildId: string,
  input: EmitInput
) {
  const config = await getLogConfig(guildId);

  if (!config.enabled) {
    return;
  }

  const toggleKey = CATEGORY_TOGGLES[input.category];

  if (
    toggleKey &&
    !booleanSetting(config.settings, toggleKey, true)
  ) {
    return;
  }

  const stored = await recordServerEvent({
    guildId,
    category: input.category,
    eventType: input.eventType,
    summary: input.summary,
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    channelId: input.channelId ?? null,
    messageId: input.messageId ?? null,
    payload: input.payload ?? null
  });

  const channelId =
    stringSetting(
      config.settings,
      CATEGORY_CHANNEL_KEYS[input.category]
    ) ?? stringSetting(config.settings, "channelId");

  if (!channelId) {
    return;
  }

  const guild =
    client.guilds.cache.get(guildId) ??
    (await client.guilds.fetch(guildId).catch(() => null));

  if (!guild) {
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(input.color ?? 0x57f287)
    .setTitle(
      CATEGORY_NAMES[input.category] + " • " + input.eventType
    )
    .setDescription(input.summary)
    .setFooter({ text: "Event ID: " + stored.id })
    .setTimestamp(stored.occurredAt);

  if (input.actorId) {
    embed.addFields({
      name: "Инициатор",
      value: "<@" + input.actorId + ">",
      inline: true
    });
  }

  if (input.targetId) {
    embed.addFields({
      name: "Цель",
      value:
        input.targetType === "user"
          ? "<@" + input.targetId + ">"
          : input.targetType === "channel"
            ? "<#" + input.targetId + ">"
            : input.targetType === "role"
              ? "<@&" + input.targetId + ">"
              : input.targetId,
      inline: true
    });
  }

  const payload = shortJson(input.payload);

  if (payload) {
    embed.addFields({
      name: "Детали",
      value: payload
    });
  }

  await channel.send({ embeds: [embed] }).catch(() => undefined);
}

function channelSnapshot(channel: GuildChannel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position
  };
}

function roleSnapshot(role: Role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    mentionable: role.mentionable,
    hoist: role.hoist
  };
}

function memberRoleIds(member: GuildMember | PartialGuildMember) {
  return member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .map((role) => role.id)
    .sort();
}

async function logMessageDelete(
  client: Client,
  guildId: string,
  message: Message
) {
  if (!message.guild || message.guild.id !== guildId) {
    return;
  }

  const config = await getLogConfig(guildId);
  const storeContent = booleanSetting(
    config.settings,
    "storeMessageContent",
    true
  );

  await emitServerLog(client, guildId, {
    category: "messages",
    eventType: "message.delete",
    summary:
      "Удалено сообщение" +
      (message.author ? " от " + message.author.tag : "") +
      ".",
    actorId: message.author?.id ?? null,
    targetType: "user",
    targetId: message.author?.id ?? null,
    channelId: message.channelId,
    messageId: message.id,
    payload: {
      content: storeContent ? message.content || null : null,
      attachments: [...message.attachments.values()].map((item) => ({
        id: item.id,
        name: item.name,
        url: item.url,
        size: item.size
      }))
    },
    color: 0xed4245
  });
}

async function logMessageUpdate(
  client: Client,
  guildId: string,
  oldMessage: Message,
  newMessage: Message
) {
  if (!newMessage.guild || newMessage.guild.id !== guildId) {
    return;
  }

  if (
    oldMessage.content === newMessage.content &&
    oldMessage.attachments.size === newMessage.attachments.size
  ) {
    return;
  }

  const config = await getLogConfig(guildId);
  const storeContent = booleanSetting(
    config.settings,
    "storeMessageContent",
    true
  );

  await emitServerLog(client, guildId, {
    category: "messages",
    eventType: "message.update",
    summary:
      "Изменено сообщение" +
      (newMessage.author ? " от " + newMessage.author.tag : "") +
      ".",
    actorId: newMessage.author?.id ?? null,
    targetType: "user",
    targetId: newMessage.author?.id ?? null,
    channelId: newMessage.channelId,
    messageId: newMessage.id,
    payload: {
      before: storeContent ? oldMessage.content || null : null,
      after: storeContent ? newMessage.content || null : null,
      jumpUrl: newMessage.url
    },
    color: 0xfee75c
  });
}

async function logMemberUpdate(
  client: Client,
  guildId: string,
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  if (newMember.guild.id !== guildId) {
    return;
  }

  const changes: Record<string, unknown> = {};

  if (oldMember.nickname !== newMember.nickname) {
    changes.nickname = {
      before: oldMember.nickname,
      after: newMember.nickname
    };
  }

  const oldRoles = memberRoleIds(oldMember);
  const newRoles = memberRoleIds(newMember);

  if (oldRoles.join(",") !== newRoles.join(",")) {
    changes.roles = {
      added: newRoles.filter((id) => !oldRoles.includes(id)),
      removed: oldRoles.filter((id) => !newRoles.includes(id))
    };
  }

  if (Object.keys(changes).length === 0) {
    return;
  }

  await emitServerLog(client, guildId, {
    category: "members",
    eventType: "member.update",
    summary: "Изменены данные участника " + newMember.user.tag + ".",
    targetType: "user",
    targetId: newMember.id,
    payload: changes,
    color: 0x5865f2
  });
}

async function logVoiceUpdate(
  client: Client,
  guildId: string,
  oldState: VoiceState,
  newState: VoiceState
) {
  if (newState.guild.id !== guildId) {
    return;
  }

  if (oldState.channelId === newState.channelId) {
    if (
      oldState.serverMute === newState.serverMute &&
      oldState.serverDeaf === newState.serverDeaf
    ) {
      return;
    }

    await emitServerLog(client, guildId, {
      category: "voice",
      eventType: "voice.state",
      summary: "Изменено серверное состояние участника в голосовом канале.",
      targetType: "user",
      targetId: newState.id,
      channelId: newState.channelId,
      payload: {
        serverMute: {
          before: oldState.serverMute,
          after: newState.serverMute
        },
        serverDeaf: {
          before: oldState.serverDeaf,
          after: newState.serverDeaf
        }
      },
      color: 0x5865f2
    });

    return;
  }

  const eventType = !oldState.channelId
    ? "voice.join"
    : !newState.channelId
      ? "voice.leave"
      : "voice.move";

  await emitServerLog(client, guildId, {
    category: "voice",
    eventType,
    summary:
      eventType === "voice.join"
        ? "Участник вошёл в голосовой канал."
        : eventType === "voice.leave"
          ? "Участник вышел из голосового канала."
          : "Участник перемещён между голосовыми каналами.",
    targetType: "user",
    targetId: newState.id,
    channelId: newState.channelId ?? oldState.channelId,
    payload: {
      beforeChannelId: oldState.channelId,
      afterChannelId: newState.channelId
    },
    color: 0x5865f2
  });
}

export function registerServerLogging(client: Client, guildId: string) {
  client.on("messageDelete", async (message) => {
    try {
      if (message.partial) {
        await message.fetch().catch(() => undefined);
      }

      await logMessageDelete(client, guildId, message as Message);
    } catch (error) {
      console.error("Ошибка message.delete лога", error);
    }
  });

  client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
      if (oldMessage.partial) {
        await oldMessage.fetch().catch(() => undefined);
      }

      if (newMessage.partial) {
        await newMessage.fetch().catch(() => undefined);
      }

      await logMessageUpdate(
        client,
        guildId,
        oldMessage as Message,
        newMessage as Message
      );
    } catch (error) {
      console.error("Ошибка message.update лога", error);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      if (member.guild.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "members",
        eventType: "member.join",
        summary: "На сервер вошёл " + member.user.tag + ".",
        targetType: "user",
        targetId: member.id,
        payload: {
          accountCreatedAt: member.user.createdAt.toISOString(),
          joinedAt: member.joinedAt?.toISOString() ?? null
        },
        color: 0x57f287
      });
    } catch (error) {
      console.error("Ошибка member.join лога", error);
    }
  });

  client.on("guildMemberRemove", async (member) => {
    try {
      if (member.guild.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "members",
        eventType: "member.leave",
        summary: "С сервера ушёл " + member.user.tag + ".",
        targetType: "user",
        targetId: member.id,
        payload: {
          roles: memberRoleIds(member)
        },
        color: 0xed4245
      });
    } catch (error) {
      console.error("Ошибка member.leave лога", error);
    }
  });

  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      await logMemberUpdate(client, guildId, oldMember, newMember);
    } catch (error) {
      console.error("Ошибка member.update лога", error);
    }
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      await logVoiceUpdate(client, guildId, oldState, newState);
    } catch (error) {
      console.error("Ошибка voice лога", error);
    }
  });

  client.on("channelCreate", async (channel) => {
    try {
      if (!("guild" in channel) || channel.guild.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "channel.create",
        summary: "Создан канал #" + channel.name + ".",
        targetType: "channel",
        targetId: channel.id,
        channelId: channel.id,
        payload: channelSnapshot(channel),
        color: 0x57f287
      });
    } catch (error) {
      console.error("Ошибка channel.create лога", error);
    }
  });

  client.on("channelDelete", async (channel) => {
    try {
      if (!("guild" in channel) || channel.guild.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "channel.delete",
        summary: "Удалён канал #" + channel.name + ".",
        targetType: "channel",
        targetId: channel.id,
        payload: channelSnapshot(channel),
        color: 0xed4245
      });
    } catch (error) {
      console.error("Ошибка channel.delete лога", error);
    }
  });

  client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
      if (
        !("guild" in newChannel) ||
        newChannel.guild.id !== guildId ||
        !("guild" in oldChannel)
      ) {
        return;
      }

      const before = channelSnapshot(oldChannel);
      const after = channelSnapshot(newChannel);

      if (JSON.stringify(before) === JSON.stringify(after)) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "channel.update",
        summary: "Изменён канал #" + newChannel.name + ".",
        targetType: "channel",
        targetId: newChannel.id,
        channelId: newChannel.id,
        payload: { before, after },
        color: 0xfee75c
      });
    } catch (error) {
      console.error("Ошибка channel.update лога", error);
    }
  });

  client.on("roleCreate", async (role) => {
    try {
      if (role.guild.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "role.create",
        summary: "Создана роль " + role.name + ".",
        targetType: "role",
        targetId: role.id,
        payload: roleSnapshot(role),
        color: 0x57f287
      });
    } catch (error) {
      console.error("Ошибка role.create лога", error);
    }
  });

  client.on("roleDelete", async (role) => {
    try {
      if (role.guild.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "role.delete",
        summary: "Удалена роль " + role.name + ".",
        targetType: "role",
        targetId: role.id,
        payload: roleSnapshot(role),
        color: 0xed4245
      });
    } catch (error) {
      console.error("Ошибка role.delete лога", error);
    }
  });

  client.on("roleUpdate", async (oldRole, newRole) => {
    try {
      if (newRole.guild.id !== guildId) return;

      const before = roleSnapshot(oldRole);
      const after = roleSnapshot(newRole);

      if (JSON.stringify(before) === JSON.stringify(after)) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "role.update",
        summary: "Изменена роль " + newRole.name + ".",
        targetType: "role",
        targetId: newRole.id,
        payload: { before, after },
        color: 0xfee75c
      });
    } catch (error) {
      console.error("Ошибка role.update лога", error);
    }
  });

  client.on("inviteCreate", async (invite) => {
    try {
      if (invite.guild?.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "invite.create",
        summary: "Создано приглашение " + invite.code + ".",
        actorId: invite.inviter?.id ?? null,
        targetType: "invite",
        targetId: invite.code,
        channelId: invite.channelId,
        payload: {
          code: invite.code,
          maxUses: invite.maxUses,
          maxAge: invite.maxAge,
          temporary: invite.temporary
        },
        color: 0x57f287
      });
    } catch (error) {
      console.error("Ошибка invite.create лога", error);
    }
  });

  client.on("inviteDelete", async (invite) => {
    try {
      if (invite.guild?.id !== guildId) return;

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "invite.delete",
        summary: "Удалено приглашение " + invite.code + ".",
        targetType: "invite",
        targetId: invite.code,
        channelId: invite.channelId,
        payload: {
          code: invite.code
        },
        color: 0xed4245
      });
    } catch (error) {
      console.error("Ошибка invite.delete лога", error);
    }
  });

  client.on("webhooksUpdate", async (channel) => {
    try {
      if (channel.guild.id !== guildId) return;

      const hooks = await channel.fetchWebhooks().catch(() => null);

      await emitServerLog(client, guildId, {
        category: "server",
        eventType: "webhook.update",
        summary: "Изменены webhook канала #" + channel.name + ".",
        targetType: "channel",
        targetId: channel.id,
        channelId: channel.id,
        payload: {
          webhooks:
            hooks?.map((hook) => ({
              id: hook.id,
              name: hook.name,
              ownerId: hook.owner?.id ?? null
            })) ?? null
        },
        color: 0xfee75c
      });
    } catch (error) {
      console.error("Ошибка webhook лога", error);
    }
  });
}
