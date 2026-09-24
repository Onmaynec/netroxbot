import { prisma } from "./client.js";
import { EconomyError } from "./economy.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function ensurePositive(value: bigint, label: string) {
  if (value <= 0n) {
    throw new EconomyError(
      "INVALID_AMOUNT",
      label + " должна быть больше нуля."
    );
  }
}

function feeAmount(amount: bigint, feeBps: number) {
  if (feeBps <= 0) return 0n;
  return (amount * BigInt(feeBps) + 9999n) / 10000n;
}

async function ensureAccount(tx: Tx, guildId: string, userId: string) {
  return tx.economyAccount.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {},
    create: { guildId, userId }
  });
}

async function ensureTreasury(tx: Tx, guildId: string) {
  return tx.economyTreasury.upsert({
    where: { guildId },
    update: {},
    create: { guildId }
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

function initialStatus(startsAt: Date) {
  return startsAt.getTime() <= Date.now() ? "ACTIVE" : "SCHEDULED";
}

export async function createUserAuction(input: {
  guildId: string;
  sellerId: string;
  itemInstanceId: string;
  startPrice: bigint;
  minIncrement: bigint;
  buyoutPrice?: bigint | null;
  feeBps: number;
  startsAt: Date;
  endsAt: Date;
}) {
  ensurePositive(input.startPrice, "Стартовая цена");
  ensurePositive(input.minIncrement, "Минимальный шаг");

  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new EconomyError(
      "INVALID_AUCTION_TIME",
      "Аукцион должен завершаться позже старта."
    );
  }

  if (
    input.buyoutPrice !== null &&
    input.buyoutPrice !== undefined &&
    input.buyoutPrice < input.startPrice
  ) {
    throw new EconomyError(
      "INVALID_BUYOUT",
      "Цена моментальной покупки не может быть ниже стартовой."
    );
  }

  if (input.feeBps < 0 || input.feeBps > 10000) {
    throw new EconomyError(
      "INVALID_FEE",
      "Комиссия аукциона должна быть от 0% до 100%."
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
        "Предмет не найден в инвентаре."
      );
    }

    if (!instance.item.tradable) {
      throw new EconomyError(
        "ITEM_NOT_TRADABLE",
        "Этот предмет нельзя выставить на аукцион."
      );
    }

    const now = new Date();
    const staleLock =
      instance.lockedUntil !== null &&
      instance.lockedUntil.getTime() <= now.getTime();

    if (instance.lockKind && !staleLock) {
      throw new EconomyError(
        "ITEM_LOCKED",
        "Предмет уже участвует в другой операции."
      );
    }

    const auction = await tx.economyAuction.create({
      data: {
        guildId: input.guildId,
        source: "USER",
        sellerId: input.sellerId,
        itemInstanceId: instance.id,
        createdBy: input.sellerId,
        startPrice: input.startPrice,
        minIncrement: input.minIncrement,
        buyoutPrice: input.buyoutPrice ?? null,
        feeBps: input.feeBps,
        status: initialStatus(input.startsAt),
        startsAt: input.startsAt,
        endsAt: input.endsAt
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
        lockKind: "AUCTION",
        lockId: auction.id,
        lockedUntil: input.endsAt
      }
    });

    if (lock.count !== 1) {
      throw new EconomyError(
        "ITEM_CHANGED",
        "Предмет уже изменился."
      );
    }

    return auction;
  });
}

export async function createServerAuction(input: {
  guildId: string;
  itemDefinitionId: string;
  createdBy: string;
  source?: "SERVER" | "AUTO";
  startPrice: bigint;
  minIncrement: bigint;
  buyoutPrice?: bigint | null;
  startsAt: Date;
  endsAt: Date;
}) {
  ensurePositive(input.startPrice, "Стартовая цена");
  ensurePositive(input.minIncrement, "Минимальный шаг");

  const item = await prisma.economyItemDefinition.findFirst({
    where: {
      id: input.itemDefinitionId,
      guildId: input.guildId,
      active: true
    }
  });

  if (!item) {
    throw new EconomyError(
      "ITEM_NOT_FOUND",
      "Предмет для серверного аукциона не найден."
    );
  }

  return prisma.economyAuction.create({
    data: {
      guildId: input.guildId,
      source: input.source ?? "SERVER",
      itemDefinitionId: item.id,
      createdBy: input.createdBy,
      startPrice: input.startPrice,
      minIncrement: input.minIncrement,
      buyoutPrice: input.buyoutPrice ?? null,
      feeBps: 0,
      status: initialStatus(input.startsAt),
      startsAt: input.startsAt,
      endsAt: input.endsAt
    }
  });
}

export function listActiveAuctions(
  guildId: string,
  take = 50
) {
  const now = new Date();

  return prisma.economyAuction.findMany({
    where: {
      guildId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { gt: now }
    },
    include: {
      bids: {
        orderBy: { createdAt: "desc" },
        take: 5
      }
    },
    orderBy: [
      { startsAt: "asc" },
      { endsAt: "asc" }
    ],
    take: Math.max(1, Math.min(take, 100))
  });
}

export async function placeAuctionBid(input: {
  guildId: string;
  auctionId: string;
  bidderId: string;
  amount: bigint;
}) {
  ensurePositive(input.amount, "Ставка");

  return prisma.$transaction(async (tx) => {
    const auction = await tx.economyAuction.findFirst({
      where: {
        id: input.auctionId,
        guildId: input.guildId,
        status: { in: ["SCHEDULED", "ACTIVE"] }
      }
    });

    if (!auction) {
      throw new EconomyError(
        "AUCTION_NOT_FOUND",
        "Аукцион не найден или уже завершён."
      );
    }

    const now = new Date();

    if (auction.startsAt.getTime() > now.getTime()) {
      throw new EconomyError(
        "AUCTION_NOT_STARTED",
        "Аукцион ещё не начался."
      );
    }

    if (auction.endsAt.getTime() <= now.getTime()) {
      throw new EconomyError(
        "AUCTION_ENDED",
        "Время аукциона уже закончилось."
      );
    }

    if (auction.sellerId === input.bidderId) {
      throw new EconomyError(
        "SELF_BID",
        "Нельзя ставить на собственный аукцион."
      );
    }

    const minimum =
      auction.currentBid === null
        ? auction.startPrice
        : auction.currentBid + auction.minIncrement;

    if (input.amount < minimum) {
      throw new EconomyError(
        "BID_TOO_LOW",
        "Минимальная ставка: " + minimum.toString() + " NEC."
      );
    }

    const bidder = await ensureAccount(
      tx,
      input.guildId,
      input.bidderId
    );

    if (bidder.frozenAt) {
      throw new EconomyError(
        "ACCOUNT_FROZEN",
        "Экономический аккаунт заморожен."
      );
    }

    const claimed = await tx.economyAuction.updateMany({
      where: {
        id: auction.id,
        version: auction.version,
        status: { in: ["SCHEDULED", "ACTIVE"] },
        endsAt: { gt: now }
      },
      data: {
        status: "ACTIVE",
        currentBid: input.amount,
        currentBidderId: input.bidderId,
        version: { increment: 1 },
        ...(auction.buyoutPrice !== null &&
        input.amount >= auction.buyoutPrice
          ? { endsAt: now }
          : {})
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "AUCTION_CHANGED",
        "Ставка изменилась одновременно с твоей. Повтори попытку."
      );
    }

    const previousEscrow = await tx.economyEscrow.findFirst({
      where: {
        guildId: input.guildId,
        kind: "AUCTION",
        referenceId: auction.id,
        status: "HELD"
      },
      orderBy: { createdAt: "desc" }
    });

    if (previousEscrow) {
      const refunded = await tx.economyEscrow.updateMany({
        where: {
          id: previousEscrow.id,
          status: "HELD"
        },
        data: {
          status: "REFUNDED",
          releasedAt: now
        }
      });

      if (refunded.count !== 1) {
        throw new EconomyError(
          "ESCROW_CHANGED",
          "Состояние предыдущей ставки изменилось."
        );
      }

      await ensureAccount(
        tx,
        input.guildId,
        previousEscrow.userId
      );

      await tx.economyAccount.update({
        where: {
          guildId_userId: {
            guildId: input.guildId,
            userId: previousEscrow.userId
          }
        },
        data: {
          wallet: { increment: previousEscrow.amount }
        }
      });

      await ledger(tx, {
        guildId: input.guildId,
        userId: previousEscrow.userId,
        amount: previousEscrow.amount,
        walletDelta: previousEscrow.amount,
        type: "AUCTION_BID_REFUND",
        referenceId: auction.id
      });
    }

    const debit = await tx.economyAccount.updateMany({
      where: {
        id: bidder.id,
        wallet: { gte: input.amount }
      },
      data: {
        wallet: { decrement: input.amount }
      }
    });

    if (debit.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        "Недостаточно NEC для этой ставки."
      );
    }

    await tx.economyEscrow.create({
      data: {
        guildId: input.guildId,
        kind: "AUCTION",
        referenceId: auction.id,
        userId: input.bidderId,
        amount: input.amount,
        metadata: {
          auctionVersion: auction.version + 1
        }
      }
    });

    await tx.economyAuctionBid.create({
      data: {
        auctionId: auction.id,
        bidderId: input.bidderId,
        amount: input.amount
      }
    });

    await ledger(tx, {
      guildId: input.guildId,
      userId: input.bidderId,
      amount: -input.amount,
      walletDelta: -input.amount,
      type: "AUCTION_BID_HOLD",
      referenceId: auction.id
    });

    return tx.economyAuction.findUniqueOrThrow({
      where: { id: auction.id }
    });
  });
}

async function mintServerAuctionItem(
  tx: Tx,
  auction: {
    guildId: string;
    id: string;
    itemDefinitionId: string | null;
    currentBidderId: string | null;
  }
) {
  if (!auction.itemDefinitionId || !auction.currentBidderId) {
    throw new EconomyError(
      "AUCTION_ITEM_MISSING",
      "У серверного аукциона отсутствует предмет."
    );
  }

  const item = await tx.economyItemDefinition.findUnique({
    where: { id: auction.itemDefinitionId }
  });

  if (!item || item.guildId !== auction.guildId) {
    throw new EconomyError(
      "ITEM_NOT_FOUND",
      "Предмет серверного аукциона больше не существует."
    );
  }

  const reserved = await tx.economyItemDefinition.updateMany({
    where: {
      id: item.id,
      nextSerial: item.nextSerial
    },
    data: {
      nextSerial: { increment: 1 }
    }
  });

  if (reserved.count !== 1) {
    throw new EconomyError(
      "ITEM_CHANGED",
      "Серийный номер предмета изменился."
    );
  }

  return tx.economyItemInstance.create({
    data: {
      guildId: auction.guildId,
      itemId: item.id,
      ownerId: auction.currentBidderId,
      serialNumber: item.nextSerial,
      acquiredFrom: "SERVER_AUCTION"
    }
  });
}

export async function settleAuction(
  guildId: string,
  auctionId: string
) {
  return prisma.$transaction(async (tx) => {
    const auction = await tx.economyAuction.findFirst({
      where: {
        id: auctionId,
        guildId,
        status: { in: ["SCHEDULED", "ACTIVE"] },
        endsAt: { lte: new Date() }
      }
    });

    if (!auction) {
      throw new EconomyError(
        "AUCTION_NOT_SETTLEABLE",
        "Аукцион ещё не готов к завершению."
      );
    }

    const claimed = await tx.economyAuction.updateMany({
      where: {
        id: auction.id,
        version: auction.version,
        status: { in: ["SCHEDULED", "ACTIVE"] }
      },
      data: {
        status: "SETTLING",
        version: { increment: 1 }
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "AUCTION_CHANGED",
        "Аукцион уже обрабатывается."
      );
    }

    if (!auction.currentBidderId || auction.currentBid === null) {
      if (auction.itemInstanceId && auction.sellerId) {
        await tx.economyItemInstance.updateMany({
          where: {
            id: auction.itemInstanceId,
            ownerId: auction.sellerId,
            lockKind: "AUCTION",
            lockId: auction.id
          },
          data: {
            lockKind: null,
            lockId: null,
            lockedUntil: null
          }
        });
      }

      return tx.economyAuction.update({
        where: { id: auction.id },
        data: {
          status: "ENDED",
          settledAt: new Date()
        }
      });
    }

    const escrow = await tx.economyEscrow.findFirst({
      where: {
        guildId,
        kind: "AUCTION",
        referenceId: auction.id,
        userId: auction.currentBidderId,
        status: "HELD"
      },
      orderBy: { createdAt: "desc" }
    });

    if (!escrow || escrow.amount !== auction.currentBid) {
      throw new EconomyError(
        "ESCROW_MISSING",
        "Не найдено удержание победной ставки."
      );
    }

    await ensureTreasury(tx, guildId);

    if (auction.source === "USER") {
      if (!auction.itemInstanceId || !auction.sellerId) {
        throw new EconomyError(
          "AUCTION_ITEM_MISSING",
          "У пользовательского аукциона отсутствует предмет."
        );
      }

      const moved = await tx.economyItemInstance.updateMany({
        where: {
          id: auction.itemInstanceId,
          ownerId: auction.sellerId,
          lockKind: "AUCTION",
          lockId: auction.id
        },
        data: {
          ownerId: auction.currentBidderId,
          acquiredFrom: "AUCTION",
          acquiredAt: new Date(),
          lockKind: null,
          lockId: null,
          lockedUntil: null
        }
      });

      if (moved.count !== 1) {
        throw new EconomyError(
          "ITEM_CHANGED",
          "Предмет аукциона больше недоступен."
        );
      }

      await ensureAccount(tx, guildId, auction.sellerId);
      const fee = feeAmount(auction.currentBid, auction.feeBps);
      const income = auction.currentBid - fee;

      await tx.economyAccount.update({
        where: {
          guildId_userId: {
            guildId,
            userId: auction.sellerId
          }
        },
        data: {
          wallet: { increment: income },
          lifetimeEarned: { increment: income }
        }
      });

      if (fee > 0n) {
        await tx.economyTreasury.update({
          where: { guildId },
          data: {
            balance: { increment: fee },
            collectedFees: { increment: fee }
          }
        });
      }

      await ledger(tx, {
        guildId,
        userId: auction.sellerId,
        counterpartyUserId: auction.currentBidderId,
        amount: income,
        walletDelta: income,
        type: "AUCTION_SALE",
        referenceId: auction.id,
        metadata: { fee: fee.toString() }
      });
    } else {
      await mintServerAuctionItem(tx, auction);

      await tx.economyTreasury.update({
        where: { guildId },
        data: {
          balance: { increment: auction.currentBid }
        }
      });
    }

    const released = await tx.economyEscrow.updateMany({
      where: {
        id: escrow.id,
        status: "HELD"
      },
      data: {
        status: "RELEASED",
        releasedAt: new Date()
      }
    });

    if (released.count !== 1) {
      throw new EconomyError(
        "ESCROW_CHANGED",
        "Победная ставка уже была обработана."
      );
    }

    await ledger(tx, {
      guildId,
      userId: auction.currentBidderId,
      counterpartyUserId: auction.sellerId ?? null,
      amount: 0n,
      type: "AUCTION_WIN",
      referenceId: auction.id,
      metadata: {
        winningBid: auction.currentBid.toString(),
        source: auction.source
      }
    });

    return tx.economyAuction.update({
      where: { id: auction.id },
      data: {
        status: "ENDED",
        settledAt: new Date()
      }
    });
  });
}

export async function settleDueAuctions(guildId: string) {
  const due = await prisma.economyAuction.findMany({
    where: {
      guildId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { lte: new Date() }
    },
    select: { id: true },
    take: 100
  });

  let settled = 0;

  for (const row of due) {
    try {
      await settleAuction(guildId, row.id);
      settled += 1;
    } catch (error) {
      if (
        !(error instanceof EconomyError) ||
        !["AUCTION_CHANGED", "AUCTION_NOT_SETTLEABLE"].includes(error.code)
      ) {
        throw error;
      }
    }
  }

  return { settled };
}

export async function cancelAuction(input: {
  guildId: string;
  auctionId: string;
  actorId: string;
  force?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const auction = await tx.economyAuction.findFirst({
      where: {
        id: input.auctionId,
        guildId: input.guildId,
        status: { in: ["SCHEDULED", "ACTIVE"] }
      }
    });

    if (!auction) {
      throw new EconomyError(
        "AUCTION_NOT_FOUND",
        "Аукцион не найден."
      );
    }

    const ownsAuction =
      auction.sellerId === input.actorId ||
      auction.createdBy === input.actorId;

    if (!ownsAuction && !input.force) {
      throw new EconomyError(
        "AUCTION_FORBIDDEN",
        "Нельзя отменить чужой аукцион."
      );
    }

    const claimed = await tx.economyAuction.updateMany({
      where: {
        id: auction.id,
        version: auction.version,
        status: { in: ["SCHEDULED", "ACTIVE"] }
      },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
        settledAt: new Date()
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "AUCTION_CHANGED",
        "Аукцион уже изменился."
      );
    }

    const escrow = await tx.economyEscrow.findFirst({
      where: {
        guildId: input.guildId,
        kind: "AUCTION",
        referenceId: auction.id,
        status: "HELD"
      },
      orderBy: { createdAt: "desc" }
    });

    if (escrow) {
      await ensureAccount(
        tx,
        input.guildId,
        escrow.userId
      );

      const refunded = await tx.economyEscrow.updateMany({
        where: { id: escrow.id, status: "HELD" },
        data: {
          status: "REFUNDED",
          releasedAt: new Date()
        }
      });

      if (refunded.count !== 1) {
        throw new EconomyError(
          "ESCROW_CHANGED",
          "Ставка уже была обработана."
        );
      }

      await tx.economyAccount.update({
        where: {
          guildId_userId: {
            guildId: input.guildId,
            userId: escrow.userId
          }
        },
        data: {
          wallet: { increment: escrow.amount }
        }
      });

      await ledger(tx, {
        guildId: input.guildId,
        userId: escrow.userId,
        amount: escrow.amount,
        walletDelta: escrow.amount,
        type: "AUCTION_CANCEL_REFUND",
        referenceId: auction.id
      });
    }

    if (auction.itemInstanceId && auction.sellerId) {
      await tx.economyItemInstance.updateMany({
        where: {
          id: auction.itemInstanceId,
          ownerId: auction.sellerId,
          lockKind: "AUCTION",
          lockId: auction.id
        },
        data: {
          lockKind: null,
          lockId: null,
          lockedUntil: null
        }
      });
    }

    return tx.economyAuction.findUniqueOrThrow({
      where: { id: auction.id }
    });
  });
}
