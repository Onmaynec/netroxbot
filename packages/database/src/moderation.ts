import { prisma } from "./client.js";

export type ModerationCaseInput = {
  guildId: string;
  moderatorId: string;
  type:
    | "WARN"
    | "TIMEOUT"
    | "MUTE"
    | "KICK"
    | "BAN"
    | "TEMP_BAN"
    | "UNWARN"
    | "CLEAR"
    | "SLOWMODE"
    | "LOCK"
    | "UNLOCK";
  reason: string;
  targetUserId?: string | null;
  targetChannelId?: string | null;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
  dmDelivered?: boolean | null;
  evidence?: Record<string, unknown> | null;
};

export async function createModerationCase(input: ModerationCaseInput) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ caseNumber: number }>>`
      INSERT INTO "ModerationCounter" ("guildId", "nextCaseNumber")
      VALUES (${input.guildId}, 2)
      ON CONFLICT ("guildId")
      DO UPDATE SET "nextCaseNumber" = "ModerationCounter"."nextCaseNumber" + 1
      RETURNING "nextCaseNumber" - 1 AS "caseNumber"
    `;

    const caseNumber = rows[0]?.caseNumber;

    if (!caseNumber) {
      throw new Error("Не удалось выделить номер moderation-кейса.");
    }

    const moderationCase = await tx.moderationCase.create({
      data: {
        caseNumber,
        guildId: input.guildId,
        targetUserId: input.targetUserId ?? null,
        targetChannelId: input.targetChannelId ?? null,
        moderatorId: input.moderatorId,
        type: input.type,
        reason: input.reason,
        durationSeconds: input.durationSeconds ?? null,
        expiresAt: input.expiresAt ?? null,
        dmDelivered: input.dmDelivered ?? null,
        evidence: input.evidence
          ? JSON.parse(JSON.stringify(input.evidence))
          : undefined
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.moderatorId,
        action: "moderation.case.create",
        targetType: "moderation_case",
        targetId: moderationCase.id,
        payload: {
          caseNumber,
          type: input.type,
          targetUserId: input.targetUserId ?? null,
          targetChannelId: input.targetChannelId ?? null,
          expiresAt: input.expiresAt?.toISOString() ?? null
        }
      }
    });

    await tx.serverEvent.create({
      data: {
        guildId: input.guildId,
        category: "moderation",
        eventType: "moderation.case.create",
        actorId: input.moderatorId,
        targetType: input.targetUserId
          ? "user"
          : input.targetChannelId
            ? "channel"
            : "moderation_case",
        targetId:
          input.targetUserId ??
          input.targetChannelId ??
          moderationCase.id,
        channelId: input.targetChannelId ?? null,
        summary:
          "Создан moderation-кейс #" +
          caseNumber +
          " (" +
          input.type +
          ").",
        payload: {
          caseId: moderationCase.id,
          caseNumber,
          type: input.type,
          reason: input.reason,
          expiresAt: input.expiresAt?.toISOString() ?? null
        }
      }
    });

    return moderationCase;
  });
}

export async function getModerationCase(
  guildId: string,
  caseNumber: number
) {
  return prisma.moderationCase.findUnique({
    where: {
      guildId_caseNumber: {
        guildId,
        caseNumber
      }
    },
    include: {
      appeals: {
        orderBy: { createdAt: "desc" }
      }
    }
  });
}

export async function getUserModerationHistory(
  guildId: string,
  userId: string,
  take = 10
) {
  return prisma.moderationCase.findMany({
    where: {
      guildId,
      targetUserId: userId
    },
    orderBy: {
      createdAt: "desc"
    },
    take
  });
}

export async function getActiveWarnings(
  guildId: string,
  userId: string
) {
  return prisma.moderationCase.findMany({
    where: {
      guildId,
      targetUserId: userId,
      type: "WARN",
      status: "ACTIVE"
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function consumeActiveWarnings(
  guildId: string,
  userId: string
) {
  return prisma.moderationCase.updateMany({
    where: {
      guildId,
      targetUserId: userId,
      type: "WARN",
      status: "ACTIVE"
    },
    data: {
      status: "EXPIRED"
    }
  });
}

export async function cancelModerationCaseRecord(
  guildId: string,
  caseNumber: number,
  cancelledBy: string
) {
  const current = await getModerationCase(guildId, caseNumber);

  if (!current) {
    return null;
  }

  if (current.status !== "ACTIVE") {
    return current;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.moderationCase.update({
      where: {
        guildId_caseNumber: {
          guildId,
          caseNumber
        }
      },
      data: {
        status: "CANCELLED",
        cancelledBy,
        cancelledAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        guildId,
        actorId: cancelledBy,
        action: "moderation.case.cancel",
        targetType: "moderation_case",
        targetId: updated.id,
        payload: {
          caseNumber,
          type: updated.type
        }
      }
    });

    await tx.serverEvent.create({
      data: {
        guildId,
        category: "moderation",
        eventType: "moderation.case.cancel",
        actorId: cancelledBy,
        targetType: updated.targetUserId
          ? "user"
          : updated.targetChannelId
            ? "channel"
            : "moderation_case",
        targetId:
          updated.targetUserId ??
          updated.targetChannelId ??
          updated.id,
        channelId: updated.targetChannelId,
        summary:
          "Отменён moderation-кейс #" +
          caseNumber +
          " (" +
          updated.type +
          ").",
        payload: {
          caseId: updated.id,
          caseNumber,
          type: updated.type
        }
      }
    });

    return updated;
  });
}

export async function getDueModerationCases(guildId: string) {
  return prisma.moderationCase.findMany({
    where: {
      guildId,
      status: "ACTIVE",
      expiresAt: {
        lte: new Date()
      },
      type: {
        in: ["TIMEOUT", "MUTE", "TEMP_BAN"]
      }
    },
    orderBy: {
      expiresAt: "asc"
    },
    take: 100
  });
}

export async function markModerationCaseExpired(id: string) {
  return prisma.moderationCase.update({
    where: { id },
    data: {
      status: "EXPIRED"
    }
  });
}

export async function getModeratorStats(
  guildId: string,
  moderatorId: string,
  since?: Date
) {
  const cases = await prisma.moderationCase.findMany({
    where: since
      ? {
          guildId,
          moderatorId,
          createdAt: { gte: since }
        }
      : {
          guildId,
          moderatorId
        },
    select: {
      type: true,
      status: true
    }
  });

  const byType: Record<string, number> = {};

  for (const item of cases) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
  }

  return {
    total: cases.length,
    active: cases.filter((item) => item.status === "ACTIVE").length,
    cancelled: cases.filter((item) => item.status === "CANCELLED").length,
    expired: cases.filter((item) => item.status === "EXPIRED").length,
    byType
  };
}

export async function createAppeal(input: {
  guildId: string;
  caseNumber: number;
  userId: string;
  text: string;
}) {
  const moderationCase = await getModerationCase(
    input.guildId,
    input.caseNumber
  );

  if (!moderationCase || moderationCase.targetUserId !== input.userId) {
    return {
      ok: false as const,
      error: "CASE_NOT_FOUND" as const
    };
  }

  const duplicate = await prisma.appeal.findFirst({
    where: {
      caseId: moderationCase.id,
      userId: input.userId,
      status: "PENDING"
    }
  });

  if (duplicate) {
    return {
      ok: false as const,
      error: "ALREADY_PENDING" as const,
      appeal: duplicate
    };
  }

  const appeal = await prisma.$transaction(async (tx) => {
    const created = await tx.appeal.create({
      data: {
        guildId: input.guildId,
        caseId: moderationCase.id,
        userId: input.userId,
        text: input.text
      }
    });

    await tx.serverEvent.create({
      data: {
        guildId: input.guildId,
        category: "moderation",
        eventType: "moderation.appeal.create",
        actorId: input.userId,
        targetType: "user",
        targetId: input.userId,
        summary:
          "Создана апелляция на кейс #" +
          input.caseNumber +
          ".",
        payload: {
          appealId: created.id,
          caseId: moderationCase.id,
          caseNumber: input.caseNumber
        }
      }
    });

    return created;
  });

  return {
    ok: true as const,
    appeal,
    moderationCase
  };
}

export async function listPendingAppeals(guildId: string, take = 20) {
  return prisma.appeal.findMany({
    where: {
      guildId,
      status: "PENDING"
    },
    include: {
      case: true
    },
    orderBy: {
      createdAt: "asc"
    },
    take
  });
}

export async function getAppeal(id: string) {
  return prisma.appeal.findUnique({
    where: { id },
    include: {
      case: true
    }
  });
}

export async function reviewAppeal(input: {
  id: string;
  reviewerId: string;
  accepted: boolean;
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.appeal.update({
      where: { id: input.id },
      data: {
        status: input.accepted ? "ACCEPTED" : "REJECTED",
        reviewerId: input.reviewerId,
        reviewNote: input.note ?? null
      },
      include: {
        case: true
      }
    });

    await tx.serverEvent.create({
      data: {
        guildId: updated.guildId,
        category: "moderation",
        eventType: "moderation.appeal.review",
        actorId: input.reviewerId,
        targetType: "user",
        targetId: updated.userId,
        summary:
          "Апелляция по кейсу #" +
          updated.case.caseNumber +
          " " +
          (input.accepted ? "принята." : "отклонена."),
        payload: {
          appealId: updated.id,
          caseNumber: updated.case.caseNumber,
          accepted: input.accepted,
          note: input.note ?? null
        }
      }
    });

    return updated;
  });
}

export async function recordAutomodEvent(input: {
  guildId: string;
  userId: string;
  channelId: string;
  messageId?: string | null;
  ruleKey: string;
  action: string;
  metadata?: Record<string, unknown> | null;
}) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.automodEvent.create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        channelId: input.channelId,
        messageId: input.messageId ?? null,
        ruleKey: input.ruleKey,
        action: input.action,
        metadata: input.metadata
          ? JSON.parse(JSON.stringify(input.metadata))
          : undefined
      }
    });

    await tx.serverEvent.create({
      data: {
        guildId: input.guildId,
        category: "moderation",
        eventType: "automod.trigger",
        targetType: "user",
        targetId: input.userId,
        channelId: input.channelId,
        messageId: input.messageId ?? null,
        summary:
          "Сработал автомод: " +
          input.ruleKey +
          " → " +
          input.action +
          ".",
        payload: {
          automodEventId: event.id,
          ruleKey: input.ruleKey,
          action: input.action,
          metadata: input.metadata ?? null
        }
      }
    });

    return event;
  });
}
