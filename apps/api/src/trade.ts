import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  cancelAuction,
  createLotteryRound,
  createServerAuction,
  prisma
} from "@netrox/database";
import { requireSession } from "./auth.js";

export type TradeApiConfig = {
  guildId: string;
};

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().min(1).max(32).optional()
});

const serverAuctionBodySchema = z.object({
  itemDefinitionId: z.string().min(1).max(128),
  startPrice: z.string().regex(/^\d+$/),
  minIncrement: z.string().regex(/^\d+$/),
  buyoutPrice: z.string().regex(/^\d+$/).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime()
});

const lotteryBodySchema = z.object({
  title: z.string().min(1).max(80),
  ticketPrice: z.string().regex(/^\d+$/),
  maxTickets: z.number().int().positive().nullable().optional(),
  maxTicketsPerUser: z.number().int().positive().nullable().optional(),
  feePercent: z.number().min(0).max(100).default(5),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime()
});

const idParamsSchema = z.object({
  id: z.string().min(1).max(128)
});

const confirmSchema = z.object({
  confirm: z.literal(true)
});

function serializeBigInts<T>(value: T): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeBigInts(entry));
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value;
    }

    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(object).map(([key, entry]) => [
        key,
        serializeBigInts(entry)
      ])
    );
  }

  return value;
}

export function registerTradeRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: TradeApiConfig
) {
  app.get("/api/v1/trade/overview", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const [
      activeListings,
      activeAuctions,
      activeGames,
      activeLotteries,
      heldEscrows,
      escrowAggregate
    ] = await Promise.all([
      prisma.economyMarketplaceListing.count({
        where: {
          guildId: config.guildId,
          status: "ACTIVE"
        }
      }),
      prisma.economyAuction.count({
        where: {
          guildId: config.guildId,
          status: { in: ["SCHEDULED", "ACTIVE", "SETTLING"] }
        }
      }),
      prisma.economyGameSession.count({
        where: {
          guildId: config.guildId,
          status: { in: ["WAITING", "ACTIVE", "SETTLING"] }
        }
      }),
      prisma.economyLotteryRound.count({
        where: {
          guildId: config.guildId,
          status: { in: ["SCHEDULED", "ACTIVE", "SETTLING"] }
        }
      }),
      prisma.economyEscrow.count({
        where: {
          guildId: config.guildId,
          status: "HELD"
        }
      }),
      prisma.economyEscrow.aggregate({
        where: {
          guildId: config.guildId,
          status: "HELD"
        },
        _sum: {
          amount: true
        }
      })
    ]);

    return {
      ok: true,
      overview: {
        activeListings,
        activeAuctions,
        activeGames,
        activeLotteries,
        heldEscrows,
        heldNec: (escrowAggregate._sum.amount ?? 0n).toString()
      }
    };
  });

  app.get("/api/v1/trade/marketplace", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = listQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка объявлений."
      });
    }

    const listings = await prisma.economyMarketplaceListing.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.status
          ? { status: query.data.status }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.data.take
    });

    return {
      ok: true,
      listings: serializeBigInts(listings)
    };
  });

  app.get("/api/v1/trade/auctions", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = listQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка аукционов."
      });
    }

    const auctions = await prisma.economyAuction.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.status
          ? { status: query.data.status }
          : {})
      },
      include: {
        bids: {
          orderBy: { createdAt: "desc" },
          take: 10
        }
      },
      orderBy: { createdAt: "desc" },
      take: query.data.take
    });

    return {
      ok: true,
      auctions: serializeBigInts(auctions)
    };
  });

  app.get("/api/v1/trade/games", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = listQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка игр."
      });
    }

    const games = await prisma.economyGameSession.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.status
          ? { status: query.data.status }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.data.take
    });

    return {
      ok: true,
      games: serializeBigInts(games)
    };
  });

  app.get("/api/v1/trade/lotteries", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = listQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка лотерей."
      });
    }

    const lotteries = await prisma.economyLotteryRound.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.status
          ? { status: query.data.status }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.data.take
    });

    return {
      ok: true,
      lotteries: serializeBigInts(lotteries)
    };
  });

  app.get("/api/v1/trade/escrow", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = listQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры escrow."
      });
    }

    const escrow = await prisma.economyEscrow.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.status
          ? { status: query.data.status }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.data.take
    });

    return {
      ok: true,
      escrow: serializeBigInts(escrow)
    };
  });

  app.post("/api/v1/trade/auctions/server", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const body = serverAuctionBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_AUCTION",
        message: "Проверь параметры серверного аукциона."
      });
    }

    const startsAt = body.data.startsAt
      ? new Date(body.data.startsAt)
      : new Date();
    const endsAt = new Date(body.data.endsAt);

    if (endsAt.getTime() <= startsAt.getTime()) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_AUCTION_TIME",
        message: "Аукцион должен завершаться позже старта."
      });
    }

    const auction = await createServerAuction({
      guildId: config.guildId,
      itemDefinitionId: body.data.itemDefinitionId,
      createdBy: session.discordId,
      source: "SERVER",
      startPrice: BigInt(body.data.startPrice),
      minIncrement: BigInt(body.data.minIncrement),
      buyoutPrice:
        body.data.buyoutPrice === null ||
        body.data.buyoutPrice === undefined
          ? null
          : BigInt(body.data.buyoutPrice),
      startsAt,
      endsAt
    });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: "trade.server_auction.create",
        targetType: "auction",
        targetId: auction.id,
        payload: {
          itemDefinitionId: body.data.itemDefinitionId,
          startPrice: body.data.startPrice,
          endsAt: endsAt.toISOString()
        }
      }
    });

    return {
      ok: true,
      auction: serializeBigInts(auction)
    };
  });

  app.post("/api/v1/trade/lotteries", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const body = lotteryBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_LOTTERY",
        message: "Проверь параметры лотереи."
      });
    }

    const startsAt = body.data.startsAt
      ? new Date(body.data.startsAt)
      : new Date();
    const endsAt = new Date(body.data.endsAt);

    if (endsAt.getTime() <= startsAt.getTime()) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_LOTTERY_TIME",
        message: "Лотерея должна завершаться позже старта."
      });
    }

    const round = await createLotteryRound({
      guildId: config.guildId,
      title: body.data.title,
      ticketPrice: BigInt(body.data.ticketPrice),
      maxTickets: body.data.maxTickets ?? null,
      maxTicketsPerUser: body.data.maxTicketsPerUser ?? null,
      feeBps: Math.round(body.data.feePercent * 100),
      startsAt,
      endsAt,
      createdBy: session.discordId
    });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: "trade.lottery.create",
        targetType: "lottery",
        targetId: round.id,
        payload: {
          title: round.title,
          ticketPrice: round.ticketPrice.toString(),
          endsAt: endsAt.toISOString()
        }
      }
    });

    return {
      ok: true,
      lottery: serializeBigInts(round)
    };
  });

  app.post(
    "/api/v1/trade/auctions/:id/cancel",
    async (request, reply) => {
      const session = await requireSession(request, reply, redis);
      if (!session) return;

      if (session.level !== "SUPERADMIN") {
        return reply.code(403).send({
          ok: false,
          error: "SUPERADMIN_REQUIRED",
          message: "Принудительно отменить аукцион может только владелец."
        });
      }

      const params = idParamsSchema.safeParse(request.params);
      const body = confirmSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({
          ok: false,
          error: "CONFIRMATION_REQUIRED",
          message: "Нужно явно подтвердить принудительную отмену."
        });
      }

      const auction = await cancelAuction({
        guildId: config.guildId,
        auctionId: params.data.id,
        actorId: session.discordId,
        force: true
      });

      await prisma.auditLog.create({
        data: {
          guildId: config.guildId,
          actorId: session.discordId,
          action: "trade.auction.force_cancel",
          targetType: "auction",
          targetId: auction.id
        }
      });

      return {
        ok: true,
        auction: serializeBigInts(auction)
      };
    }
  );
}
