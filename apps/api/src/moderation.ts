
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  getModerationCase,
  getModeratorStats,
  listPendingAppeals,
  prisma
} from "@netrox/database";
import { requireSession } from "./auth.js";

export type ModerationApiConfig = {
  guildId: string;
};

const casesQuerySchema = z.object({
  userId: z.string().regex(/^\d{17,20}$/).optional(),
  moderatorId: z.string().regex(/^\d{17,20}$/).optional(),
  status: z.enum(["ACTIVE", "EXPIRED", "CANCELLED"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50)
});

const caseParamsSchema = z.object({
  caseNumber: z.coerce.number().int().min(1)
});

const statsParamsSchema = z.object({
  moderatorId: z.string().regex(/^\d{17,20}$/)
});

const statsQuerySchema = z.object({
  period: z.enum(["7d", "30d", "all"]).default("30d")
});

const automodQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50)
});

export function registerModerationRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: ModerationApiConfig
) {
  app.get("/api/v1/moderation/cases", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const query = casesQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка кейсов."
      });
    }

    const cases = await prisma.moderationCase.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.userId
          ? { targetUserId: query.data.userId }
          : {}),
        ...(query.data.moderatorId
          ? { moderatorId: query.data.moderatorId }
          : {}),
        ...(query.data.status
          ? { status: query.data.status }
          : {})
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.data.take
    });

    return {
      ok: true,
      cases
    };
  });

  app.get(
    "/api/v1/moderation/cases/:caseNumber",
    async (request, reply) => {
      const session = await requireSession(request, reply, redis);

      if (!session) {
        return;
      }

      const params = caseParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          ok: false,
          error: "INVALID_CASE_NUMBER",
          message: "Некорректный номер кейса."
        });
      }

      const moderationCase = await getModerationCase(
        config.guildId,
        params.data.caseNumber
      );

      if (!moderationCase) {
        return reply.code(404).send({
          ok: false,
          error: "CASE_NOT_FOUND",
          message: "Кейс не найден."
        });
      }

      return {
        ok: true,
        case: moderationCase
      };
    }
  );

  app.get(
    "/api/v1/moderation/stats/:moderatorId",
    async (request, reply) => {
      const session = await requireSession(request, reply, redis);

      if (!session) {
        return;
      }

      const params = statsParamsSchema.safeParse(request.params);
      const query = statsQuerySchema.safeParse(request.query);

      if (!params.success || !query.success) {
        return reply.code(400).send({
          ok: false,
          error: "INVALID_STATS_QUERY",
          message: "Некорректные параметры статистики."
        });
      }

      const since =
        query.data.period === "all"
          ? undefined
          : new Date(
              Date.now() -
                (query.data.period === "7d" ? 7 : 30) *
                  24 *
                  60 *
                  60 *
                  1000
            );

      const stats = await getModeratorStats(
        config.guildId,
        params.data.moderatorId,
        since
      );

      return {
        ok: true,
        period: query.data.period,
        moderatorId: params.data.moderatorId,
        stats
      };
    }
  );

  app.get("/api/v1/moderation/appeals", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const appeals = await listPendingAppeals(config.guildId, 100);

    return {
      ok: true,
      appeals
    };
  });

  app.get("/api/v1/moderation/automod", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const query = automodQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры истории автомода."
      });
    }

    const events = await prisma.automodEvent.findMany({
      where: {
        guildId: config.guildId
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.data.take
    });

    return {
      ok: true,
      events
    };
  });
}
