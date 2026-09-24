import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { requireSession } from "./auth.js";

export type DiscordResourcesConfig = {
  guildId: string;
  botToken: string;
};

const channelSchema = z.object({
  id: z.string(),
  name: z.string().optional().default("Без названия"),
  type: z.number(),
  position: z.number().optional().default(0),
  parent_id: z.string().nullable().optional()
});

const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().optional().default(0),
  position: z.number().optional().default(0),
  managed: z.boolean().optional().default(false)
});

export function registerDiscordResourceRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: DiscordResourcesConfig
) {
  app.get("/api/v1/discord/resources", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    const cacheKey = `discord:resources:${config.guildId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const headers = {
      Authorization: `Bot ${config.botToken}`
    };

    const [channelsResponse, rolesResponse] = await Promise.all([
      fetch(
        `https://discord.com/api/v10/guilds/${config.guildId}/channels`,
        { headers }
      ),
      fetch(
        `https://discord.com/api/v10/guilds/${config.guildId}/roles`,
        { headers }
      )
    ]);

    if (!channelsResponse.ok || !rolesResponse.ok) {
      app.log.warn(
        {
          channelsStatus: channelsResponse.status,
          rolesStatus: rolesResponse.status
        },
        "Не удалось получить каналы или роли Discord"
      );

      return reply.code(502).send({
        ok: false,
        error: "DISCORD_RESOURCES_UNAVAILABLE",
        message: "Discord временно не отдал список каналов или ролей."
      });
    }

    const channels = z
      .array(channelSchema)
      .parse(await channelsResponse.json())
      .sort((a, b) => a.position - b.position)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parent_id ?? null
      }));

    const roles = z
      .array(roleSchema)
      .parse(await rolesResponse.json())
      .filter((role) => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        managed: role.managed
      }));

    const payload = {
      ok: true,
      channels,
      roles
    };

    await redis.set(cacheKey, JSON.stringify(payload), "EX", 60);

    return payload;
  });
}
