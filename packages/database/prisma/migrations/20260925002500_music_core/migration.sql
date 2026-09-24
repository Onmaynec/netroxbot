CREATE TABLE "MusicPlaylist" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicPlaylistTrack" (
  "id" TEXT NOT NULL,
  "playlistId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "trackKey" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "uri" TEXT,
  "artworkUrl" TEXT,
  "durationMs" BIGINT NOT NULL,
  "isStream" BOOLEAN NOT NULL DEFAULT false,
  "addedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicPlaylistTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicFavorite" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trackKey" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "uri" TEXT,
  "artworkUrl" TEXT,
  "durationMs" BIGINT NOT NULL,
  "isStream" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicFavorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicHistory" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trackKey" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "uri" TEXT,
  "artworkUrl" TEXT,
  "durationMs" BIGINT NOT NULL,
  "isStream" BOOLEAN NOT NULL DEFAULT false,
  "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicPlayerState" (
  "guildId" TEXT NOT NULL,
  "voiceChannelId" TEXT,
  "textChannelId" TEXT,
  "controllerMessageId" TEXT,
  "volume" INTEGER NOT NULL DEFAULT 50,
  "positionMs" BIGINT NOT NULL DEFAULT 0,
  "loopMode" TEXT NOT NULL DEFAULT 'none',
  "autoplay" BOOLEAN NOT NULL DEFAULT false,
  "stayConnected" BOOLEAN NOT NULL DEFAULT false,
  "lastTrack" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicPlayerState_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "MusicQueueEntry" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "requesterId" TEXT NOT NULL,
  "trackKey" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "uri" TEXT,
  "artworkUrl" TEXT,
  "durationMs" BIGINT NOT NULL,
  "isStream" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicQueueEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MusicPlaylist_guildId_ownerId_name_key"
  ON "MusicPlaylist"("guildId", "ownerId", "name");
CREATE INDEX "MusicPlaylist_guildId_ownerId_updatedAt_idx"
  ON "MusicPlaylist"("guildId", "ownerId", "updatedAt");

CREATE UNIQUE INDEX "MusicPlaylistTrack_playlistId_position_key"
  ON "MusicPlaylistTrack"("playlistId", "position");
CREATE INDEX "MusicPlaylistTrack_playlistId_trackKey_idx"
  ON "MusicPlaylistTrack"("playlistId", "trackKey");

CREATE UNIQUE INDEX "MusicFavorite_guildId_userId_trackKey_key"
  ON "MusicFavorite"("guildId", "userId", "trackKey");
CREATE INDEX "MusicFavorite_guildId_userId_createdAt_idx"
  ON "MusicFavorite"("guildId", "userId", "createdAt");

CREATE INDEX "MusicHistory_guildId_userId_playedAt_idx"
  ON "MusicHistory"("guildId", "userId", "playedAt");
CREATE INDEX "MusicHistory_guildId_playedAt_idx"
  ON "MusicHistory"("guildId", "playedAt");

CREATE UNIQUE INDEX "MusicQueueEntry_guildId_position_key"
  ON "MusicQueueEntry"("guildId", "position");
CREATE INDEX "MusicQueueEntry_guildId_position_idx"
  ON "MusicQueueEntry"("guildId", "position");

ALTER TABLE "MusicPlaylistTrack"
  ADD CONSTRAINT "MusicPlaylistTrack_playlistId_fkey"
  FOREIGN KEY ("playlistId") REFERENCES "MusicPlaylist"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
