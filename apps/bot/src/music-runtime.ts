import { Client } from "discord.js";
import { Kazagumo, type KazagumoPlayer, type KazagumoTrack } from "kazagumo";
import { Connectors } from "shoukaku";
import {
  clearMusicQueue,
  getMusicPlayerState,
  persistMusicQueue,
  recordMusicHistory,
  saveMusicPlayerState,
  type MusicQueueTrackData,
  type MusicTrackData,
  prisma
} from "@netrox/database";

export type MusicRuntime = {
  client: Client;
  guildId: string;
  kazagumo: Kazagumo;
  voteSkips: Map<string, { trackKey: string; voters: Set<string> }>;
  emptyVoiceTimers: Map<string, NodeJS.Timeout>;
  idleTimers: Map<string, NodeJS.Timeout>;
};

export type MusicSettings = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

export function musicRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function musicStringSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: string | null = null
) {
  const value = settings[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function musicNumberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function musicBooleanSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: boolean
) {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

export async function getMusicSettings(guildId: string): Promise<MusicSettings> {
  const config = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "music"
      }
    }
  });

  return {
    enabled: config?.enabled ?? true,
    settings: musicRecord(config?.settings)
  };
}

export function sourcePrefix(source: string | null) {
  switch (source) {
    case "youtube":
      return "ytsearch:";
    case "soundcloud":
      return "scsearch:";
    case "spotify":
      return "spsearch:";
    case "yandex_music":
      return "ymsearch:";
    case "youtube_music":
    default:
      return "ytmsearch:";
  }
}

export function musicTrackData(track: KazagumoTrack): MusicTrackData {
  return {
    sourceName: track.sourceName,
    identifier: track.identifier,
    title: track.title,
    author: track.author ?? "Неизвестный автор",
    uri: track.uri ?? null,
    artworkUrl: track.thumbnail ?? null,
    durationMs: track.length ?? 0,
    isStream: track.isStream
  };
}

export function requesterId(track: KazagumoTrack): string | null {
  const requester = track.requester;

  if (
    requester &&
    typeof requester === "object" &&
    "id" in requester &&
    typeof requester.id === "string"
  ) {
    return requester.id;
  }

  return null;
}

export function currentTrackKey(player: KazagumoPlayer) {
  const track = player.queue.current;
  return track ? track.sourceName + ":" + track.identifier : "none";
}

function queueTrackData(track: KazagumoTrack): MusicQueueTrackData {
  return {
    ...musicTrackData(track),
    requesterId: requesterId(track) ?? "unknown"
  };
}

export async function persistRuntimeQueue(
  runtime: MusicRuntime,
  player: KazagumoPlayer
) {
  await persistMusicQueue(
    runtime.guildId,
    Array.from(player.queue).map(queueTrackData)
  );
}

async function tryAutoplay(runtime: MusicRuntime, player: KazagumoPlayer) {
  const previous = player.queue.previous.at(-1);

  if (!previous) {
    return false;
  }

  const result = await runtime.kazagumo
    .search(
      (previous.author ? previous.author + " " : "") + previous.title,
      {
        requester: runtime.client.user,
        source: "ytmsearch:"
      }
    )
    .catch(() => null);

  const candidate = result?.tracks.find(
    (track) => track.identifier !== previous.identifier
  );

  if (!candidate) {
    return false;
  }

  player.queue.add(candidate);
  await player.play();
  return true;
}

async function handlePlayerEmpty(
  runtime: MusicRuntime,
  player: KazagumoPlayer
) {
  const config = await getMusicSettings(runtime.guildId);
  const state = await getMusicPlayerState(runtime.guildId);
  const autoplay =
    state?.autoplay ??
    musicBooleanSetting(config.settings, "autoplay", false);

  if (autoplay && (await tryAutoplay(runtime, player))) {
    return;
  }

  if (state?.stayConnected) {
    return;
  }

  const oldTimer = runtime.idleTimers.get(runtime.guildId);
  if (oldTimer) clearTimeout(oldTimer);

  const timer = setTimeout(() => {
    const current = runtime.kazagumo.getPlayer(runtime.guildId);

    if (current && current.queue.isEmpty && !current.queue.current) {
      void current.destroy();
      void clearMusicQueue(runtime.guildId);
      void saveMusicPlayerState({
        guildId: runtime.guildId,
        voiceChannelId: null,
        controllerMessageId: null,
        lastTrack: null
      });
    }
  }, 60_000);

  timer.unref();
  runtime.idleTimers.set(runtime.guildId, timer);
}

function registerEmptyVoiceLifecycle(runtime: MusicRuntime) {
  runtime.client.on("voiceStateUpdate", async (oldState, newState) => {
    if (newState.guild.id !== runtime.guildId) {
      return;
    }

    const player = runtime.kazagumo.getPlayer(runtime.guildId);

    if (!player?.voiceId) {
      return;
    }

    if (
      oldState.channelId !== player.voiceId &&
      newState.channelId !== player.voiceId
    ) {
      return;
    }

    const channel = newState.guild.channels.cache.get(player.voiceId);

    if (!channel?.isVoiceBased()) {
      return;
    }

    const listeners = channel.members.filter((member) => !member.user.bot);

    if (listeners.size > 0) {
      const timer = runtime.emptyVoiceTimers.get(runtime.guildId);
      if (timer) {
        clearTimeout(timer);
        runtime.emptyVoiceTimers.delete(runtime.guildId);
      }
      return;
    }

    const config = await getMusicSettings(runtime.guildId);
    const state = await getMusicPlayerState(runtime.guildId);

    if (
      !musicBooleanSetting(config.settings, "leaveWhenEmpty", true) ||
      state?.stayConnected
    ) {
      return;
    }

    const seconds = Math.min(
      Math.max(
        Math.trunc(
          musicNumberSetting(config.settings, "emptyTimeoutSeconds", 120)
        ),
        15
      ),
      3600
    );

    const existing = runtime.emptyVoiceTimers.get(runtime.guildId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const current = runtime.kazagumo.getPlayer(runtime.guildId);
      if (!current?.voiceId) return;

      const currentChannel =
        newState.guild.channels.cache.get(current.voiceId);
      const activeListeners = currentChannel?.isVoiceBased()
        ? currentChannel.members.filter((member) => !member.user.bot).size
        : 0;

      if (activeListeners === 0) {
        void current.destroy();
        void clearMusicQueue(runtime.guildId);
        void saveMusicPlayerState({
          guildId: runtime.guildId,
          voiceChannelId: null,
          controllerMessageId: null
        });
      }
    }, seconds * 1000);

    timer.unref();
    runtime.emptyVoiceTimers.set(runtime.guildId, timer);
  });
}

export function createMusicRuntime(
  client: Client,
  options: {
    guildId: string;
    host: string;
    port: number;
    password: string;
  }
): MusicRuntime {
  const kazagumo = new Kazagumo(
    {
      defaultSearchEngine: "youtube_music",
      send: (guildId, payload) => {
        client.guilds.cache.get(guildId)?.shard.send(payload);
      }
    },
    new Connectors.DiscordJS(client),
    [
      {
        name: "NetroxLavalink",
        url: options.host + ":" + options.port,
        auth: options.password,
        secure: false
      }
    ]
  );

  const runtime: MusicRuntime = {
    client,
    guildId: options.guildId,
    kazagumo,
    voteSkips: new Map(),
    emptyVoiceTimers: new Map(),
    idleTimers: new Map()
  };

  kazagumo.shoukaku.on("ready", (name) => {
    console.log("Lavalink " + name + " подключён.");
  });

  kazagumo.shoukaku.on("error", (name, error) => {
    console.error("Lavalink " + name + ":", error);
  });

  kazagumo.on("playerStart", (player, track) => {
    runtime.voteSkips.delete(player.guildId);

    const pendingIdle = runtime.idleTimers.get(player.guildId);
    if (pendingIdle) {
      clearTimeout(pendingIdle);
      runtime.idleTimers.delete(player.guildId);
    }

    const userId = requesterId(track);

    void getMusicSettings(player.guildId).then(async (config) => {
      if (userId && musicBooleanSetting(config.settings, "history", true)) {
        await recordMusicHistory({
          guildId: player.guildId,
          userId,
          track: musicTrackData(track)
        }).catch(() => undefined);
      }
    });

    void saveMusicPlayerState({
      guildId: player.guildId,
      voiceChannelId: player.voiceId,
      textChannelId: player.textId ?? null,
      volume: player.volume,
      loopMode: player.loop,
      lastTrack: musicTrackData(track) as Record<string, unknown>
    });
  });

  kazagumo.on("queueUpdate", (player) => {
    void persistRuntimeQueue(runtime, player);
  });

  kazagumo.on("playerEmpty", (player) => {
    void handlePlayerEmpty(runtime, player);
  });

  kazagumo.on("playerDestroy", (player) => {
    runtime.voteSkips.delete(player.guildId);
    void clearMusicQueue(player.guildId);
  });

  registerEmptyVoiceLifecycle(runtime);
  return runtime;
}
