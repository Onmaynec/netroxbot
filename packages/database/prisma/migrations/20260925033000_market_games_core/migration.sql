ALTER TABLE "EconomyItemInstance"
  ADD COLUMN "lockKind" TEXT,
  ADD COLUMN "lockId" TEXT;

CREATE INDEX "EconomyItemInstance_guildId_lockKind_lockId_idx"
  ON "EconomyItemInstance"("guildId", "lockKind", "lockId");

CREATE TABLE "EconomyMarketplaceListing" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "itemInstanceId" TEXT NOT NULL,
  "price" BIGINT NOT NULL,
  "feeBps" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "buyerId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "EconomyMarketplaceListing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyAuction" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'USER',
  "sellerId" TEXT,
  "itemInstanceId" TEXT,
  "itemDefinitionId" TEXT,
  "createdBy" TEXT NOT NULL,
  "startPrice" BIGINT NOT NULL,
  "minIncrement" BIGINT NOT NULL,
  "buyoutPrice" BIGINT,
  "currentBid" BIGINT,
  "currentBidderId" TEXT,
  "feeBps" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomyAuction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyAuctionBid" (
  "id" TEXT NOT NULL,
  "auctionId" TEXT NOT NULL,
  "bidderId" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EconomyAuctionBid_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyEscrow" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'HELD',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "EconomyEscrow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyGameSession" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "gameType" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "opponentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "stake" BIGINT NOT NULL DEFAULT 0,
  "pot" BIGINT NOT NULL DEFAULT 0,
  "winnerId" TEXT,
  "state" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EconomyGameSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyLotteryRound" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "ticketPrice" BIGINT NOT NULL,
  "maxTickets" INTEGER,
  "pot" BIGINT NOT NULL DEFAULT 0,
  "winnerId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EconomyLotteryRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EconomyLotteryTicket" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "amount" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EconomyLotteryTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EconomyMarketplaceListing_guildId_status_createdAt_idx"
  ON "EconomyMarketplaceListing"("guildId", "status", "createdAt");
CREATE INDEX "EconomyMarketplaceListing_guildId_sellerId_status_idx"
  ON "EconomyMarketplaceListing"("guildId", "sellerId", "status");
CREATE INDEX "EconomyMarketplaceListing_itemInstanceId_status_idx"
  ON "EconomyMarketplaceListing"("itemInstanceId", "status");

CREATE INDEX "EconomyAuction_guildId_status_startsAt_idx"
  ON "EconomyAuction"("guildId", "status", "startsAt");
CREATE INDEX "EconomyAuction_guildId_status_endsAt_idx"
  ON "EconomyAuction"("guildId", "status", "endsAt");
CREATE INDEX "EconomyAuction_guildId_sellerId_createdAt_idx"
  ON "EconomyAuction"("guildId", "sellerId", "createdAt");
CREATE INDEX "EconomyAuction_itemInstanceId_status_idx"
  ON "EconomyAuction"("itemInstanceId", "status");

CREATE INDEX "EconomyAuctionBid_auctionId_createdAt_idx"
  ON "EconomyAuctionBid"("auctionId", "createdAt");
CREATE INDEX "EconomyAuctionBid_auctionId_amount_idx"
  ON "EconomyAuctionBid"("auctionId", "amount");
CREATE INDEX "EconomyAuctionBid_bidderId_createdAt_idx"
  ON "EconomyAuctionBid"("bidderId", "createdAt");

CREATE INDEX "EconomyEscrow_guildId_kind_referenceId_status_idx"
  ON "EconomyEscrow"("guildId", "kind", "referenceId", "status");
CREATE INDEX "EconomyEscrow_guildId_userId_status_idx"
  ON "EconomyEscrow"("guildId", "userId", "status");

CREATE INDEX "EconomyGameSession_guildId_gameType_status_createdAt_idx"
  ON "EconomyGameSession"("guildId", "gameType", "status", "createdAt");
CREATE INDEX "EconomyGameSession_guildId_hostId_status_idx"
  ON "EconomyGameSession"("guildId", "hostId", "status");
CREATE INDEX "EconomyGameSession_guildId_opponentId_status_idx"
  ON "EconomyGameSession"("guildId", "opponentId", "status");

CREATE INDEX "EconomyLotteryRound_guildId_status_startsAt_idx"
  ON "EconomyLotteryRound"("guildId", "status", "startsAt");
CREATE INDEX "EconomyLotteryRound_guildId_status_endsAt_idx"
  ON "EconomyLotteryRound"("guildId", "status", "endsAt");
CREATE INDEX "EconomyLotteryTicket_roundId_userId_idx"
  ON "EconomyLotteryTicket"("roundId", "userId");
CREATE INDEX "EconomyLotteryTicket_userId_createdAt_idx"
  ON "EconomyLotteryTicket"("userId", "createdAt");

ALTER TABLE "EconomyAuctionBid"
  ADD CONSTRAINT "EconomyAuctionBid_auctionId_fkey"
  FOREIGN KEY ("auctionId") REFERENCES "EconomyAuction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EconomyLotteryTicket"
  ADD CONSTRAINT "EconomyLotteryTicket_roundId_fkey"
  FOREIGN KEY ("roundId") REFERENCES "EconomyLotteryRound"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
