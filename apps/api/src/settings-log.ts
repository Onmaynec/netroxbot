import { prisma, recordServerEvent } from "@netrox/database";

export type SettingsEventInput = {
  guildId: string;
  botToken: string;
  eventType: string;
  summary: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
};

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

export async function recordSettingsEvent(input: SettingsEventInput) {
  const stored = await recordServerEvent({
    guildId: input.guildId,
    category: "settings",
    eventType: input.eventType,
    summary: input.summary,
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    payload: input.payload ?? null
  });

  const logs = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId: input.guildId,
        moduleKey: "logs"
      }
    }
  });

  if (logs && !logs.enabled) {
    return stored;
  }

  const settings = record(logs?.settings);
  const channelId =
    stringSetting(settings, "settingsChannelId") ??
    stringSetting(settings, "channelId");

  if (!channelId) {
    return stored;
  }

  const details = input.payload
    ? JSON.stringify(input.payload, null, 2).slice(0, 900)
    : null;

  const fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }> = [];

  if (input.actorId) {
    fields.push({
      name: "Инициатор",
      value: "<@" + input.actorId + ">",
      inline: true
    });
  }

  if (input.targetId) {
    fields.push({
      name: "Цель",
      value: input.targetId,
      inline: true
    });
  }

  if (details) {
    fields.push({
      name: "Детали",
      value: details
    });
  }

  const response = await fetch(
    "https://discord.com/api/v10/channels/" +
      channelId +
      "/messages",
    {
      method: "POST",
      headers: {
        Authorization: "Bot " + input.botToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        embeds: [
          {
            color: 5763719,
            title: "Настройки • " + input.eventType,
            description: input.summary,
            fields,
            footer: {
              text: "Event ID: " + stored.id
            },
            timestamp: stored.occurredAt.toISOString()
          }
        ]
      })
    }
  );

  if (!response.ok) {
    console.warn(
      "Не удалось отправить settings log в Discord:",
      response.status
    );
  }

  return stored;
}
