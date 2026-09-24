ALTER TABLE "EconomyAccount"
  ADD COLUMN "lifetimeEarned" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "lifetimeSpent" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "lastDailyAt" TIMESTAMP(3),
  ADD COLUMN "lastWorkAt" TIMESTAMP(3),
  ADD COLUMN "frozenAt" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "EconomyTransaction"
  ADD COLUMN "counterpartyUserId" TEXT,
  ADD COLUMN "walletDelta" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "bankDelta" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "referenceId" TEXT;

CREATE TABLE "EconomySeason" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "resetBalances" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomySeason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyTreasury" (
  "guildId" TEXT NOT NULL,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "minted" BIGINT NOT NULL DEFAULT 0,
  "burned" BIGINT NOT NULL DEFAULT 0,
  "collectedFees" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomyTreasury_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "EconomyItemDefinition" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rarity" TEXT NOT NULL DEFAULT 'COMMON',
  "itemType" TEXT NOT NULL DEFAULT 'COLLECTIBLE',
  "imageUrl" TEXT,
  "roleId" TEXT,
  "price" BIGINT NOT NULL,
  "stock" INTEGER,
  "maxPerUser" INTEGER,
  "tradable" BOOLEAN NOT NULL DEFAULT true,
  "giftable" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomyItemDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyItemInstance" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "serialNumber" INTEGER NOT NULL,
  "variant" JSONB,
  "acquiredFrom" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  CONSTRAINT "EconomyItemInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyLoan" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "principal" BIGINT NOT NULL,
  "balance" BIGINT NOT NULL,
  "interestBps" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "EconomyLoan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyRoleSalary" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "intervalMinutes" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomyRoleSalary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyRoleSalaryClaim" (
  "id" TEXT NOT NULL,
  "salaryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastClaimedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomyRoleSalaryClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EconomyItemDefinition_guildId_sku_key"
  ON "EconomyItemDefinition"("guildId", "sku");
CREATE INDEX "EconomyItemDefinition_guildId_active_rarity_idx"
  ON "EconomyItemDefinition"("guildId", "active", "rarity");
CREATE UNIQUE INDEX "EconomyItemInstance_itemId_serialNumber_key"
  ON "EconomyItemInstance"("itemId", "serialNumber");
CREATE INDEX "EconomyItemInstance_guildId_ownerId_acquiredAt_idx"
  ON "EconomyItemInstance"("guildId", "ownerId", "acquiredAt");
CREATE INDEX "EconomyItemInstance_guildId_ownerId_itemId_idx"
  ON "EconomyItemInstance"("guildId", "ownerId", "itemId");
CREATE INDEX "EconomyLoan_guildId_userId_status_idx"
  ON "EconomyLoan"("guildId", "userId", "status");
CREATE INDEX "EconomyLoan_guildId_status_dueAt_idx"
  ON "EconomyLoan"("guildId", "status", "dueAt");
CREATE UNIQUE INDEX "EconomyRoleSalary_guildId_roleId_key"
  ON "EconomyRoleSalary"("guildId", "roleId");
CREATE UNIQUE INDEX "EconomyRoleSalaryClaim_salaryId_userId_key"
  ON "EconomyRoleSalaryClaim"("salaryId", "userId");
CREATE INDEX "EconomyRoleSalaryClaim_userId_lastClaimedAt_idx"
  ON "EconomyRoleSalaryClaim"("userId", "lastClaimedAt");
CREATE INDEX "EconomyAccount_guildId_wallet_idx"
  ON "EconomyAccount"("guildId", "wallet");
CREATE INDEX "EconomyAccount_guildId_bank_idx"
  ON "EconomyAccount"("guildId", "bank");
CREATE INDEX "EconomyTransaction_guildId_type_createdAt_idx"
  ON "EconomyTransaction"("guildId", "type", "createdAt");
CREATE INDEX "EconomyTransaction_referenceId_idx"
  ON "EconomyTransaction"("referenceId");
CREATE INDEX "EconomySeason_guildId_status_startsAt_idx"
  ON "EconomySeason"("guildId", "status", "startsAt");

ALTER TABLE "EconomyItemInstance"
  ADD CONSTRAINT "EconomyItemInstance_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "EconomyItemDefinition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EconomyRoleSalaryClaim"
  ADD CONSTRAINT "EconomyRoleSalaryClaim_salaryId_fkey"
  FOREIGN KEY ("salaryId") REFERENCES "EconomyRoleSalary"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
