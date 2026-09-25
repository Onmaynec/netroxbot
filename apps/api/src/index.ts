import "dotenv/config";
import { randomBytes } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { z } from "zod";
import { prisma } from "@netrox/database";
import { registerAuthRoutes } from "./auth.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerDiscordResourceRoutes } from "./discord.js";
import { registerModerationRoutes } from "./moderation.js";
import { registerEventsRoutes } from "./events.js";
import { registerEconomyRoutes } from "./economy.js";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional()
);

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url().optional()
);

const optionalSessionSecret = z.preprocess(
  emptyToUndefined,
  z.string().min(32).optional()
);

const env = z.object({
  API_PORT: z.coerce.number().default(3001),
  REDIS_URL: z.string().url(),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: optionalText,
  DISCORD_OAUTH_CLIENT_ID: optionalText,
  DISCORD_OAUTH_CLIENT_SECRET: optionalText,
  DISCORD_OAUTH_REDIRECT_URI: optionalUrl,
  PUBLIC_API_URL: optionalUrl,
  PUBLIC_APP_URL: z.string().url(),
  SESSION_SECRET: optionalSessionSecret
}).parse(process.env);

const app = Fastify({ logger: true });

const oauthClientId =
  env.DISCORD_OAUTH_CLIENT_ID ?? env.DISCORD_CLIENT_ID ?? null;
const oauthClientSecret = env.DISCORD_OAUTH_CLIENT_SECRET ?? null;
const publicApiUrl =
  env.PUBLIC_API_URL ?? `http://localhost:${env.API_PORT}`;
const oauthRedirectUri =
  env.DISCORD_OAUTH_REDIRECT_URI ??
  `${publicApiUrl.replace(/\/$/, "")}/auth/discord/callback`;
const sessionSecret =
  env.SESSION_SECRET ?? randomBytes(48).toString("base64url");
const oauthConfigured = Boolean(oauthClientId && oauthClientSecret);

if (!oauthConfigured) {
  app.log.warn(
    "Discord OAuth не настроен: API и бот продолжат работу, но вход в веб-панель будет недоступен."
  );
}

if (!env.SESSION_SECRET) {
  app.log.warn(
    "SESSION_SECRET не задан: создан временный безопасный ключ. После перезапуска активные веб-сессии будут сброшены."
  );
}

const redis = new Redis(env.REDIS_URL, {
  connectTimeout: 1500,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 250, 2000)
});

redis.on("error", (error) => {
  app.log.warn({ error }, "Redis временно недоступен");
});

await app.register(cors, {
  origin: env.PUBLIC_APP_URL,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
});

await registerAuthRoutes(app, redis, {
  clientId: oauthClientId,
  clientSecret: oauthClientSecret,
  redirectUri: oauthRedirectUri,
  publicAppUrl: env.PUBLIC_APP_URL,
  sessionSecret,
  guildId: env.DISCORD_GUILD_ID
});

registerSettingsRoutes(app, redis, {
  guildId: env.DISCORD_GUILD_ID,
  botToken: env.DISCORD_TOKEN
});

registerDiscordResourceRoutes(app, redis, {
  guildId: env.DISCORD_GUILD_ID,
  botToken: env.DISCORD_TOKEN
});

registerModerationRoutes(app, redis, {
  guildId: env.DISCORD_GUILD_ID
});

registerEventsRoutes(app, redis, {
  guildId: env.DISCORD_GUILD_ID
});

registerEconomyRoutes(app, redis, {
  guildId: env.DISCORD_GUILD_ID
});

async function dependencyStatus() {
  const [database, cache] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping()
  ]);

  return {
    database: database.status === "fulfilled",
    redis: cache.status === "fulfilled" && cache.value === "PONG"
  };
}

app.get("/health", async () => ({
  ok: true,
  service: "netrox-api",
  uptimeSeconds: Math.floor(process.uptime())
}));

app.get("/ready", async (_request, reply) => {
  const checks = await dependencyStatus();
  const ok = checks.database && checks.redis;

  if (!ok) {
    reply.code(503);
  }

  return {
    ok,
    service: "netrox-api",
    checks
  };
});

app.get("/api/v1/meta", async () => ({
  bot: "NetroxBot",
  server: "Mothers Fantastic",
  currency: {
    name: "NetCoin",
    short: "NEC",
    emoji: "🪙"
  },
  dashboardAuth: {
    discordOAuthConfigured: oauthConfigured
  }
}));

app.addHook("onClose", async () => {
  await Promise.allSettled([
    prisma.$disconnect(),
    redis.quit()
  ]);
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "Остановка NetroxBot API");
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

await app.listen({ host: "0.0.0.0", port: env.API_PORT });
