import { prisma } from "./client.js";

export class EconomyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EconomyError";
  }
}

type JsonRecord = Record<string, unknown>;

type LedgerInput = {
  guildId: string;
  userId: string;
  amount: bigint;
  walletDelta?: bigint;
  bankDelta?: bigint;
  type: string;
  counterpartyUserId?: string | null | undefined;
  referenceId?: string | null | undefined;
  metadata?: JsonRecord | null | undefined;
};

function positiveAmount(amount: bigint) {
  if (amount <= 0n) {
    throw new EconomyError(
      "INVALID_AMOUNT",
      "Сумма должна быть больше нуля."
    );
  }
}

function basisPoints(amount: bigint, bps: number) {
  if (bps <= 0) return 0n;
  return (amount * BigInt(bps) + 9999n) / 10000n;
}

function json(value: JsonRecord | null | undefined) {
  return value ? JSON.parse(JSON.stringify(value)) : undefined;
}

async function ensureAccountTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  guildId: string,
  userId: string
) {
  return tx.economyAccount.upsert({
    where: {
      guildId_userId: {
        guildId,
        userId
      }
    },
    update: {},
    create: {
      guildId,
      userId
    }
  });
}

async function ensureTreasuryTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  guildId: string
) {
  return tx.economyTreasury.upsert({
    where: { guildId },
    update: {},
    create: { guildId }
  });
}

async function ledgerTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: LedgerInput
) {
  return tx.economyTransaction.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      counterpartyUserId: input.counterpartyUserId ?? null,
      amount: input.amount,
      walletDelta: input.walletDelta ?? 0n,
      bankDelta: input.bankDelta ?? 0n,
      type: input.type,
      referenceId: input.referenceId ?? null,
      metadata: json(input.metadata)
    }
  });
}

export async function getEconomyAccount(
  guildId: string,
  userId: string
) {
  return prisma.economyAccount.upsert({
    where: {
      guildId_userId: {
        guildId,
        userId
      }
    },
    update: {},
    create: {
      guildId,
      userId
    }
  });
}

export async function listEconomyTransactions(
  guildId: string,
  userId: string,
  take = 25
) {
  return prisma.economyTransaction.findMany({
    where: { guildId, userId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(take, 100))
  });
}

export async function grantWallet(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  type: string;
  referenceId?: string;
  metadata?: JsonRecord;
  countAsIncome?: boolean;
}) {
  positiveAmount(input.amount);

  return prisma.$transaction(async (tx) => {
    await ensureAccountTx(tx, input.guildId, input.userId);
    await ensureTreasuryTx(tx, input.guildId);

    const account = await tx.economyAccount.update({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: input.userId
        }
      },
      data: {
        wallet: { increment: input.amount },
        ...(input.countAsIncome !== false
          ? { lifetimeEarned: { increment: input.amount } }
          : {})
      }
    });

    await tx.economyTreasury.update({
      where: { guildId: input.guildId },
      data: {
        minted: { increment: input.amount }
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: input.amount,
      walletDelta: input.amount,
      type: input.type,
      referenceId: input.referenceId,
      metadata: input.metadata
    });

    return account;
  });
}

export async function removeWallet(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  type: string;
  referenceId?: string;
  metadata?: JsonRecord;
  burn?: boolean;
}) {
  positiveAmount(input.amount);

  return prisma.$transaction(async (tx) => {
    const account = await ensureAccountTx(
      tx,
      input.guildId,
      input.userId
    );
    await ensureTreasuryTx(tx, input.guildId);

    if (account.frozenAt) {
      throw new EconomyError(
        "ACCOUNT_FROZEN",
        "Экономический аккаунт заморожен."
      );
    }

    const updated = await tx.economyAccount.updateMany({
      where: {
        id: account.id,
        wallet: { gte: input.amount }
      },
      data: {
        wallet: { decrement: input.amount },
        lifetimeSpent: { increment: input.amount }
      }
    });

    if (updated.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        "Недостаточно NEC в кошельке."
      );
    }

    if (input.burn) {
      await tx.economyTreasury.update({
        where: { guildId: input.guildId },
        data: {
          burned: { increment: input.amount }
        }
      });
    } else {
      await tx.economyTreasury.update({
        where: { guildId: input.guildId },
        data: {
          balance: { increment: input.amount }
        }
      });
    }

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: -input.amount,
      walletDelta: -input.amount,
      type: input.type,
      referenceId: input.referenceId,
      metadata: input.metadata
    });

    return tx.economyAccount.findUniqueOrThrow({
      where: { id: account.id }
    });
  });
}

export async function moveBetweenWalletAndBank(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  direction: "DEPOSIT" | "WITHDRAW";
}) {
  positiveAmount(input.amount);

  return prisma.$transaction(async (tx) => {
    const account = await ensureAccountTx(
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

    const isDeposit = input.direction === "DEPOSIT";

    const updated = await tx.economyAccount.updateMany({
      where: {
        id: account.id,
        ...(isDeposit
          ? { wallet: { gte: input.amount } }
          : { bank: { gte: input.amount } })
      },
      data: isDeposit
        ? {
            wallet: { decrement: input.amount },
            bank: { increment: input.amount }
          }
        : {
            bank: { decrement: input.amount },
            wallet: { increment: input.amount }
          }
    });

    if (updated.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        isDeposit
          ? "Недостаточно NEC в кошельке."
          : "Недостаточно NEC в банке."
      );
    }

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: 0n,
      walletDelta: isDeposit ? -input.amount : input.amount,
      bankDelta: isDeposit ? input.amount : -input.amount,
      type: isDeposit ? "BANK_DEPOSIT" : "BANK_WITHDRAW",
      metadata: {
        moved: input.amount.toString()
      }
    });

    return tx.economyAccount.findUniqueOrThrow({
      where: { id: account.id }
    });
  });
}

export async function transferWallet(input: {
  guildId: string;
  fromUserId: string;
  toUserId: string;
  amount: bigint;
  feeBps: number;
}) {
  positiveAmount(input.amount);

  if (input.fromUserId === input.toUserId) {
    throw new EconomyError(
      "SELF_TRANSFER",
      "Нельзя переводить NEC самому себе."
    );
  }

  const fee = basisPoints(input.amount, input.feeBps);
  const total = input.amount + fee;
  const referenceId =
    "transfer_" + Date.now().toString(36) + "_" + input.fromUserId;

  return prisma.$transaction(async (tx) => {
    const sender = await ensureAccountTx(
      tx,
      input.guildId,
      input.fromUserId
    );
    await ensureAccountTx(tx, input.guildId, input.toUserId);
    await ensureTreasuryTx(tx, input.guildId);

    if (sender.frozenAt) {
      throw new EconomyError(
        "ACCOUNT_FROZEN",
        "Экономический аккаунт заморожен."
      );
    }

    const debit = await tx.economyAccount.updateMany({
      where: {
        id: sender.id,
        wallet: { gte: total }
      },
      data: {
        wallet: { decrement: total },
        lifetimeSpent: { increment: fee }
      }
    });

    if (debit.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        "Недостаточно NEC для перевода с учётом комиссии."
      );
    }

    await tx.economyAccount.update({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: input.toUserId
        }
      },
      data: {
        wallet: { increment: input.amount },
        lifetimeEarned: { increment: input.amount }
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

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.fromUserId,
      counterpartyUserId: input.toUserId,
      amount: -total,
      walletDelta: -total,
      type: "TRANSFER_OUT",
      referenceId,
      metadata: {
        sent: input.amount.toString(),
        fee: fee.toString()
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.toUserId,
      counterpartyUserId: input.fromUserId,
      amount: input.amount,
      walletDelta: input.amount,
      type: "TRANSFER_IN",
      referenceId,
      metadata: {
        received: input.amount.toString()
      }
    });

    return {
      amount: input.amount,
      fee,
      sender: await tx.economyAccount.findUniqueOrThrow({
        where: { id: sender.id }
      })
    };
  });
}

async function claimTimedReward(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  field:
    | "lastDailyAt"
    | "lastWorkAt"
    | "lastMessageRewardAt"
    | "lastVoiceRewardAt";
  cooldownMs: number;
  type: string;
}) {
  positiveAmount(input.amount);
  const now = new Date();
  const eligibleBefore = new Date(now.getTime() - input.cooldownMs);

  return prisma.$transaction(async (tx) => {
    const account = await ensureAccountTx(
      tx,
      input.guildId,
      input.userId
    );
    await ensureTreasuryTx(tx, input.guildId);

    if (account.frozenAt) {
      throw new EconomyError(
        "ACCOUNT_FROZEN",
        "Экономический аккаунт заморожен."
      );
    }

    const updated = await tx.economyAccount.updateMany({
      where: {
        id: account.id,
        OR: [
          { [input.field]: null },
          { [input.field]: { lte: eligibleBefore } }
        ]
      },
      data: {
        [input.field]: now,
        wallet: { increment: input.amount },
        lifetimeEarned: { increment: input.amount }
      }
    });

    if (updated.count !== 1) {
      const fresh = await tx.economyAccount.findUniqueOrThrow({
        where: { id: account.id }
      });
      const last = fresh[input.field];

      throw new EconomyError(
        "COOLDOWN",
        last
          ? new Date(
              last.getTime() + input.cooldownMs
            ).toISOString()
          : "Награда пока недоступна."
      );
    }

    await tx.economyTreasury.update({
      where: { guildId: input.guildId },
      data: {
        minted: { increment: input.amount }
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: input.amount,
      walletDelta: input.amount,
      type: input.type
    });

    return tx.economyAccount.findUniqueOrThrow({
      where: { id: account.id }
    });
  });
}

export function claimDailyReward(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  cooldownHours: number;
}) {
  return claimTimedReward({
    ...input,
    field: "lastDailyAt",
    cooldownMs: input.cooldownHours * 60 * 60 * 1000,
    type: "DAILY_REWARD"
  });
}

export function claimWorkReward(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  cooldownMinutes: number;
}) {
  return claimTimedReward({
    ...input,
    field: "lastWorkAt",
    cooldownMs: input.cooldownMinutes * 60 * 1000,
    type: "WORK_REWARD"
  });
}

export function claimActivityReward(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  kind: "MESSAGE" | "VOICE";
  cooldownSeconds: number;
}) {
  return claimTimedReward({
    guildId: input.guildId,
    userId: input.userId,
    amount: input.amount,
    field:
      input.kind === "MESSAGE"
        ? "lastMessageRewardAt"
        : "lastVoiceRewardAt",
    cooldownMs: input.cooldownSeconds * 1000,
    type:
      input.kind === "MESSAGE"
        ? "CHAT_ACTIVITY_REWARD"
        : "VOICE_ACTIVITY_REWARD"
  });
}

export async function createEconomyItem(input: {
  guildId: string;
  sku: string;
  name: string;
  description?: string | null;
  rarity: string;
  itemType: string;
  imageUrl?: string | null;
  roleId?: string | null;
  price: bigint;
  stock?: number | null;
  maxPerUser?: number | null;
  tradable?: boolean;
  giftable?: boolean;
  metadata?: JsonRecord | null;
  createdBy: string;
}) {
  if (input.price < 0n) {
    throw new EconomyError(
      "INVALID_PRICE",
      "Цена предмета не может быть отрицательной."
    );
  }

  return prisma.economyItemDefinition.create({
    data: {
      guildId: input.guildId,
      sku: input.sku.trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description ?? null,
      rarity: input.rarity.toUpperCase(),
      itemType: input.itemType.toUpperCase(),
      imageUrl: input.imageUrl ?? null,
      roleId: input.roleId ?? null,
      price: input.price,
      stock: input.stock ?? null,
      maxPerUser: input.maxPerUser ?? null,
      tradable: input.tradable ?? true,
      giftable: input.giftable ?? true,
      metadata: json(input.metadata),
      createdBy: input.createdBy
    }
  });
}

export function listShopItems(guildId: string) {
  return prisma.economyItemDefinition.findMany({
    where: {
      guildId,
      active: true,
      OR: [
        { stock: null },
        { stock: { gt: 0 } }
      ]
    },
    orderBy: [
      { rarity: "asc" },
      { price: "asc" },
      { createdAt: "asc" }
    ]
  });
}

export async function buyShopItem(input: {
  guildId: string;
  userId: string;
  itemId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.economyItemDefinition.findFirst({
      where: {
        id: input.itemId,
        guildId: input.guildId,
        active: true
      }
    });

    if (!item) {
      throw new EconomyError(
        "ITEM_NOT_FOUND",
        "Предмет не найден или снят с продажи."
      );
    }

    if (item.stock !== null && item.stock <= 0) {
      throw new EconomyError("OUT_OF_STOCK", "Предмет закончился.");
    }

    const account = await ensureAccountTx(
      tx,
      input.guildId,
      input.userId
    );
    await ensureTreasuryTx(tx, input.guildId);

    if (account.frozenAt) {
      throw new EconomyError(
        "ACCOUNT_FROZEN",
        "Экономический аккаунт заморожен."
      );
    }

    if (item.maxPerUser !== null) {
      const owned = await tx.economyItemInstance.count({
        where: {
          guildId: input.guildId,
          ownerId: input.userId,
          itemId: item.id
        }
      });

      if (owned >= item.maxPerUser) {
        throw new EconomyError(
          "ITEM_LIMIT",
          "Достигнут лимит этого предмета в инвентаре."
        );
      }
    }

    const debit = await tx.economyAccount.updateMany({
      where: {
        id: account.id,
        wallet: { gte: item.price }
      },
      data: {
        wallet: { decrement: item.price },
        lifetimeSpent: { increment: item.price }
      }
    });

    if (debit.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        "Недостаточно NEC в кошельке."
      );
    }

    const reserved = await tx.economyItemDefinition.updateMany({
      where: {
        id: item.id,
        nextSerial: item.nextSerial,
        ...(item.stock !== null ? { stock: { gt: 0 } } : {})
      },
      data: {
        nextSerial: { increment: 1 },
        ...(item.stock !== null
          ? { stock: { decrement: 1 } }
          : {})
      }
    });

    if (reserved.count !== 1) {
      throw new EconomyError(
        "ITEM_CHANGED",
        "Предмет только что изменился. Повтори покупку."
      );
    }

    const instance = await tx.economyItemInstance.create({
      data: {
        guildId: input.guildId,
        itemId: item.id,
        ownerId: input.userId,
        serialNumber: item.nextSerial,
        acquiredFrom: "SHOP"
      },
      include: {
        item: true
      }
    });

    await tx.economyTreasury.update({
      where: { guildId: input.guildId },
      data: {
        balance: { increment: item.price }
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: -item.price,
      walletDelta: -item.price,
      type: "SHOP_PURCHASE",
      referenceId: instance.id,
      metadata: {
        itemId: item.id,
        sku: item.sku,
        serialNumber: item.nextSerial
      }
    });

    return {
      instance,
      account: await tx.economyAccount.findUniqueOrThrow({
        where: { id: account.id }
      })
    };
  });
}

export function listInventory(
  guildId: string,
  userId: string,
  take = 100
) {
  return prisma.economyItemInstance.findMany({
    where: {
      guildId,
      ownerId: userId
    },
    include: {
      item: true
    },
    orderBy: {
      acquiredAt: "desc"
    },
    take: Math.max(1, Math.min(take, 250))
  });
}

export async function giftItem(input: {
  guildId: string;
  fromUserId: string;
  toUserId: string;
  instanceId: string;
}) {
  if (input.fromUserId === input.toUserId) {
    throw new EconomyError(
      "SELF_GIFT",
      "Нельзя подарить предмет самому себе."
    );
  }

  return prisma.$transaction(async (tx) => {
    const instance = await tx.economyItemInstance.findFirst({
      where: {
        id: input.instanceId,
        guildId: input.guildId,
        ownerId: input.fromUserId
      },
      include: {
        item: true
      }
    });

    if (!instance) {
      throw new EconomyError(
        "ITEM_NOT_FOUND",
        "Такого предмета нет в твоём инвентаре."
      );
    }

    if (!instance.item.giftable) {
      throw new EconomyError(
        "ITEM_NOT_GIFTABLE",
        "Этот предмет нельзя дарить."
      );
    }

    if (
      instance.lockedUntil &&
      instance.lockedUntil.getTime() > Date.now()
    ) {
      throw new EconomyError(
        "ITEM_LOCKED",
        "Предмет временно заблокирован."
      );
    }

    const moved = await tx.economyItemInstance.updateMany({
      where: {
        id: instance.id,
        ownerId: input.fromUserId
      },
      data: {
        ownerId: input.toUserId,
        acquiredFrom: "GIFT",
        acquiredAt: new Date()
      }
    });

    if (moved.count !== 1) {
      throw new EconomyError(
        "ITEM_CHANGED",
        "Владелец предмета уже изменился."
      );
    }

    const referenceId = "gift_" + instance.id + "_" + Date.now();

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.fromUserId,
      counterpartyUserId: input.toUserId,
      amount: 0n,
      type: "ITEM_GIFT_OUT",
      referenceId,
      metadata: {
        instanceId: instance.id,
        itemId: instance.itemId,
        serialNumber: instance.serialNumber
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.toUserId,
      counterpartyUserId: input.fromUserId,
      amount: 0n,
      type: "ITEM_GIFT_IN",
      referenceId,
      metadata: {
        instanceId: instance.id,
        itemId: instance.itemId,
        serialNumber: instance.serialNumber
      }
    });

    return tx.economyItemInstance.findUniqueOrThrow({
      where: { id: instance.id },
      include: { item: true }
    });
  });
}

export async function takeLoan(input: {
  guildId: string;
  userId: string;
  amount: bigint;
  interestBps: number;
  dueDays: number;
  maxPrincipal: bigint;
}) {
  positiveAmount(input.amount);

  if (input.amount > input.maxPrincipal) {
    throw new EconomyError(
      "LOAN_LIMIT",
      "Сумма кредита выше разрешённого лимита."
    );
  }

  const interest = basisPoints(input.amount, input.interestBps);
  const balance = input.amount + interest;
  const dueAt = new Date(
    Date.now() + input.dueDays * 24 * 60 * 60 * 1000
  );

  return prisma.$transaction(async (tx) => {
    const active = await tx.economyLoan.findFirst({
      where: {
        guildId: input.guildId,
        userId: input.userId,
        status: { in: ["ACTIVE", "OVERDUE"] }
      }
    });

    if (active) {
      throw new EconomyError(
        "ACTIVE_LOAN",
        "Сначала нужно закрыть текущий кредит."
      );
    }

    await ensureAccountTx(tx, input.guildId, input.userId);
    await ensureTreasuryTx(tx, input.guildId);

    const loan = await tx.economyLoan.create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        principal: input.amount,
        balance,
        interestBps: input.interestBps,
        dueAt
      }
    });

    await tx.economyAccount.update({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: input.userId
        }
      },
      data: {
        wallet: { increment: input.amount }
      }
    });

    await tx.economyTreasury.update({
      where: { guildId: input.guildId },
      data: {
        minted: { increment: input.amount }
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: input.amount,
      walletDelta: input.amount,
      type: "LOAN_DISBURSEMENT",
      referenceId: loan.id,
      metadata: {
        principal: input.amount.toString(),
        interest: interest.toString(),
        dueAt: dueAt.toISOString()
      }
    });

    return loan;
  });
}

export async function repayLoan(input: {
  guildId: string;
  userId: string;
  amount: bigint;
}) {
  positiveAmount(input.amount);

  return prisma.$transaction(async (tx) => {
    const loan = await tx.economyLoan.findFirst({
      where: {
        guildId: input.guildId,
        userId: input.userId,
        status: { in: ["ACTIVE", "OVERDUE"] }
      },
      orderBy: { createdAt: "asc" }
    });

    if (!loan) {
      throw new EconomyError(
        "NO_ACTIVE_LOAN",
        "Активного кредита нет."
      );
    }

    const payment =
      input.amount > loan.balance ? loan.balance : input.amount;
    const account = await ensureAccountTx(
      tx,
      input.guildId,
      input.userId
    );

    const debit = await tx.economyAccount.updateMany({
      where: {
        id: account.id,
        wallet: { gte: payment }
      },
      data: {
        wallet: { decrement: payment },
        lifetimeSpent: { increment: payment }
      }
    });

    if (debit.count !== 1) {
      throw new EconomyError(
        "INSUFFICIENT_FUNDS",
        "Недостаточно NEC в кошельке для платежа."
      );
    }

    const remaining = loan.balance - payment;

    await tx.economyLoan.update({
      where: { id: loan.id },
      data: {
        balance: remaining,
        status: remaining === 0n ? "PAID" : loan.status,
        paidAt: remaining === 0n ? new Date() : null
      }
    });

    await ensureTreasuryTx(tx, input.guildId);
    await tx.economyTreasury.update({
      where: { guildId: input.guildId },
      data: {
        balance: { increment: payment }
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: -payment,
      walletDelta: -payment,
      type: "LOAN_REPAYMENT",
      referenceId: loan.id,
      metadata: {
        remaining: remaining.toString()
      }
    });

    return {
      paid: payment,
      remaining
    };
  });
}

export function getActiveLoan(
  guildId: string,
  userId: string
) {
  return prisma.economyLoan.findFirst({
    where: {
      guildId,
      userId,
      status: { in: ["ACTIVE", "OVERDUE"] }
    },
    orderBy: { createdAt: "asc" }
  });
}

export async function createEconomySeason(input: {
  guildId: string;
  name: string;
  startsAt: Date;
  endsAt?: Date | null;
  resetBalances: boolean;
  createdBy: string;
}) {
  return prisma.economySeason.create({
    data: {
      guildId: input.guildId,
      name: input.name.trim(),
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      resetBalances: input.resetBalances,
      createdBy: input.createdBy
    }
  });
}

export async function activateEconomySeason(
  guildId: string,
  seasonId: string
) {
  return prisma.$transaction(async (tx) => {
    const season = await tx.economySeason.findFirst({
      where: {
        id: seasonId,
        guildId
      }
    });

    if (!season) {
      throw new EconomyError(
        "SEASON_NOT_FOUND",
        "Сезон экономики не найден."
      );
    }

    await tx.economySeason.updateMany({
      where: {
        guildId,
        status: "ACTIVE"
      },
      data: {
        status: "FINISHED",
        endsAt: new Date()
      }
    });

    if (season.resetBalances) {
      await tx.economyAccount.updateMany({
        where: { guildId },
        data: {
          wallet: 0n,
          bank: 0n,
          seasonId: season.id
        }
      });
    } else {
      await tx.economyAccount.updateMany({
        where: { guildId },
        data: {
          seasonId: season.id
        }
      });
    }

    return tx.economySeason.update({
      where: { id: season.id },
      data: {
        status: "ACTIVE",
        startsAt: new Date()
      }
    });
  });
}


export function listRoleSalaries(guildId: string) {
  return prisma.economyRoleSalary.findMany({
    where: { guildId },
    orderBy: [
      { enabled: "desc" },
      { amount: "desc" }
    ]
  });
}

export async function upsertRoleSalary(input: {
  guildId: string;
  roleId: string;
  amount: bigint;
  intervalMinutes: number;
  createdBy: string;
}) {
  positiveAmount(input.amount);

  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 1) {
    throw new EconomyError(
      "INVALID_SALARY_INTERVAL",
      "Интервал зарплаты должен быть не меньше одной минуты."
    );
  }

  return prisma.economyRoleSalary.upsert({
    where: {
      guildId_roleId: {
        guildId: input.guildId,
        roleId: input.roleId
      }
    },
    update: {
      amount: input.amount,
      intervalMinutes: input.intervalMinutes,
      enabled: true,
      createdBy: input.createdBy
    },
    create: {
      guildId: input.guildId,
      roleId: input.roleId,
      amount: input.amount,
      intervalMinutes: input.intervalMinutes,
      createdBy: input.createdBy
    }
  });
}

export async function disableRoleSalary(
  guildId: string,
  roleId: string
) {
  const salary = await prisma.economyRoleSalary.findUnique({
    where: {
      guildId_roleId: {
        guildId,
        roleId
      }
    }
  });

  if (!salary) {
    throw new EconomyError(
      "SALARY_NOT_FOUND",
      "Для этой роли зарплата не настроена."
    );
  }

  return prisma.economyRoleSalary.update({
    where: { id: salary.id },
    data: { enabled: false }
  });
}

export async function claimRoleSalaries(input: {
  guildId: string;
  userId: string;
  roleIds: string[];
}) {
  if (input.roleIds.length === 0) {
    throw new EconomyError(
      "NO_SALARY_ROLES",
      "У тебя нет ролей с настроенной зарплатой."
    );
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const salaries = await tx.economyRoleSalary.findMany({
      where: {
        guildId: input.guildId,
        enabled: true,
        roleId: { in: input.roleIds }
      },
      orderBy: { amount: "desc" }
    });

    if (salaries.length === 0) {
      throw new EconomyError(
        "NO_SALARY_ROLES",
        "У тебя нет ролей с настроенной зарплатой."
      );
    }

    const claimed: Array<{
      salaryId: string;
      roleId: string;
      amount: bigint;
    }> = [];

    for (const salary of salaries) {
      const previous = await tx.economyRoleSalaryClaim.findUnique({
        where: {
          salaryId_userId: {
            salaryId: salary.id,
            userId: input.userId
          }
        }
      });

      const eligibleBefore = new Date(
        now.getTime() - salary.intervalMinutes * 60 * 1000
      );

      if (
        previous &&
        previous.lastClaimedAt.getTime() > eligibleBefore.getTime()
      ) {
        continue;
      }

      if (previous) {
        const updated = await tx.economyRoleSalaryClaim.updateMany({
          where: {
            id: previous.id,
            lastClaimedAt: { lte: eligibleBefore }
          },
          data: {
            lastClaimedAt: now
          }
        });

        if (updated.count !== 1) {
          continue;
        }
      } else {
        await tx.economyRoleSalaryClaim.create({
          data: {
            salaryId: salary.id,
            userId: input.userId,
            lastClaimedAt: now
          }
        });
      }

      claimed.push({
        salaryId: salary.id,
        roleId: salary.roleId,
        amount: salary.amount
      });
    }

    if (claimed.length === 0) {
      throw new EconomyError(
        "SALARY_COOLDOWN",
        "Зарплата по твоим ролям пока недоступна."
      );
    }

    const total = claimed.reduce(
      (sum, item) => sum + item.amount,
      0n
    );

    await ensureAccountTx(tx, input.guildId, input.userId);
    await ensureTreasuryTx(tx, input.guildId);

    const account = await tx.economyAccount.update({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: input.userId
        }
      },
      data: {
        wallet: { increment: total },
        lifetimeEarned: { increment: total }
      }
    });

    await tx.economyTreasury.update({
      where: { guildId: input.guildId },
      data: {
        minted: { increment: total }
      }
    });

    await ledgerTx(tx, {
      guildId: input.guildId,
      userId: input.userId,
      amount: total,
      walletDelta: total,
      type: "ROLE_SALARY",
      metadata: {
        salaries: claimed.map((item) => ({
          salaryId: item.salaryId,
          roleId: item.roleId,
          amount: item.amount.toString()
        }))
      }
    });

    return {
      total,
      claimed,
      account
    };
  });
}

export async function markOverdueEconomyLoans(guildId: string) {
  const now = new Date();

  return prisma.economyLoan.updateMany({
    where: {
      guildId,
      status: "ACTIVE",
      dueAt: { lt: now },
      balance: { gt: 0n }
    },
    data: {
      status: "OVERDUE"
    }
  });
}

export async function applyWealthTax(input: {
  guildId: string;
  rateBps: number;
  minimumTotal: bigint;
  actorId: string;
}) {
  if (
    !Number.isInteger(input.rateBps) ||
    input.rateBps < 0 ||
    input.rateBps > 10000
  ) {
    throw new EconomyError(
      "INVALID_TAX_RATE",
      "Налог должен быть от 0 до 100 процентов."
    );
  }

  if (input.rateBps === 0) {
    return {
      affectedAccounts: 0,
      collected: 0n
    };
  }

  return prisma.$transaction(async (tx) => {
    const accounts = await tx.economyAccount.findMany({
      where: {
        guildId: input.guildId
      }
    });

    await ensureTreasuryTx(tx, input.guildId);

    let affectedAccounts = 0;
    let collected = 0n;
    const referenceId =
      "wealth_tax_" + Date.now().toString(36);

    for (const account of accounts) {
      const total = account.wallet + account.bank;

      if (total < input.minimumTotal || total <= 0n) {
        continue;
      }

      const requestedTax = basisPoints(total, input.rateBps);
      const tax = requestedTax > total ? total : requestedTax;

      if (tax <= 0n) {
        continue;
      }

      const walletTax =
        account.wallet >= tax ? tax : account.wallet;
      const bankTax = tax - walletTax;

      await tx.economyAccount.update({
        where: { id: account.id },
        data: {
          ...(walletTax > 0n
            ? { wallet: { decrement: walletTax } }
            : {}),
          ...(bankTax > 0n
            ? { bank: { decrement: bankTax } }
            : {}),
          lifetimeSpent: { increment: tax }
        }
      });

      await ledgerTx(tx, {
        guildId: input.guildId,
        userId: account.userId,
        amount: -tax,
        walletDelta: -walletTax,
        bankDelta: -bankTax,
        type: "WEALTH_TAX",
        referenceId,
        metadata: {
          actorId: input.actorId,
          rateBps: input.rateBps,
          minimumTotal: input.minimumTotal.toString(),
          totalBefore: total.toString()
        }
      });

      affectedAccounts += 1;
      collected += tax;
    }

    if (collected > 0n) {
      await tx.economyTreasury.update({
        where: { guildId: input.guildId },
        data: {
          balance: { increment: collected }
        }
      });
    }

    return {
      affectedAccounts,
      collected
    };
  });
}
