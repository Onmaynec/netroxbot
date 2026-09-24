import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  listAuditEvents,
  listBackupRecords,
  listServerEvents
} from "@netrox/database";
import { requireSession } from "./auth.js";

export type EventsApiConfig = {
  guildId: string;
};

const eventsQuerySchema = z.object({
  category: z.string().min(1).max(64).optional(),
  eventType: z.string().min(1).max(128).optional(),
  targetId: z.string().min(1).max(128).optional(),
  take: z.coerce.number().int().min(1).max(250).default(100),
  before: z.string().datetime().optional()
});

const auditQuerySchema = z.object({
  action: z.string().min(1).max(128).optional(),
  actorId: z.string().min(1).max(128).optional(),
  take: z.coerce.number().int().min(1).max(250).default(100),
  before: z.string().datetime().optional()
});

const backupsQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(30)
});

export function registerEventsRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: EventsApiConfig
) {
  app.get("/api/v1/events", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const query = eventsQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры журнала событий."
      });
    }

    const events = await listServerEvents({
      guildId: config.guildId,
      ...(query.data.category
        ? { category: query.data.category }
        : {}),
      ...(query.data.eventType
        ? { eventType: query.data.eventType }
        : {}),
      ...(query.data.targetId
        ? { targetId: query.data.targetId }
        : {}),
      take: query.data.take,
      ...(query.data.before
        ? { before: new Date(query.data.before) }
        : {})
    });

    return {
      ok: true,
      events
    };
  });

  app.get("/api/v1/events/audit", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const query = auditQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры аудита."
      });
    }

    const entries = await listAuditEvents({
      guildId: config.guildId,
      ...(query.data.action
        ? { action: query.data.action }
        : {}),
      ...(query.data.actorId
        ? { actorId: query.data.actorId }
        : {}),
      take: query.data.take,
      ...(query.data.before
        ? { before: new Date(query.data.before) }
        : {})
    });

    return {
      ok: true,
      entries
    };
  });

  app.get("/api/v1/backups", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const query = backupsQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка backup."
      });
    }

    const records = await listBackupRecords(query.data.take);

    return {
      ok: true,
      backups: records.map((record) => ({
        ...record,
        sizeBytes:
          record.sizeBytes !== null
            ? record.sizeBytes.toString()
            : null
      }))
    };
  });
}
