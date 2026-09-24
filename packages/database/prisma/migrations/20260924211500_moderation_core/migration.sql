ALTER TYPE "PunishmentType" ADD VALUE IF NOT EXISTS 'UNWARN';
ALTER TYPE "PunishmentType" ADD VALUE IF NOT EXISTS 'CLEAR';
ALTER TYPE "PunishmentType" ADD VALUE IF NOT EXISTS 'SLOWMODE';
ALTER TYPE "PunishmentType" ADD VALUE IF NOT EXISTS 'LOCK';
ALTER TYPE "PunishmentType" ADD VALUE IF NOT EXISTS 'UNLOCK';

ALTER TABLE "Punishment"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "dmDelivered" BOOLEAN;

CREATE TABLE "ModerationCounter" (
  "guildId" TEXT NOT NULL,
  "nextCaseNumber" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ModerationCounter_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "AutomodEvent" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT,
  "ruleKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomodEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Punishment_guildId_channelId_idx"
  ON "Punishment"("guildId", "channelId");

CREATE INDEX "Punishment_guildId_moderatorId_createdAt_idx"
  ON "Punishment"("guildId", "moderatorId", "createdAt");

CREATE INDEX "Punishment_guildId_status_expiresAt_idx"
  ON "Punishment"("guildId", "status", "expiresAt");

CREATE INDEX "Appeal_punishmentId_status_idx"
  ON "Appeal"("punishmentId", "status");

CREATE INDEX "AutomodEvent_guildId_userId_createdAt_idx"
  ON "AutomodEvent"("guildId", "userId", "createdAt");

CREATE INDEX "AutomodEvent_guildId_ruleKey_createdAt_idx"
  ON "AutomodEvent"("guildId", "ruleKey", "createdAt");

ALTER TABLE "Appeal"
  ADD CONSTRAINT "Appeal_punishmentId_fkey"
  FOREIGN KEY ("punishmentId")
  REFERENCES "Punishment"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
