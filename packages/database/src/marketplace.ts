import { prisma } from "./client.js";
import { EconomyError } from "./economy.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function ensureAmount(amount: bigint, code = "INVALID_AMOUNT") {
  if (amount <= 0n) {
    throw new EconomyError(code, "Сумма должна быть больше нуля.");
  }
}

function feeAmount(amount: bigint, feeBps: number) {
  if (feeBps <= 0) return 0n;
  return (amount * BigInt(feeBps) + 9999n) / 10000n;
}

async function ensureTreasury(tx: Tx, guildId: string) {
  return tx.economyTreasury.upsert({
    where: { guildId },
    update: {},
    create: { guildId }
  });
}

async function ensureAccount(tx: Tx, guildId: string, userId: string) {
  return tx.economyAccount.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {},
    create: { guildId, userId }
  });
}

async function ledger(
  tx: Tx,
  input: {
    guildId: string;
    userId: string;
    amount: bigint;
    walletDelta?: bigint;
    type: string;
    counterpartyUserId?: string | null;
    referenceId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return tx.economyTransaction.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      amount: input.amount,
      walletDelta: input.walletDelta ?? 0n,
      bankDelta: 0n,
      type: input.type,
      counterpartyUserId: input.counterpartyUserId ?? null,
      referenceId: input.referenceId ?? null,
      metadata: input.metadata
        ? JSON.parse(JSON.stringify(input.metadata))
        : undefined
    }
  });
}

export async function createMarketplaceListing(input: {
  guildId: string;
  sellerId: string;
  itemInstanceId: string;
  price: bigint;
  feeBps: number;
  expiresAt?: Date | null;
}) {
  ensureAmount(input.price, "INVALID_PRICE");

  if (input.feeBps < 0 || input.feeBps > 10000) {
    throw new EconomyError(
      "INVALID_FEE",
      "Комиссия маркетплейса должна быть от 0% до 100%."
    );
  }

  return prisma.$transaction(async (tx) => {
    const instance = await tx.economyItemInstance.findFirst({
      where: {
        id: input.itemInstanceId,
        guildId: input.guildId,
        ownerId: input.sellerId
      },
      include: { item: true }
    });

    if (!instance) {
      throw new EconomyError(
        "ITEM_NOT_FOUND",
        "Предмет не найден в твоём инвентаре."
      );
    }

    if (!instance.item.tradable) {
      throw new EconomyError(
        "ITEM_NOT_TRADABLE",
        "Этот предмет нельзя продавать."
      );
    }

    const now = new Date();
    const staleLock =
      instance.lockedUntil !== null &&
      instance.lockedUntil.getTime() <= now.getTime();

    if (instance.lockKind && !staleLock) {
      throw new EconomyError(
        "ITEM_LOCKED",
        "Предмет уже используется в другой операции."
      );
    }

    const listing = await tx.economyMarketplaceListing.create({
      data: {
        guildId: input.guildId,
        sellerId: input.sellerId,
        itemInstanceId: instance.id,
        price: input.price,
        feeBps: input.feeBps,
        expiresAt: input.expiresAt ?? null
      }
    });

    const lock = await tx.economyItemInstance.updateMany({
      where: {
        id: instance.id,
        ownerId: input.sellerId,
        ...(staleLock
          ? { lockedUntil: { lte: now } }
          : { lockKind: null })
      },
      data: {
        lockKind: "MARKET",
        lockId: listing.id,
        lockedUntil: input.expiresAt ?? null
      }
    });

    if (lock.count !== 1) {
      throw new EconomyError(
        "ITEM_CHANGED",
        "Предмет уже изменился. Повтори действие."
      );
    }

    return listing;
  });
}

export function listMarketplaceListings(
  guildId: string,
  take = 50
) {
  return prisma.economyMarketplaceListing.findMany({
    where: {
      guildId,
      status: "ACTIVE",
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(take, 100))
  });
}

export async function cancelMarketplaceListing(input: {
  guildId: string;
  listingId: string;
  sellerId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.economyMarketplaceListing.findFirst({
      where: {
        id: input.listingId,
        guildId: input.guildId,
        sellerId: input.sellerId,
        status: "ACTIVE"
      }
    });

    if (!listing) {
      throw new EconomyError(
        "LISTING_NOT_FOUND",
        "Активное объявление не найдено."
      );
    }

    const claimed = await tx.economyMarketplaceListing.updateMany({
      where: {
        id: listing.id,
        status: "ACTIVE",
        version: listing.version
      },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
        completedAt: new Date()
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "LISTING_CHANGED",
        "Объявление уже изменилось."
      );
    }

    await tx.economyItemInstance.updateMany({
      where: {
        id: listing.itemInstanceId,
        ownerId: input.sellerId,
        lockKind: "MARKET",
        lockId: listing.id
      },
      data: {
        lockKind: null,
        lockId: null,
        lockedUntil: null
      }
    });

    return tx.economyMarketplaceListing.findUniqueOrThrow({
      where: { id: listing.id }
    });
  });
}

export async function buyMarketplaceListing(input: {
  guildId: string;
  listingId: string;
  buyerId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.economyMarketplaceListing.findFirst({
      where: {
        id: input.listingId,
        guildId: input.guildId,
        status: "ACTIVE"
      }
    });

    if (!listing) {
      throw new EconomyError(
        "LISTING_NOT_FOUND",
        "Объявление уже недоступно."
      );
    }

    if (
      listing.expiresAt &&
      listing.expiresAt.getTime() <= Date.now()
    ) {
      throw new EconomyError(
        "LISTING_EXPIRED",
        "Срок объявления истёк."
      );
    }

    if (listing.sellerId === input.buyerId) {
      throw new EconomyError(
        "SELF_PURCHASE",
        "Нельзя купить собственный предмет."
      );
    }

    const claimed = await tx.economyMarketplaceListing.updateMany({
      where: {
        id: listing.id,
        status: "ACTIVE",
        version: listing.version
      },
      data: {
        status: "PROCESSING",
        version: { increment: 1 }
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "LISTING_CHANGED",
        "Предмет уже покупает другой участник."
      );
    }

    const buyer = await ensureAccount(
      tx,
      input.guildId,
      input.buyerId
    );
    await ensureAccount(tx, input.guildId, listing.sellerId);
    await ensureTreasury(tx, input.guildId);

    if (buyer.frozenAt) {
      throw new EconomyError(
        "ACCOUNT_FROZEN",
        "Экономический аккаунт заморожен."
      );
    }

    const debit = await tx.economyAccount.updateMany({
      where: {
        id: buyer.id,
        wallet: { gte: listing.price }
      },
      data: {
        wallet: { decrement: listing.price },
        lifetimeSpent: { increment: listing.price }
      }
    });

    if (debit.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        "Недостаточно NEC в кошельке."
      );
    }

    const moved = await tx.economyItemInstance.updateMany({
      where: {
        id: listing.itemInstanceId,
        ownerId: listing.sellerId,
        lockKind: "MARKET",
        lockId: listing.id
      },
      data: {
        ownerId: input.buyerId,
        acquiredFrom: "MARKET",
        acquiredAt: new Date(),
        lockKind: null,
        lockId: null,
        lockedUntil: null
      }
    });

    if (moved.count !== 1) {
      throw new EconomyError(
        "ITEM_CHANGED",
        "Предмет больше не принадлежит продавцу."
      );
    }

    const fee = feeAmount(listing.price, listing.feeBps);
    const sellerIncome = listing.price - fee;

    await tx.economyAccount.update({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: listing.sellerId
        }
      },
      data: {
        wallet: { increment: sellerIncome },
        lifetimeEarned: { increment: sellerIncome }
      }
    });

    if (fee > 0n) {
      await tx.economyTreasury.update({
        where: { guildId: input.guildId },
        data: {
          balance: { increment: fee },
          collectedFees: { increment: fee }
        }
      });
    }

    await Promise.all([
      ledger(tx, {
        guildId: input.guildId,
        userId: input.buyerId,
        counterpartyUserId: listing.sellerId,
        amount: -listing.price,
        walletDelta: -listing.price,
        type: "MARKET_PURCHASE",
        referenceId: listing.id,
        metadata: {
          itemInstanceId: listing.itemInstanceId,
          fee: fee.toString()
        }
      }),
      ledger(tx, {
        guildId: input.guildId,
        userId: listing.sellerId,
        counterpartyUserId: input.buyerId,
        amount: sellerIncome,
        walletDelta: sellerIncome,
        type: "MARKET_SALE",
        referenceId: listing.id,
        metadata: {
          itemInstanceId: listing.itemInstanceId,
          fee: fee.toString()
        }
      })
    ]);

    return tx.economyMarketplaceListing.update({
      where: { id: listing.id },
      data: {
        status: "SOLD",
        buyerId: input.buyerId,
        completedAt: new Date()
      }
    });
  });
}

export async function expireMarketplaceListings(guildId: string) {
  const expired = await prisma.economyMarketplaceListing.findMany({
    where: {
      guildId,
      status: "ACTIVE",
      expiresAt: { lte: new Date() }
    },
    select: {
      id: true,
      sellerId: true,
      itemInstanceId: true
    },
    take: 250
  });

  let count = 0;

  for (const listing of expired) {
    const done = await prisma.$transaction(async (tx) => {
      const changed = await tx.economyMarketplaceListing.updateMany({
        where: {
          id: listing.id,
          status: "ACTIVE"
        },
        data: {
          status: "EXPIRED",
          version: { increment: 1 },
          completedAt: new Date()
        }
      });

      if (changed.count !== 1) {
        return false;
      }

      await tx.economyItemInstance.updateMany({
        where: {
          id: listing.itemInstanceId,
          ownerId: listing.sellerId,
          lockKind: "MARKET",
          lockId: listing.id
        },
        data: {
          lockKind: null,
          lockId: null,
          lockedUntil: null
        }
      });

      return true;
    });

    if (done) count += 1;
  }

  return { count };
}
