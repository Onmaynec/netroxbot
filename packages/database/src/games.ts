import { randomInt } from "node:crypto";
import { prisma } from "./client.js";
import { EconomyError } from "./economy.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function feeAmount(amount: bigint, feeBps: number) {
  if (feeBps <= 0) return 0n;
  return (amount * BigInt(feeBps) + 9999n) / 10000n;
}

function validFee(feeBps: number) {
  if (feeBps < 0 || feeBps > 10000) {
    throw new EconomyError(
      "INVALID_FEE",
      "Комиссия должна быть от 0% до 100%."
    );
  }
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
    referenceId: string;
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
      referenceId: input.referenceId,
      ...(input.metadata
        ? { metadata: JSON.parse(JSON.stringify(input.metadata)) }
        : {})
    }
  });
}

async function holdStake(
  tx: Tx,
  input: {
    guildId: string;
    userId: string;
    amount: bigint;
    kind: string;
    referenceId: string;
    metadata?: Record<string, unknown>;
  }
) {
  if (input.amount <= 0n) return null;

  const account = await ensureAccount(
    tx,
    input.guildId,
    input.userId
  );

  if (account.frozenAt) {
    throw new EconomyError(
      "ACCOUNT_FROZEN",
      "Экономический аккаунт заморожен."
    );
  }

  const debit = await tx.economyAccount.updateMany({
    where: {
      id: account.id,
      wallet: { gte: input.amount }
    },
    data: {
      wallet: { decrement: input.amount }
    }
  });

  if (debit.count !== 1) {
    throw new EconomyError(
      "INSUFFICIENT_FUNDS",
      "Недостаточно NEC для ставки."
    );
  }

  const escrow = await tx.economyEscrow.create({
    data: {
      guildId: input.guildId,
      kind: input.kind,
      referenceId: input.referenceId,
      userId: input.userId,
      amount: input.amount,
      ...(input.metadata
        ? { metadata: JSON.parse(JSON.stringify(input.metadata)) }
        : {})
    }
  });

  await ledger(tx, {
    guildId: input.guildId,
    userId: input.userId,
    amount: -input.amount,
    walletDelta: -input.amount,
    type: input.kind + "_STAKE_HOLD",
    referenceId: input.referenceId
  });

  return escrow;
}

async function refundEscrow(
  tx: Tx,
  escrow: {
    id: string;
    guildId: string;
    userId: string;
    amount: bigint;
    referenceId: string;
    status: string;
  },
  type: string
) {
  if (escrow.status !== "HELD") return false;

  const changed = await tx.economyEscrow.updateMany({
    where: {
      id: escrow.id,
      status: "HELD"
    },
    data: {
      status: "REFUNDED",
      releasedAt: new Date()
    }
  });

  if (changed.count !== 1) {
    return false;
  }

  await ensureAccount(tx, escrow.guildId, escrow.userId);
  await tx.economyAccount.update({
    where: {
      guildId_userId: {
        guildId: escrow.guildId,
        userId: escrow.userId
      }
    },
    data: {
      wallet: { increment: escrow.amount }
    }
  });

  await ledger(tx, {
    guildId: escrow.guildId,
    userId: escrow.userId,
    amount: escrow.amount,
    walletDelta: escrow.amount,
    type,
    referenceId: escrow.referenceId
  });

  return true;
}

export async function createPvpGame(input: {
  guildId: string;
  requestId: string;
  gameType: string;
  hostId: string;
  opponentId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  stake: bigint;
  feeBps: number;
  state?: Record<string, unknown>;
  ttlSeconds: number;
}) {
  if (input.stake < 0n) {
    throw new EconomyError(
      "INVALID_STAKE",
      "Ставка не может быть отрицательной."
    );
  }
  validFee(input.feeBps);

  if (input.opponentId === input.hostId) {
    throw new EconomyError(
      "SELF_GAME",
      "Нельзя создать PvP-игру против самого себя."
    );
  }

  const existing = await prisma.economyGameSession.findUnique({
    where: { requestId: input.requestId }
  });

  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const session = await tx.economyGameSession.create({
      data: {
        guildId: input.guildId,
        requestId: input.requestId,
        gameType: input.gameType,
        hostId: input.hostId,
        ...(input.opponentId ? { opponentId: input.opponentId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        status: "WAITING",
        stake: input.stake,
        pot: input.stake,
        feeBps: input.feeBps,
        state: JSON.parse(JSON.stringify(input.state ?? {})),
        expiresAt: new Date(
          Date.now() + Math.max(30, input.ttlSeconds) * 1000
        )
      }
    });

    await holdStake(tx, {
      guildId: input.guildId,
      userId: input.hostId,
      amount: input.stake,
      kind: "GAME",
      referenceId: session.id,
      metadata: { side: "HOST", gameType: input.gameType }
    });

    return session;
  });
}

export async function joinPvpGame(input: {
  guildId: string;
  sessionId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.economyGameSession.findFirst({
      where: {
        id: input.sessionId,
        guildId: input.guildId,
        status: "WAITING"
      }
    });

    if (!session) {
      throw new EconomyError(
        "GAME_NOT_JOINABLE",
        "Матч уже недоступен."
      );
    }

    if (
      session.expiresAt &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new EconomyError(
        "GAME_EXPIRED",
        "Время ожидания матча закончилось."
      );
    }

    if (session.hostId === input.userId) {
      throw new EconomyError(
        "SELF_GAME",
        "Нельзя присоединиться к своей игре."
      );
    }

    if (
      session.opponentId &&
      session.opponentId !== input.userId
    ) {
      throw new EconomyError(
        "GAME_RESERVED",
        "Этот матч создан для другого участника."
      );
    }

    const claimed = await tx.economyGameSession.updateMany({
      where: {
        id: session.id,
        status: "WAITING",
        version: session.version
      },
      data: {
        opponentId: input.userId,
        status: "ACTIVE",
        pot: { increment: session.stake },
        version: { increment: 1 }
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "GAME_CHANGED",
        "К матчу уже присоединился другой участник."
      );
    }

    await holdStake(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: session.stake,
      kind: "GAME",
      referenceId: session.id,
      metadata: { side: "OPPONENT", gameType: session.gameType }
    });

    return tx.economyGameSession.findUniqueOrThrow({
      where: { id: session.id }
    });
  });
}

export async function updateGameState(input: {
  guildId: string;
  sessionId: string;
  actorId: string;
  expectedVersion: number;
  state: Record<string, unknown>;
}) {
  const changed = await prisma.economyGameSession.updateMany({
    where: {
      id: input.sessionId,
      guildId: input.guildId,
      status: "ACTIVE",
      version: input.expectedVersion,
      OR: [
        { hostId: input.actorId },
        { opponentId: input.actorId }
      ]
    },
    data: {
      state: JSON.parse(JSON.stringify(input.state)),
      version: { increment: 1 }
    }
  });

  if (changed.count !== 1) {
    throw new EconomyError(
      "GAME_CHANGED",
      "Состояние матча уже изменилось."
    );
  }

  return prisma.economyGameSession.findUniqueOrThrow({
    where: { id: input.sessionId }
  });
}

export async function settlePvpGame(input: {
  guildId: string;
  sessionId: string;
  winnerId?: string | null;
  reason?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.economyGameSession.findFirst({
      where: {
        id: input.sessionId,
        guildId: input.guildId,
        status: "ACTIVE"
      }
    });

    if (!session) {
      const existing = await tx.economyGameSession.findFirst({
        where: {
          id: input.sessionId,
          guildId: input.guildId
        }
      });

      if (existing?.status === "FINISHED") {
        return existing;
      }

      throw new EconomyError(
        "GAME_NOT_SETTLEABLE",
        "Матч нельзя завершить."
      );
    }

    const participants = new Set(
      [session.hostId, session.opponentId].filter(
        (value): value is string => Boolean(value)
      )
    );

    if (input.winnerId && !participants.has(input.winnerId)) {
      throw new EconomyError(
        "INVALID_WINNER",
        "Победитель не является участником матча."
      );
    }

    const claimed = await tx.economyGameSession.updateMany({
      where: {
        id: session.id,
        status: "ACTIVE",
        version: session.version
      },
      data: {
        status: "SETTLING",
        version: { increment: 1 }
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "GAME_CHANGED",
        "Матч уже завершается."
      );
    }

    const escrows = await tx.economyEscrow.findMany({
      where: {
        guildId: input.guildId,
        kind: "GAME",
        referenceId: session.id,
        status: "HELD"
      }
    });

    const pot = escrows.reduce(
      (total, escrow) => total + escrow.amount,
      0n
    );

    if (!input.winnerId) {
      for (const escrow of escrows) {
        await refundEscrow(
          tx,
          escrow,
          "GAME_DRAW_REFUND"
        );
      }

      return tx.economyGameSession.update({
        where: { id: session.id },
        data: {
          status: "FINISHED",
          pot,
          winnerId: null,
          settledAt: new Date()
        }
      });
    }

    const fee = feeAmount(pot, session.feeBps);
    const payout = pot - fee;

    await ensureAccount(
      tx,
      input.guildId,
      input.winnerId
    );
    await ensureTreasury(tx, input.guildId);

    await tx.economyAccount.update({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: input.winnerId
        }
      },
      data: {
        wallet: { increment: payout },
        lifetimeEarned: { increment: payout }
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

    for (const escrow of escrows) {
      const released = await tx.economyEscrow.updateMany({
        where: { id: escrow.id, status: "HELD" },
        data: {
          status: "RELEASED",
          releasedAt: new Date()
        }
      });

      if (released.count !== 1) {
        throw new EconomyError(
          "ESCROW_CHANGED",
          "Ставка матча уже обработана."
        );
      }

      if (escrow.userId !== input.winnerId) {
        await tx.economyAccount.update({
          where: {
            guildId_userId: {
              guildId: input.guildId,
              userId: escrow.userId
            }
          },
          data: {
            lifetimeSpent: { increment: escrow.amount }
          }
        });
      }
    }

    await ledger(tx, {
      guildId: input.guildId,
      userId: input.winnerId,
      amount: payout,
      walletDelta: payout,
      type: "GAME_WIN",
      referenceId: session.id,
      metadata: {
        gameType: session.gameType,
        pot: pot.toString(),
        fee: fee.toString(),
        reason: input.reason ?? null
      }
    });

    return tx.economyGameSession.update({
      where: { id: session.id },
      data: {
        status: "FINISHED",
        pot,
        winnerId: input.winnerId,
        settledAt: new Date()
      }
    });
  });
}

export async function cancelGameSession(input: {
  guildId: string;
  sessionId: string;
  actorId?: string;
  force?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.economyGameSession.findFirst({
      where: {
        id: input.sessionId,
        guildId: input.guildId,
        status: { in: ["WAITING", "ACTIVE"] }
      }
    });

    if (!session) {
      throw new EconomyError(
        "GAME_NOT_FOUND",
        "Игровая сессия не найдена."
      );
    }

    if (
      !input.force &&
      input.actorId &&
      ![session.hostId, session.opponentId].includes(input.actorId)
    ) {
      throw new EconomyError(
        "GAME_FORBIDDEN",
        "Нельзя отменить чужой матч."
      );
    }

    const claimed = await tx.economyGameSession.updateMany({
      where: {
        id: session.id,
        version: session.version,
        status: { in: ["WAITING", "ACTIVE"] }
      },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
        settledAt: new Date()
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "GAME_CHANGED",
        "Игровая сессия уже изменилась."
      );
    }

    const escrows = await tx.economyEscrow.findMany({
      where: {
        guildId: input.guildId,
        kind: "GAME",
        referenceId: session.id,
        status: "HELD"
      }
    });

    for (const escrow of escrows) {
      await refundEscrow(
        tx,
        escrow,
        "GAME_CANCEL_REFUND"
      );
    }

    return tx.economyGameSession.findUniqueOrThrow({
      where: { id: session.id }
    });
  });
}

export async function expireGameSessions(guildId: string) {
  const rows = await prisma.economyGameSession.findMany({
    where: {
      guildId,
      status: { in: ["WAITING", "ACTIVE"] },
      expiresAt: { lte: new Date() }
    },
    select: { id: true },
    take: 100
  });

  let cancelled = 0;

  for (const row of rows) {
    try {
      await cancelGameSession({
        guildId,
        sessionId: row.id,
        force: true
      });
      cancelled += 1;
    } catch (error) {
      if (
        !(error instanceof EconomyError) ||
        !["GAME_CHANGED", "GAME_NOT_FOUND"].includes(error.code)
      ) {
        throw error;
      }
    }
  }

  return { cancelled };
}

export async function createLotteryRound(input: {
  guildId: string;
  title: string;
  ticketPrice: bigint;
  maxTickets?: number | null;
  maxTicketsPerUser?: number | null;
  feeBps: number;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
}) {
  if (input.ticketPrice <= 0n) {
    throw new EconomyError(
      "INVALID_TICKET_PRICE",
      "Цена билета должна быть больше нуля."
    );
  }
  validFee(input.feeBps);

  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new EconomyError(
      "INVALID_LOTTERY_TIME",
      "Лотерея должна завершаться позже старта."
    );
  }

  return prisma.economyLotteryRound.create({
    data: {
      guildId: input.guildId,
      title: input.title.trim(),
      status:
        input.startsAt.getTime() <= Date.now()
          ? "ACTIVE"
          : "SCHEDULED",
      ticketPrice: input.ticketPrice,
      ...(input.maxTickets !== undefined
        ? { maxTickets: input.maxTickets }
        : {}),
      ...(input.maxTicketsPerUser !== undefined
        ? { maxTicketsPerUser: input.maxTicketsPerUser }
        : {}),
      feeBps: input.feeBps,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdBy: input.createdBy
    }
  });
}

export async function buyLotteryTickets(input: {
  guildId: string;
  roundId: string;
  userId: string;
  quantity: number;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new EconomyError(
      "INVALID_TICKET_QUANTITY",
      "Количество билетов должно быть положительным целым числом."
    );
  }

  return prisma.$transaction(async (tx) => {
    const round = await tx.economyLotteryRound.findFirst({
      where: {
        id: input.roundId,
        guildId: input.guildId,
        status: { in: ["SCHEDULED", "ACTIVE"] }
      }
    });

    if (!round) {
      throw new EconomyError(
        "LOTTERY_NOT_FOUND",
        "Лотерея не найдена."
      );
    }

    const now = new Date();

    if (round.startsAt.getTime() > now.getTime()) {
      throw new EconomyError(
        "LOTTERY_NOT_STARTED",
        "Продажа билетов ещё не началась."
      );
    }
    if (round.endsAt.getTime() <= now.getTime()) {
      throw new EconomyError(
        "LOTTERY_ENDED",
        "Продажа билетов уже закончилась."
      );
    }

    const [allTickets, userTickets] = await Promise.all([
      tx.economyLotteryTicket.aggregate({
        where: { roundId: round.id },
        _sum: { quantity: true }
      }),
      tx.economyLotteryTicket.aggregate({
        where: {
          roundId: round.id,
          userId: input.userId
        },
        _sum: { quantity: true }
      })
    ]);

    const totalBefore = allTickets._sum.quantity ?? 0;
    const userBefore = userTickets._sum.quantity ?? 0;

    if (
      round.maxTickets !== null &&
      totalBefore + input.quantity > round.maxTickets
    ) {
      throw new EconomyError(
        "LOTTERY_SOLD_OUT",
        "Столько билетов уже не осталось."
      );
    }

    if (
      round.maxTicketsPerUser !== null &&
      userBefore + input.quantity > round.maxTicketsPerUser
    ) {
      throw new EconomyError(
        "LOTTERY_USER_LIMIT",
        "Превышен лимит билетов на участника."
      );
    }

    const cost =
      round.ticketPrice * BigInt(input.quantity);

    const claimed = await tx.economyLotteryRound.updateMany({
      where: {
        id: round.id,
        version: round.version,
        status: { in: ["SCHEDULED", "ACTIVE"] },
        endsAt: { gt: now }
      },
      data: {
        status: "ACTIVE",
        pot: { increment: cost },
        version: { increment: 1 }
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "LOTTERY_CHANGED",
        "Лотерея изменилась одновременно с покупкой. Повтори попытку."
      );
    }

    await holdStake(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: cost,
      kind: "LOTTERY",
      referenceId: round.id,
      metadata: { quantity: input.quantity }
    });

    const ticket = await tx.economyLotteryTicket.create({
      data: {
        roundId: round.id,
        userId: input.userId,
        quantity: input.quantity,
        amount: cost
      }
    });

    return { ticket, cost };
  });
}

export async function settleLotteryRound(
  guildId: string,
  roundId: string
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.economyLotteryRound.findFirst({
      where: {
        id: roundId,
        guildId,
        status: { in: ["SCHEDULED", "ACTIVE"] },
        endsAt: { lte: new Date() }
      }
    });

    if (!round) {
      throw new EconomyError(
        "LOTTERY_NOT_SETTLEABLE",
        "Лотерея ещё не готова к розыгрышу."
      );
    }

    const claimed = await tx.economyLotteryRound.updateMany({
      where: {
        id: round.id,
        version: round.version,
        status: { in: ["SCHEDULED", "ACTIVE"] }
      },
      data: {
        status: "SETTLING",
        version: { increment: 1 }
      }
    });

    if (claimed.count !== 1) {
      throw new EconomyError(
        "LOTTERY_CHANGED",
        "Лотерея уже обрабатывается."
      );
    }

    const tickets = await tx.economyLotteryTicket.findMany({
      where: { roundId: round.id },
      orderBy: { createdAt: "asc" }
    });

    const totalQuantity = tickets.reduce(
      (total, ticket) => total + ticket.quantity,
      0
    );

    if (totalQuantity <= 0) {
      return tx.economyLotteryRound.update({
        where: { id: round.id },
        data: {
          status: "ENDED",
          settledAt: new Date()
        }
      });
    }

    if (totalQuantity > 2_000_000_000) {
      throw new EconomyError(
        "LOTTERY_TOO_LARGE",
        "Слишком много билетов для одного розыгрыша."
      );
    }

    let winnerIndex = randomInt(totalQuantity);
    let winnerId = tickets[0]?.userId ?? null;

    for (const ticket of tickets) {
      if (winnerIndex < ticket.quantity) {
        winnerId = ticket.userId;
        break;
      }
      winnerIndex -= ticket.quantity;
    }

    if (!winnerId) {
      throw new EconomyError(
        "LOTTERY_WINNER_MISSING",
        "Не удалось определить победителя."
      );
    }

    const escrows = await tx.economyEscrow.findMany({
      where: {
        guildId,
        kind: "LOTTERY",
        referenceId: round.id,
        status: "HELD"
      }
    });
    const pot = escrows.reduce(
      (sum, escrow) => sum + escrow.amount,
      0n
    );
    const fee = feeAmount(pot, round.feeBps);
    const payout = pot - fee;

    await ensureAccount(tx, guildId, winnerId);
    await ensureTreasury(tx, guildId);

    await tx.economyAccount.update({
      where: {
        guildId_userId: { guildId, userId: winnerId }
      },
      data: {
        wallet: { increment: payout },
        lifetimeEarned: { increment: payout }
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

    for (const escrow of escrows) {
      const released = await tx.economyEscrow.updateMany({
        where: { id: escrow.id, status: "HELD" },
        data: {
          status: "RELEASED",
          releasedAt: new Date()
        }
      });

      if (released.count !== 1) {
        throw new EconomyError(
          "ESCROW_CHANGED",
          "Один из билетов уже обработан."
        );
      }

      if (escrow.userId !== winnerId) {
        await tx.economyAccount.update({
          where: {
            guildId_userId: {
              guildId,
              userId: escrow.userId
            }
          },
          data: {
            lifetimeSpent: { increment: escrow.amount }
          }
        });
      }
    }

    await ledger(tx, {
      guildId,
      userId: winnerId,
      amount: payout,
      walletDelta: payout,
      type: "LOTTERY_WIN",
      referenceId: round.id,
      metadata: {
        pot: pot.toString(),
        fee: fee.toString()
      }
    });

    return tx.economyLotteryRound.update({
      where: { id: round.id },
      data: {
        status: "ENDED",
        winnerId,
        pot,
        settledAt: new Date()
      }
    });
  });
}

export async function settleDueLotteries(guildId: string) {
  const due = await prisma.economyLotteryRound.findMany({
    where: {
      guildId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { lte: new Date() }
    },
    select: { id: true },
    take: 100
  });

  let settled = 0;

  for (const round of due) {
    try {
      await settleLotteryRound(guildId, round.id);
      settled += 1;
    } catch (error) {
      if (
        !(error instanceof EconomyError) ||
        !["LOTTERY_CHANGED", "LOTTERY_NOT_SETTLEABLE"].includes(error.code)
      ) {
        throw error;
      }
    }
  }

  return { settled };
}
