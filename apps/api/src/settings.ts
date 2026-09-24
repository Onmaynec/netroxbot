import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { MODULES, SETTINGS_CATEGORIES, getModule, getModuleSettingFields } from "@netrox/core";
import { prisma } from "@netrox/database";
import { requireSession, type ApiSession } from "./auth.js";
import { recordSettingsEvent } from "./settings-log.js";

export type SettingsConfig = {
  guildId: string;
  botToken: string;
};

const moduleParamsSchema = z.object({
  moduleKey: z.string().min(1).max(64)
});

const modulePatchSchema = z.object({
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional()
}).refine(
  (value) => value.enabled !== undefined || value.settings !== undefined,
  { message: "Нет изменений для сохранения." }
);

const confirmBodySchema = z.object({
  confirm: z.literal(true)
});

const adminBodySchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/)
});

const adminParamsSchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/)
});

async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  redis: Redis
): Promise<ApiSession | null> {
  const session = await requireSession(request, reply, redis);

  if (!session) {
    return null;
  }

  if (session.level !== "SUPERADMIN") {
    await reply.code(403).send({
      ok: false,
      error: "SUPERADMIN_REQUIRED",
      message: "Это действие доступно только владельцу NetroxBot."
    });
    return null;
  }

  return session;
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: SettingsConfig
) {
  app.get("/api/v1/settings", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const rows = await prisma.moduleConfig.findMany({
      where: { guildId: config.guildId }
    });
    const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

    return {
      ok: true,
      categories: SETTINGS_CATEGORIES,
      modules: MODULES.map((module) => {
        const current = byKey.get(module.key);

        return {
          ...module,
          enabled: current?.enabled ?? module.defaultEnabled,
          settings: current?.settings ?? {},
          fields: getModuleSettingFields(module.key)
        };
      })
    };
  });

  app.patch("/api/v1/settings/modules/:moduleKey", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const params = moduleParamsSchema.safeParse(request.params);
    const body = modulePatchSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_SETTINGS",
        message: "Некорректные параметры настройки."
      });
    }

    const definition = getModule(params.data.moduleKey);

    if (!definition) {
      return reply.code(404).send({
        ok: false,
        error: "MODULE_NOT_FOUND",
        message: "Такого модуля нет."
      });
    }

    const current = await prisma.moduleConfig.findUnique({
      where: {
        guildId_moduleKey: {
          guildId: config.guildId,
          moduleKey: definition.key
        }
      }
    });

    const currentSettings =
      current?.settings &&
      typeof current.settings === "object" &&
      !Array.isArray(current.settings)
        ? (current.settings as Record<string, unknown>)
        : {};

    const nextSettings = body.data.settings
      ? JSON.parse(
          JSON.stringify({
            ...currentSettings,
            ...body.data.settings
          })
        )
      : currentSettings;

    const nextEnabled =
      body.data.enabled ?? current?.enabled ?? definition.defaultEnabled;

    const moduleConfig = await prisma.moduleConfig.upsert({
      where: {
        guildId_moduleKey: {
          guildId: config.guildId,
          moduleKey: definition.key
        }
      },
      update: {
        enabled: nextEnabled,
        settings: nextSettings
      },
      create: {
        guildId: config.guildId,
        moduleKey: definition.key,
        enabled: nextEnabled,
        settings: nextSettings
      }
    });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: body.data.enabled !== undefined
          ? "settings.module.update"
          : "settings.module.parameters",
        targetType: "module",
        targetId: definition.key,
        payload: {
          enabled: moduleConfig.enabled,
          changedSettings: body.data.settings
            ? Object.keys(body.data.settings)
            : [],
          source: "dashboard"
        }
      }
    });

    await recordSettingsEvent({
      guildId: config.guildId,
      botToken: config.botToken,
      eventType:
        body.data.enabled !== undefined
          ? "settings.module.update"
          : "settings.module.parameters",
      summary:
        "Изменены настройки модуля " +
        definition.title +
        " через веб-панель.",
      actorId: session.discordId,
      targetType: "module",
      targetId: definition.key,
      payload: {
        enabled: moduleConfig.enabled,
        changedSettings: body.data.settings
          ? Object.keys(body.data.settings)
          : []
      }
    });

    return {
      ok: true,
      module: {
        ...definition,
        enabled: moduleConfig.enabled,
        settings: moduleConfig.settings,
        fields: getModuleSettingFields(definition.key)
      }
    };
  });

  app.get("/api/v1/admins", async (request, reply) => {
    const session = await requireSuperAdmin(request, reply, redis);

    if (!session) {
      return;
    }

    const admins = await prisma.adminUser.findMany({
      orderBy: [
        { level: "desc" },
        { createdAt: "asc" }
      ]
    });

    return {
      ok: true,
      admins: admins.map((admin) => ({
        discordId: admin.discordId,
        level: admin.level,
        addedBy: admin.addedBy,
        createdAt: admin.createdAt,
        revokedAt: admin.revokedAt
      }))
    };
  });

  app.post("/api/v1/admins", async (request, reply) => {
    const session = await requireSuperAdmin(request, reply, redis);

    if (!session) {
      return;
    }

    const body = adminBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_DISCORD_ID",
        message: "Укажи корректный Discord ID."
      });
    }

    const existing = await prisma.adminUser.findUnique({
      where: { discordId: body.data.discordId }
    });

    const admin = existing
      ? await prisma.adminUser.update({
          where: { discordId: body.data.discordId },
          data: {
            revokedAt: null,
            addedBy: session.discordId
          }
        })
      : await prisma.adminUser.create({
          data: {
            discordId: body.data.discordId,
            level: "ADMIN",
            addedBy: session.discordId
          }
        });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: "admin.grant",
        targetType: "admin",
        targetId: admin.discordId,
        payload: {
          level: admin.level,
          source: "dashboard"
        }
      }
    });

    await recordSettingsEvent({
      guildId: config.guildId,
      botToken: config.botToken,
      eventType: "admin.grant",
      summary: "Выдан доступ администратора NetroxBot.",
      actorId: session.discordId,
      targetType: "admin",
      targetId: admin.discordId,
      payload: {
        level: admin.level
      }
    });

    return {
      ok: true,
      admin: {
        discordId: admin.discordId,
        level: admin.level,
        revokedAt: admin.revokedAt
      }
    };
  });

  app.delete("/api/v1/admins/:discordId", async (request, reply) => {
    const session = await requireSuperAdmin(request, reply, redis);

    if (!session) {
      return;
    }

    const params = adminParamsSchema.safeParse(request.params);
    const confirmation = confirmBodySchema.safeParse(request.body);

    if (!params.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_DISCORD_ID",
        message: "Укажи корректный Discord ID."
      });
    }

    if (!confirmation.success) {
      return reply.code(400).send({
        ok: false,
        error: "CONFIRMATION_REQUIRED",
        message: "Подтверди отзыв доступа перед выполнением."
      });
    }

    const target = await prisma.adminUser.findUnique({
      where: { discordId: params.data.discordId }
    });

    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: "ADMIN_NOT_FOUND",
        message: "Администратор не найден."
      });
    }

    if (target.level === "SUPERADMIN") {
      return reply.code(400).send({
        ok: false,
        error: "SUPERADMIN_PROTECTED",
        message: "Нельзя отозвать доступ у владельца через эту операцию."
      });
    }

    await prisma.adminUser.update({
      where: { discordId: target.discordId },
      data: { revokedAt: new Date() }
    });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: "admin.revoke",
        targetType: "admin",
        targetId: target.discordId,
        payload: {
          source: "dashboard"
        }
      }
    });

    await recordSettingsEvent({
      guildId: config.guildId,
      botToken: config.botToken,
      eventType: "admin.revoke",
      summary: "Отозван доступ администратора NetroxBot.",
      actorId: session.discordId,
      targetType: "admin",
      targetId: target.discordId
    });

    return {
      ok: true
    };
  });

  app.get("/api/v1/audit", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const entries = await prisma.auditLog.findMany({
      where: { guildId: config.guildId },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      ok: true,
      entries
    };
  });
}
