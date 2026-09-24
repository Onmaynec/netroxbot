import { prisma } from "./client.js";

export type MusicTrackData = {
  sourceName: string;
  identifier: string;
  title: string;
  author: string;
  uri?: string | null;
  artworkUrl?: string | null;
  durationMs: number | bigint;
  isStream?: boolean;
};

export type MusicQueueTrackData = MusicTrackData & {
  requesterId: string;
};

export function musicTrackKey(track: Pick<MusicTrackData, "sourceName" | "identifier">) {
  return track.sourceName + ":" + track.identifier;
}

function durationBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.max(0, Math.trunc(value)));
}

function baseTrackData(track: MusicTrackData) {
  return {
    trackKey: musicTrackKey(track),
    sourceName: track.sourceName,
    identifier: track.identifier,
    title: track.title,
    author: track.author,
    uri: track.uri ?? null,
    artworkUrl: track.artworkUrl ?? null,
    durationMs: durationBigInt(track.durationMs),
    isStream: track.isStream ?? false
  };
}

export async function recordMusicHistory(input: {
  guildId: string;
  userId: string;
  track: MusicTrackData;
}) {
  return prisma.musicHistory.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      ...baseTrackData(input.track)
    }
  });
}

export async function listMusicHistory(
  guildId: string,
  userId: string,
  take = 25
) {
  return prisma.musicHistory.findMany({
    where: { guildId, userId },
    orderBy: { playedAt: "desc" },
    take: Math.min(Math.max(take, 1), 100)
  });
}

export async function toggleMusicFavorite(input: {
  guildId: string;
  userId: string;
  track: MusicTrackData;
}) {
  const trackKey = musicTrackKey(input.track);
  const existing = await prisma.musicFavorite.findUnique({
    where: {
      guildId_userId_trackKey: {
        guildId: input.guildId,
        userId: input.userId,
        trackKey
      }
    }
  });

  if (existing) {
    await prisma.musicFavorite.delete({
      where: { id: existing.id }
    });

    return {
      favorite: false,
      record: existing
    };
  }

  const record = await prisma.musicFavorite.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      ...baseTrackData(input.track)
    }
  });

  return {
    favorite: true,
    record
  };
}

export async function listMusicFavorites(
  guildId: string,
  userId: string,
  take = 100
) {
  return prisma.musicFavorite.findMany({
    where: { guildId, userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 250)
  });
}

export async function createMusicPlaylist(input: {
  guildId: string;
  ownerId: string;
  name: string;
}) {
  return prisma.musicPlaylist.create({
    data: {
      guildId: input.guildId,
      ownerId: input.ownerId,
      name: input.name.trim()
    }
  });
}

export async function listMusicPlaylists(
  guildId: string,
  ownerId: string
) {
  return prisma.musicPlaylist.findMany({
    where: { guildId, ownerId },
    include: {
      _count: {
        select: { tracks: true }
      }
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getMusicPlaylist(input: {
  guildId: string;
  ownerId: string;
  name: string;
}) {
  return prisma.musicPlaylist.findUnique({
    where: {
      guildId_ownerId_name: {
        guildId: input.guildId,
        ownerId: input.ownerId,
        name: input.name.trim()
      }
    },
    include: {
      tracks: {
        orderBy: { position: "asc" }
      }
    }
  });
}

export async function deleteMusicPlaylist(input: {
  guildId: string;
  ownerId: string;
  name: string;
}) {
  return prisma.musicPlaylist.delete({
    where: {
      guildId_ownerId_name: {
        guildId: input.guildId,
        ownerId: input.ownerId,
        name: input.name.trim()
      }
    }
  });
}

export async function addTrackToMusicPlaylist(input: {
  guildId: string;
  ownerId: string;
  name: string;
  addedBy: string;
  track: MusicTrackData;
}) {
  return prisma.$transaction(async (tx) => {
    const playlist = await tx.musicPlaylist.findUnique({
      where: {
        guildId_ownerId_name: {
          guildId: input.guildId,
          ownerId: input.ownerId,
          name: input.name.trim()
        }
      }
    });

    if (!playlist) {
      throw new Error("PLAYLIST_NOT_FOUND");
    }

    const last = await tx.musicPlaylistTrack.findFirst({
      where: { playlistId: playlist.id },
      orderBy: { position: "desc" },
      select: { position: true }
    });

    const track = await tx.musicPlaylistTrack.create({
      data: {
        playlistId: playlist.id,
        position: (last?.position ?? -1) + 1,
        addedBy: input.addedBy,
        ...baseTrackData(input.track)
      }
    });

    await tx.musicPlaylist.update({
      where: { id: playlist.id },
      data: { updatedAt: new Date() }
    });

    return track;
  });
}

export async function removeTrackFromMusicPlaylist(input: {
  guildId: string;
  ownerId: string;
  name: string;
  position: number;
}) {
  return prisma.$transaction(async (tx) => {
    const playlist = await tx.musicPlaylist.findUnique({
      where: {
        guildId_ownerId_name: {
          guildId: input.guildId,
          ownerId: input.ownerId,
          name: input.name.trim()
        }
      }
    });

    if (!playlist) {
      throw new Error("PLAYLIST_NOT_FOUND");
    }

    const target = await tx.musicPlaylistTrack.findUnique({
      where: {
        playlistId_position: {
          playlistId: playlist.id,
          position: input.position
        }
      }
    });

    if (!target) {
      throw new Error("PLAYLIST_TRACK_NOT_FOUND");
    }

    await tx.musicPlaylistTrack.delete({
      where: { id: target.id }
    });

    const later = await tx.musicPlaylistTrack.findMany({
      where: {
        playlistId: playlist.id,
        position: { gt: input.position }
      },
      orderBy: { position: "asc" }
    });

    for (const item of later) {
      await tx.musicPlaylistTrack.update({
        where: { id: item.id },
        data: { position: item.position - 1 }
      });
    }

    await tx.musicPlaylist.update({
      where: { id: playlist.id },
      data: { updatedAt: new Date() }
    });

    return target;
  });
}

export async function saveMusicPlayerState(input: {
  guildId: string;
  voiceChannelId?: string | null;
  textChannelId?: string | null;
  controllerMessageId?: string | null;
  volume?: number;
  loopMode?: "none" | "track" | "queue";
  autoplay?: boolean;
  stayConnected?: boolean;
  lastTrack?: Record<string, unknown> | null;
}) {
  const update = {
    ...(input.voiceChannelId !== undefined
      ? { voiceChannelId: input.voiceChannelId }
      : {}),
    ...(input.textChannelId !== undefined
      ? { textChannelId: input.textChannelId }
      : {}),
    ...(input.controllerMessageId !== undefined
      ? { controllerMessageId: input.controllerMessageId }
      : {}),
    ...(input.volume !== undefined
      ? { volume: Math.min(Math.max(Math.trunc(input.volume), 1), 100) }
      : {}),
    ...(input.loopMode !== undefined
      ? { loopMode: input.loopMode }
      : {}),
    ...(input.autoplay !== undefined
      ? { autoplay: input.autoplay }
      : {}),
    ...(input.stayConnected !== undefined
      ? { stayConnected: input.stayConnected }
      : {}),
    ...(input.lastTrack !== undefined
      ? {
          lastTrack:
            input.lastTrack === null
              ? null
              : JSON.parse(JSON.stringify(input.lastTrack))
        }
      : {})
  };

  return prisma.musicPlayerState.upsert({
    where: { guildId: input.guildId },
    update,
    create: {
      guildId: input.guildId,
      voiceChannelId: input.voiceChannelId ?? null,
      textChannelId: input.textChannelId ?? null,
      controllerMessageId: input.controllerMessageId ?? null,
      volume: input.volume ?? 50,
      loopMode: input.loopMode ?? "none",
      autoplay: input.autoplay ?? false,
      stayConnected: input.stayConnected ?? false,
      lastTrack:
        input.lastTrack === undefined || input.lastTrack === null
          ? undefined
          : JSON.parse(JSON.stringify(input.lastTrack))
    }
  });
}

export async function getMusicPlayerState(guildId: string) {
  return prisma.musicPlayerState.findUnique({
    where: { guildId }
  });
}

export async function persistMusicQueue(
  guildId: string,
  tracks: readonly MusicQueueTrackData[]
) {
  return prisma.$transaction(async (tx) => {
    await tx.musicQueueEntry.deleteMany({
      where: { guildId }
    });

    if (tracks.length === 0) {
      return [];
    }

    await tx.musicQueueEntry.createMany({
      data: tracks.map((track, position) => ({
        guildId,
        position,
        requesterId: track.requesterId,
        ...baseTrackData(track)
      }))
    });

    return tx.musicQueueEntry.findMany({
      where: { guildId },
      orderBy: { position: "asc" }
    });
  });
}

export async function loadMusicQueue(guildId: string) {
  return prisma.musicQueueEntry.findMany({
    where: { guildId },
    orderBy: { position: "asc" }
  });
}

export async function clearMusicQueue(guildId: string) {
  return prisma.musicQueueEntry.deleteMany({
    where: { guildId }
  });
}
