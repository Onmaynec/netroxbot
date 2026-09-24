import "dotenv/config";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { z } from "zod";
import { prisma } from "@netrox/database";

const env = z.object({
  API_PORT: z.coerce.number().default(3001),
  REDIS_URL: z.string().url()
}).parse(process.env);

const app = Fastify({ logger: true });

const redis = new Redis(env.REDIS_URL, {
  connectTimeout: 1500,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 250, 2000)
});

redis.on("error", (error) => {
  app.log.warn({ error }, "Redis временно недоступен");
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
