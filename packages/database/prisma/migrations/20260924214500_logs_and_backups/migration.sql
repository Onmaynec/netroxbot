CREATE TABLE "ServerEvent" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorId" TEXT,
  "targetType" TEXT,
  "targetId" TEXT,
  "channelId" TEXT,
  "messageId" TEXT,
  "summary" TEXT NOT NULL,
  "payload" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServerEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackupRecord" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sizeBytes" BIGINT,
  "checksum" TEXT,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupRecord_fileName_key"
  ON "BackupRecord"("fileName");

CREATE INDEX "ServerEvent_guildId_occurredAt_idx"
  ON "ServerEvent"("guildId", "occurredAt");

CREATE INDEX "ServerEvent_guildId_category_occurredAt_idx"
  ON "ServerEvent"("guildId", "category", "occurredAt");

CREATE INDEX "ServerEvent_guildId_eventType_occurredAt_idx"
  ON "ServerEvent"("guildId", "eventType", "occurredAt");

CREATE INDEX "ServerEvent_guildId_targetId_occurredAt_idx"
  ON "ServerEvent"("guildId", "targetId", "occurredAt");

CREATE INDEX "BackupRecord_status_startedAt_idx"
  ON "BackupRecord"("status", "startedAt");
