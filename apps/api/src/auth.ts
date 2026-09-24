import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import oauthPlugin, { type OAuth2Namespace } from "@fastify/oauth2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { prisma } from "@netrox/database";

declare module "fastify" {
  interface FastifyInstance {
    discordOAuth2: OAuth2Namespace;
  }
}

const SESSION_COOKIE = "netrox_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type ApiSession = {
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  level: "SUPERADMIN" | "ADMIN";
};

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  publicAppUrl: string;
  sessionSecret: string;
  guildId: string;
};

const discordUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional()
});

function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];

  if (!raw) {
    return null;
  }

  const unsigned = request.unsignCookie(raw);

  if (!unsigned.valid || !unsigned.value) {
    return null;
  }

  return unsigned.value;
}

export async function getSession(
  request: FastifyRequest,
  redis: Redis
): Promise<ApiSession | null> {
  const token = readSessionToken(request);

  if (!token) {
    return null;
  }

  const key = `session:${token}`;
  const raw = await redis.get(key);

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as ApiSession;
    await redis.expire(key, SESSION_TTL_SECONDS);
    return session;
  } catch {
    await redis.del(key);
    return null;
  }
}

export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  redis: Redis
): Promise<ApiSession | null> {
  const session = await getSession(request, redis);

  if (!session) {
    await reply.code(401).send({
      ok: false,
      error: "AUTH_REQUIRED",
      message: "Нужно войти через Discord."
    });
    return null;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { discordId: session.discordId }
  });

  if (!admin || admin.revokedAt) {
    await reply.code(403).send({
      ok: false,
      error: "ACCESS_REVOKED",
      message: "Доступ к панели отозван."
    });
    return null;
  }

  return {
    ...session,
    level: admin.level
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: AuthConfig
) {
  const secureCookie = config.publicAppUrl.startsWith("https://");

  await app.register(cookie, {
    secret: config.sessionSecret
  });

  await app.register(oauthPlugin, {
    name: "discordOAuth2",
    scope: ["identify"],
    credentials: {
      client: {
        id: config.clientId,
        secret: config.clientSecret
      },
      auth: {
        authorizeHost: "https://discord.com",
        authorizePath: "/oauth2/authorize",
        tokenHost: "https://discord.com",
        tokenPath: "/api/v10/oauth2/token"
      }
    },
    startRedirectPath: "/auth/discord",
    callbackUri: config.redirectUri,
    cookie: {
      secure: secureCookie,
      sameSite: "lax",
      httpOnly: true
    }
  });

  app.get("/auth/discord/callback", async function (request, reply) {
    try {
      const { token } =
        await this.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(
          request,
          reply
        );

      const userResponse = await fetch(
        "https://discord.com/api/v10/users/@me",
        {
          headers: {
            Authorization: `Bearer ${token.access_token}`
          }
        }
      );

      if (!userResponse.ok) {
        return reply.redirect(
          `${config.publicAppUrl}/?auth=discord_error`
        );
      }

      const user = discordUserSchema.parse(await userResponse.json());
      const admin = await prisma.adminUser.findUnique({
        where: { discordId: user.id }
      });

      if (!admin || admin.revokedAt) {
        app.log.warn(
          { discordId: user.id },
          "Пользователь без доступа попытался войти в панель"
        );

        return reply.redirect(`${config.publicAppUrl}/?auth=denied`);
      }

      const sessionToken = randomBytes(48).toString("base64url");
      const session: ApiSession = {
        discordId: user.id,
        username: user.username,
        globalName: user.global_name ?? null,
        avatar: user.avatar ?? null,
        level: admin.level
      };

      await redis.set(
        `session:${sessionToken}`,
        JSON.stringify(session),
        "EX",
        SESSION_TTL_SECONDS
      );

      await prisma.auditLog.create({
        data: {
          guildId: config.guildId,
          actorId: user.id,
          action: "dashboard.login",
          targetType: "admin",
          targetId: user.id,
          payload: {
            source: "discord_oauth"
          }
        }
      });

      reply.setCookie(SESSION_COOKIE, sessionToken, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookie,
        path: "/",
        maxAge: SESSION_TTL_SECONDS
      });

      return reply.redirect(config.publicAppUrl);
    } catch (error) {
      app.log.warn({ error }, "Не удалось завершить Discord OAuth");
      return reply.redirect(`${config.publicAppUrl}/?auth=discord_error`);
    }
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const session = await requireSession(request, reply, redis);

    if (!session) {
      return;
    }

    return {
      ok: true,
      user: session
    };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = readSessionToken(request);

    if (token) {
      await redis.del(`session:${token}`);
    }

    reply.clearCookie(SESSION_COOKIE, {
      path: "/",
      signed: true
    });

    return {
      ok: true
    };
  });
}
