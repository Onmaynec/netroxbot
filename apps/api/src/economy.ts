import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  activateEconomySeason,
  createEconomyItem,
  createEconomySeason,
  prisma
} from "@netrox/database";
import { requireSession } from "./auth.js";

export type EconomyApiConfig = {
  guildId: string;
};

const userQuerySchema = z.object({
  userId: z.string().regex(/^\d{17,20}$/).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50)
});

const itemBodySchema = z.object({
  sku: z.string().min(2).max(32),
  name: z.string().min(1).max(80),
  description: z.string().max(300).nullable().optional(),
  rarity: z.enum([
    "COMMON",
    "UNCOMMON",
    "RARE",
    "EPIC",
    "LEGENDARY",
    "MYTHIC",
    "UNIQUE"
  ]),
  itemType: z.enum([
    "COLLECTIBLE",
    "COSMETIC",
    "ROLE",
    "BADGE",
    "OTHER"
  ]),
  imageUrl: z.string().url().nullable().optional(),
  roleId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  price: z.string().regex(/^\d+$/),
  stock: z.number().int().positive().nullable().optional(),
  maxPerUser: z.number().int().positive().nullable().optional(),
  tradable: z.boolean().optional(),
  giftable: z.boolean().optional()
});

const itemPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  price: z.string().regex(/^\d+$/).optional(),
  stock: z.number().int().nonnegative().nullable().optional(),
  maxPerUser: z.number().int().positive().nullable().optional(),
  tradable: z.boolean().optional(),
  giftable: z.boolean().optional(),
  active: z.boolean().optional()
});

const idParamsSchema = z.object({
  id: z.string().min(1).max(128)
});

const seasonBodySchema = z.object({
  name: z.string().min(1).max(80),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  resetBalances: z.boolean().default(false)
});

function bigint(value: bigint | null | undefined) {
  return (value ?? 0n).toString();
}

function serializeItem<T extends {
  price: bigint;
}>(item: T) {
  return {
    ...item,
    price: item.price.toString()
  };
}

export function registerEconomyRoutes(
  app: FastifyInstance,
  redis: Redis,
  config: EconomyApiConfig
) {
  app.get("/api/v1/economy/overview", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const [
      accountAggregate,
      accountCount,
      treasury,
      activeLoans,
      overdueLoans,
      shopItems,
      activeSeason
    ] = await Promise.all([
      prisma.economyAccount.aggregate({
        where: { guildId: config.guildId },
        _sum: {
          wallet: true,
          bank: true,
          lifetimeEarned: true,
          lifetimeSpent: true
        }
      }),
      prisma.economyAccount.count({
        where: { guildId: config.guildId }
      }),
      prisma.economyTreasury.upsert({
        where: { guildId: config.guildId },
        update: {},
        create: { guildId: config.guildId }
      }),
      prisma.economyLoan.count({
        where: {
          guildId: config.guildId,
          status: "ACTIVE"
        }
      }),
      prisma.economyLoan.count({
        where: {
          guildId: config.guildId,
          status: "OVERDUE"
        }
      }),
      prisma.economyItemDefinition.count({
        where: {
          guildId: config.guildId,
          active: true
        }
      }),
      prisma.economySeason.findFirst({
        where: {
          guildId: config.guildId,
          status: "ACTIVE"
        },
        orderBy: { startsAt: "desc" }
      })
    ]);

    return {
      ok: true,
      overview: {
        accounts: accountCount,
        walletSupply: bigint(accountAggregate._sum.wallet),
        bankSupply: bigint(accountAggregate._sum.bank),
        totalSupply: (
          (accountAggregate._sum.wallet ?? 0n) +
          (accountAggregate._sum.bank ?? 0n)
        ).toString(),
        lifetimeEarned: bigint(accountAggregate._sum.lifetimeEarned),
        lifetimeSpent: bigint(accountAggregate._sum.lifetimeSpent),
        treasury: {
          balance: treasury.balance.toString(),
          minted: treasury.minted.toString(),
          burned: treasury.burned.toString(),
          collectedFees: treasury.collectedFees.toString()
        },
        activeLoans,
        overdueLoans,
        shopItems,
        activeSeason
      }
    };
  });

  app.get("/api/v1/economy/accounts", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = userQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры списка счетов."
      });
    }

    const accounts = await prisma.economyAccount.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.userId
          ? { userId: query.data.userId }
          : {})
      },
      orderBy: [
        { wallet: "desc" },
        { bank: "desc" }
      ],
      take: query.data.take
    });

    return {
      ok: true,
      accounts: accounts.map((account) => ({
        ...account,
        wallet: account.wallet.toString(),
        bank: account.bank.toString(),
        lifetimeEarned: account.lifetimeEarned.toString(),
        lifetimeSpent: account.lifetimeSpent.toString()
      }))
    };
  });

  app.get("/api/v1/economy/transactions", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const query = userQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_QUERY",
        message: "Некорректные параметры транзакций."
      });
    }

    const transactions = await prisma.economyTransaction.findMany({
      where: {
        guildId: config.guildId,
        ...(query.data.userId
          ? { userId: query.data.userId }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.data.take
    });

    return {
      ok: true,
      transactions: transactions.map((entry) => ({
        ...entry,
        amount: entry.amount.toString(),
        walletDelta: entry.walletDelta.toString(),
        bankDelta: entry.bankDelta.toString()
      }))
    };
  });

  app.get("/api/v1/economy/items", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const items = await prisma.economyItemDefinition.findMany({
      where: { guildId: config.guildId },
      orderBy: [
        { active: "desc" },
        { createdAt: "desc" }
      ]
    });

    return {
      ok: true,
      items: items.map(serializeItem)
    };
  });

  app.post("/api/v1/economy/items", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const body = itemBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_ITEM",
        message: "Проверь параметры предмета."
      });
    }

    const item = await createEconomyItem({
      guildId: config.guildId,
      sku: body.data.sku,
      name: body.data.name,
      description: body.data.description ?? null,
      rarity: body.data.rarity,
      itemType: body.data.itemType,
      imageUrl: body.data.imageUrl ?? null,
      roleId: body.data.roleId ?? null,
      price: BigInt(body.data.price),
      stock: body.data.stock ?? null,
      maxPerUser: body.data.maxPerUser ?? null,
      ...(body.data.tradable !== undefined
        ? { tradable: body.data.tradable }
        : {}),
      ...(body.data.giftable !== undefined
        ? { giftable: body.data.giftable }
        : {}),
      createdBy: session.discordId
    });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: "economy.item.create",
        targetType: "economy_item",
        targetId: item.id,
        payload: {
          sku: item.sku,
          name: item.name,
          price: item.price.toString()
        }
      }
    });

    return {
      ok: true,
      item: serializeItem(item)
    };
  });

  app.patch("/api/v1/economy/items/:id", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const params = idParamsSchema.safeParse(request.params);
    const body = itemPatchSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_ITEM",
        message: "Проверь параметры предмета."
      });
    }

    const current = await prisma.economyItemDefinition.findFirst({
      where: {
        id: params.data.id,
        guildId: config.guildId
      }
    });

    if (!current) {
      return reply.code(404).send({
        ok: false,
        error: "ITEM_NOT_FOUND",
        message: "Предмет не найден."
      });
    }

    const item = await prisma.economyItemDefinition.update({
      where: { id: current.id },
      data: {
        ...(body.data.name !== undefined
          ? { name: body.data.name }
          : {}),
        ...(body.data.description !== undefined
          ? { description: body.data.description }
          : {}),
        ...(body.data.imageUrl !== undefined
          ? { imageUrl: body.data.imageUrl }
          : {}),
        ...(body.data.price !== undefined
          ? { price: BigInt(body.data.price) }
          : {}),
        ...(body.data.stock !== undefined
          ? { stock: body.data.stock }
          : {}),
        ...(body.data.maxPerUser !== undefined
          ? { maxPerUser: body.data.maxPerUser }
          : {}),
        ...(body.data.tradable !== undefined
          ? { tradable: body.data.tradable }
          : {}),
        ...(body.data.giftable !== undefined
          ? { giftable: body.data.giftable }
          : {}),
        ...(body.data.active !== undefined
          ? { active: body.data.active }
          : {})
      }
    });

    await prisma.auditLog.create({
      data: {
        guildId: config.guildId,
        actorId: session.discordId,
        action: "economy.item.update",
        targetType: "economy_item",
        targetId: item.id,
        payload: JSON.parse(JSON.stringify(body.data))
      }
    });

    return {
      ok: true,
      item: serializeItem(item)
    };
  });

  app.get("/api/v1/economy/loans", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const loans = await prisma.economyLoan.findMany({
      where: { guildId: config.guildId },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      ok: true,
      loans: loans.map((loan) => ({
        ...loan,
        principal: loan.principal.toString(),
        balance: loan.balance.toString()
      }))
    };
  });

  app.get("/api/v1/economy/seasons", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const seasons = await prisma.economySeason.findMany({
      where: { guildId: config.guildId },
      orderBy: { startsAt: "desc" },
      take: 50
    });

    return {
      ok: true,
      seasons
    };
  });

  app.post("/api/v1/economy/seasons", async (request, reply) => {
    const session = await requireSession(request, reply, redis);
    if (!session) return;

    const body = seasonBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: "INVALID_SEASON",
        message: "Проверь параметры сезона."
      });
    }

    const season = await createEconomySeason({
      guildId: config.guildId,
      name: body.data.name,
      startsAt: body.data.startsAt
        ? new Date(body.data.startsAt)
        : new Date(),
      endsAt: body.data.endsAt
        ? new Date(body.data.endsAt)
        : null,
      resetBalances: body.data.resetBalances,
      createdBy: session.discordId
    });

    return {
      ok: true,
      season
    };
  });

  app.post(
    "/api/v1/economy/seasons/:id/activate",
    async (request, reply) => {
      const session = await requireSession(request, reply, redis);
      if (!session) return;

      const params = idParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          ok: false,
          error: "INVALID_SEASON",
          message: "Некорректный ID сезона."
        });
      }

      const season = await activateEconomySeason(
        config.guildId,
        params.data.id
      );

      await prisma.auditLog.create({
        data: {
          guildId: config.guildId,
          actorId: session.discordId,
          action: "economy.season.activate",
          targetType: "economy_season",
          targetId: season.id,
          payload: {
            name: season.name,
            resetBalances: season.resetBalances
          }
        }
      });

      return {
        ok: true,
        season
      };
    }
  );
}
