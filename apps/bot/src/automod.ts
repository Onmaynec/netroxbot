
import {
  EmbedBuilder,
  Message,
  PermissionFlagsBits
} from "discord.js";
import {
  createModerationCase,
  prisma,
  recordAutomodEvent
} from "@netrox/database";
import {
  booleanSetting,
  createUserCaseAndExecute,
  getModerationSettings,
  numberSetting,
  sendCaseLog,
  sendPunishmentDm,
  stringSetting,
  type ModerationRuntime
} from "./moderation-service.js";

type AutomodConfig = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

type RuleTrigger = {
  key: string;
  label: string;
};

const DEFAULT_PROFANITY_ROOTS = [
  "бляд",
  "сука",
  "хуй",
  "хуе",
  "пизд",
  "ебан",
  "ёбан",
  "ебат",
  "мудак"
];

const spamWindows = new Map<string, number[]>();
const repeatedMessages = new Map<
  string,
  { text: string; count: number; at: number }
>();

let configCache:
  | {
      guildId: string;
      expiresAt: number;
      value: AutomodConfig;
    }
  | null = null;

async function getAutomodConfig(
  guildId: string
): Promise<AutomodConfig> {
  if (
    configCache &&
    configCache.guildId === guildId &&
    configCache.expiresAt > Date.now()
  ) {
    return configCache.value;
  }

  const row = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "automod"
      }
    }
  });

  const value: AutomodConfig = {
    enabled: row?.enabled ?? true,
    settings:
      row?.settings &&
      typeof row.settings === "object" &&
      !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {}
  };

  configCache = {
    guildId,
    expiresAt: Date.now() + 10_000,
    value
  };

  return value;
}

function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsProfanity(
  normalized: string,
  settings: Record<string, unknown>
): boolean {
  if (!normalized) {
    return false;
  }

  const custom = stringSetting(
    settings,
    "customBlockedWords"
  );

  const customWords = custom
    ? custom
        .split(",")
        .map((word) => normalizeText(word))
        .filter(Boolean)
    : [];

  const words = [
    ...DEFAULT_PROFANITY_ROOTS,
    ...customWords
  ];

  return words.some((word) => normalized.includes(word));
}

function capsRatio(content: string): number {
  const letters = content.match(/\p{L}/gu) ?? [];

  if (letters.length < 8) {
    return 0;
  }

  const upper = letters.filter(
    (letter) =>
      letter === letter.toUpperCase() &&
      letter !== letter.toLowerCase()
  ).length;

  return (upper / letters.length) * 100;
}

function detectSpam(
  message: Message,
  settings: Record<string, unknown>
): boolean {
  const windowSeconds = Math.max(
    2,
    numberSetting(settings, "spamWindowSeconds", 8)
  );
  const limit = Math.max(
    2,
    numberSetting(settings, "spamMessageLimit", 6)
  );

  const key = message.guildId + ":" + message.author.id;
  const now = Date.now();
  const threshold = now - windowSeconds * 1000;

  const current = (spamWindows.get(key) ?? []).filter(
    (time) => time >= threshold
  );

  current.push(now);
  spamWindows.set(key, current);

  return current.length > limit;
}

function detectFlood(message: Message): boolean {
  const normalized = normalizeText(message.content);

  if (!normalized) {
    return false;
  }

  if (/(.)\1{11,}/u.test(normalized.replace(/\s/g, ""))) {
    return true;
  }

  const key = message.guildId + ":" + message.author.id;
  const previous = repeatedMessages.get(key);
  const now = Date.now();

  if (
    previous &&
    previous.text === normalized &&
    now - previous.at <= 20_000
  ) {
    const next = {
      text: normalized,
      count: previous.count + 1,
      at: now
    };

    repeatedMessages.set(key, next);
    return next.count >= 3;
  }

  repeatedMessages.set(key, {
    text: normalized,
    count: 1,
    at: now
  });

  return false;
}

function detectRules(
  message: Message,
  settings: Record<string, unknown>
): RuleTrigger[] {
  const triggers: RuleTrigger[] = [];
  const content = message.content;
  const normalized = normalizeText(content);

  const invitePattern =
    /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
  const linkPattern = /https?:\/\/[^\s]+/i;

  if (
    booleanSetting(settings, "antiInvites", true) &&
    invitePattern.test(content)
  ) {
    triggers.push({
      key: "invites",
      label: "Discord-приглашение"
    });
  }

  if (
    booleanSetting(settings, "antiLinks", false) &&
    linkPattern.test(content) &&
    !invitePattern.test(content)
  ) {
    triggers.push({
      key: "links",
      label: "внешняя ссылка"
    });
  }

  if (
    booleanSetting(settings, "antiProfanity", true) &&
    containsProfanity(normalized, settings)
  ) {
    triggers.push({
      key: "profanity",
      label: "запрещённая лексика"
    });
  }

  if (
    booleanSetting(settings, "antiCaps", true) &&
    capsRatio(content) >=
      numberSetting(settings, "capsPercent", 75)
  ) {
    triggers.push({
      key: "caps",
      label: "чрезмерный капс"
    });
  }

  if (
    booleanSetting(settings, "antiSpam", true) &&
    detectSpam(message, settings)
  ) {
    triggers.push({
      key: "spam",
      label: "спам"
    });
  }

  if (
    booleanSetting(settings, "antiFlood", true) &&
    detectFlood(message)
  ) {
    triggers.push({
      key: "flood",
      label: "флуд"
    });
  }

  const mentionCount =
    message.mentions.users.size +
    message.mentions.roles.size +
    (message.mentions.everyone ? 1 : 0);

  if (
    booleanSetting(settings, "antiMassMentions", true) &&
    mentionCount >
      numberSetting(settings, "maxMentions", 6)
  ) {
    triggers.push({
      key: "mass_mentions",
      label: "массовые упоминания"
    });
  }

  return triggers;
}

async function sendAutomodLog(
  runtime: ModerationRuntime,
  message: Message,
  config: AutomodConfig,
  triggers: RuleTrigger[],
  action: string
) {
  if (!message.guild) {
    return;
  }

  const channelId = stringSetting(
    config.settings,
    "logChannelId"
  );

  if (!channelId) {
    return;
  }

  const channel = await message.guild.channels
    .fetch(channelId)
    .catch(() => null);

  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  const excerpt =
    message.content.length > 500
      ? message.content.slice(0, 497) + "…"
      : message.content;

  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("Автомодерация")
          .addFields(
            {
              name: "Пользователь",
              value: "<@" + message.author.id + ">",
              inline: true
            },
            {
              name: "Канал",
              value: "<#" + message.channelId + ">",
              inline: true
            },
            {
              name: "Правила",
              value: triggers
                .map((trigger) => trigger.label)
                .join(", ")
            },
            {
              name: "Действие",
              value: action,
              inline: true
            },
            {
              name: "Сообщение",
              value: excerpt || "Без текста"
            }
          )
          .setTimestamp()
      ]
    })
    .catch(() => undefined);
}

async function warnFromAutomod(
  runtime: ModerationRuntime,
  message: Message,
  reason: string
) {
  const moderationCase = await createModerationCase({
    guildId: runtime.guildId,
    moderatorId: runtime.client.user?.id ?? "automod",
    type: "WARN",
    targetUserId: message.author.id,
    reason,
    dmDelivered: null,
    evidence: {
      source: "automod",
      channelId: message.channelId,
      messageId: message.id
    }
  });

  const moderationSettings = await getModerationSettings(
    runtime.guildId
  );

  let dmDelivered: boolean | null = null;

  if (
    booleanSetting(
      moderationSettings.settings,
      "dmOnAction",
      true
    )
  ) {
    dmDelivered = await sendPunishmentDm(
      runtime,
      message.author.id,
      moderationCase
    );
  }

  const updated = await prisma.moderationCase.update({
    where: { id: moderationCase.id },
    data: { dmDelivered }
  });

  await sendCaseLog(runtime, updated);
}

async function timeoutFromAutomod(
  runtime: ModerationRuntime,
  message: Message,
  settings: Record<string, unknown>,
  reason: string
) {
  const member = message.member;

  if (!member?.moderatable) {
    await warnFromAutomod(runtime, message, reason);
    return;
  }

  const minutes = Math.max(
    1,
    Math.floor(
      numberSetting(settings, "timeoutMinutes", 10)
    )
  );

  const durationSeconds = Math.min(
    minutes * 60,
    28 * 24 * 60 * 60
  );

  await createUserCaseAndExecute(runtime, {
    moderatorId: runtime.client.user?.id ?? "automod",
    type: "TIMEOUT",
    targetUserId: message.author.id,
    reason,
    durationSeconds,
    execute: () =>
      member.timeout(durationSeconds * 1000, reason)
  });
}

export async function handleAutomodMessage(
  message: Message,
  runtime: ModerationRuntime
) {
  if (
    !message.guild ||
    message.guild.id !== runtime.guildId ||
    message.author.bot ||
    message.webhookId
  ) {
    return;
  }

  const config = await getAutomodConfig(runtime.guildId);

  if (!config.enabled) {
    return;
  }

  if (
    message.member?.permissions.has(
      PermissionFlagsBits.ManageMessages
    )
  ) {
    return;
  }

  const exemptRoleIds = [
    "exemptRoleId",
    "exemptRoleId2",
    "exemptRoleId3"
  ]
    .map((key) => stringSetting(config.settings, key))
    .filter((value): value is string => Boolean(value));

  if (
    message.member &&
    exemptRoleIds.some((roleId) =>
      message.member!.roles.cache.has(roleId)
    )
  ) {
    return;
  }

  const exemptChannelIds = [
    "exemptChannelId",
    "exemptChannelId2",
    "exemptChannelId3"
  ]
    .map((key) => stringSetting(config.settings, key))
    .filter((value): value is string => Boolean(value));

  if (exemptChannelIds.includes(message.channelId)) {
    return;
  }

  const triggers = detectRules(message, config.settings);

  if (triggers.length === 0) {
    return;
  }

  const action =
    stringSetting(config.settings, "action") ?? "warn";
  const reason =
    "Автомод: " +
    triggers.map((trigger) => trigger.label).join(", ");

  if (
    booleanSetting(config.settings, "deleteMessage", true) &&
    message.deletable
  ) {
    await message.delete().catch(() => undefined);
  }

  for (const trigger of triggers) {
    await recordAutomodEvent({
      guildId: runtime.guildId,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      ruleKey: trigger.key,
      action,
      metadata: {
        messageLength: message.content.length,
        triggerCount: triggers.length
      }
    });
  }

  if (action === "timeout") {
    await timeoutFromAutomod(
      runtime,
      message,
      config.settings,
      reason
    );
  } else if (action === "warn") {
    await warnFromAutomod(runtime, message, reason);
  }

  await sendAutomodLog(
    runtime,
    message,
    config,
    triggers,
    action
  );
}
