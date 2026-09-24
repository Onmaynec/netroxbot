import "dotenv/config";
import Fastify from "fastify";
import { z } from "zod";

const env = z.object({
  API_PORT: z.coerce.number().default(3001)
}).parse(process.env);

const app = Fastify({ logger: true });

app.get("/health", async () => ({
  ok: true,
  service: "netrox-api"
}));

app.get("/api/v1/meta", async () => ({
  bot: "NetroxBot",
  server: "Mothers Fantastic",
  currency: {
    name: "NetCoin",
    short: "NEC",
    emoji: "🪙"
  }
}));

await app.listen({ host: "0.0.0.0", port: env.API_PORT });
