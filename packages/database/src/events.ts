import { prisma } from "./client.js";

export type ServerEventInput = {
  guildId: string;
  category: string;
  eventType: string;
  summary: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date;
};

export async function recordServerEvent(input: ServerEventInput) {
  return prisma.serverEvent.create({
    data: {
      guildId: input.guildId,
      category: input.category,
      eventType: input.eventType,
      summary: input.summary,
      actorId: input.actorId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      channelId: input.channelId ?? null,
      messageId: input.messageId ?? null,
      payload: input.payload
        ? JSON.parse(JSON.stringify(input.payload))
        : undefined,
      occurredAt: input.occurredAt ?? new Date()
    }
  });
}

export async function listServerEvents(input: {
  guildId: string;
  category?: string;
  eventType?: string;
  targetId?: string;
  take?: number;
  before?: Date;
}) {
  const take = Math.max(1, Math.min(input.take ?? 100, 250));

  return prisma.serverEvent.findMany({
    where: {
      guildId: input.guildId,
      ...(input.category ? { category: input.category } : {}),
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.before
        ? {
            occurredAt: {
              lt: input.before
            }
          }
        : {})
    },
    orderBy: {
      occurredAt: "desc"
    },
    take
  });
}

export async function listAuditEvents(input: {
  guildId: string;
  action?: string;
  actorId?: string;
  take?: number;
  before?: Date;
}) {
  const take = Math.max(1, Math.min(input.take ?? 100, 250));

  return prisma.auditLog.findMany({
    where: {
      guildId: input.guildId,
      ...(input.action ? { action: input.action } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.before
        ? {
            createdAt: {
              lt: input.before
            }
          }
        : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take
  });
}

export async function listBackupRecords(take = 30) {
  return prisma.backupRecord.findMany({
    orderBy: {
      startedAt: "desc"
    },
    take: Math.max(1, Math.min(take, 100))
  });
}
