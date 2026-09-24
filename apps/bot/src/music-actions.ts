import {
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction
} from "discord.js";
import { parseDurationSeconds } from "@netrox/core";
import {
  addTrackToMusicPlaylist,
  clearMusicQueue,
  createMusicPlaylist,
  deleteMusicPlaylist,
  getMusicPlaylist,
  listMusicFavorites,
  listMusicHistory,
  listMusicPlaylists,
  removeTrackFromMusicPlaylist,
  saveMusicPlayerState,
  toggleMusicFavorite
} from "@netrox/database";
import type { KazagumoPlayer, KazagumoTrack } from "kazagumo";
import {
  currentTrackKey,
  getMusicSettings,
  musicBooleanSetting,
  musicNumberSetting,
  musicStringSetting,
  musicTrackData,
  sourcePrefix,
  type MusicRuntime,
  type MusicSettings
} from "./music-runtime.js";
import {
  musicControllerEmbed,
  updateMusicController
} from "./music-controller.js";
import { musicCommandNames } from "./music-commands.js";

const ACCENT = 0x57f287;

type MusicInteraction = ChatInputCommandInteraction | ButtonInteraction;

function formatDuration(ms: number | bigint) {
  const value = Number(ms);
  const seconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  return hours > 0
    ? hours + ":" + minutes.toString().padStart(2, "0") + ":" + rest.toString().padStart(2, "0")
    : minutes + ":" + rest.toString().padStart(2, "0");
}

async function guildMember(interaction: MusicInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return null;
  }

  if (interaction.member instanceof GuildMember) {
    return interaction.member;
  }

  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function voiceChannelId(interaction: MusicInteraction) {
  const member = await guildMember(interaction);
  return member?.voice.channelId ?? null;
}

async function sameVoice(
  interaction: MusicInteraction,
  player: KazagumoPlayer
) {
  const voiceId = await voiceChannelId(interaction);
  return Boolean(voiceId && voiceId === player.voiceId);
}

async function canDjControl(
  interaction: MusicInteraction,
  config?: MusicSettings
) {
  if (!interaction.inGuild()) {
    return false;
  }

  if (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }

  const settings = config ?? (await getMusicSettings(interaction.guildId));
  const djRoleId = musicStringSetting(settings.settings, "djRoleId");

  if (!djRoleId) {
    return true;
  }

  const member = await guildMember(interaction);
  return Boolean(member?.roles.cache.has(djRoleId));
}

async function ensurePlayer(
  runtime: MusicRuntime,
  interaction: ChatInputCommandInteraction
) {
  const voiceId = await voiceChannelId(interaction);

  if (!voiceId) {
    throw new Error("Сначала зайди в голосовой канал.");
  }

  const existing = runtime.kazagumo.getPlayer(runtime.guildId);

  if (existing) {
    if (existing.voiceId !== voiceId) {
      throw new Error("NetroxBot уже играет в другом голосовом канале.");
    }

    existing.setTextChannel(interaction.channelId);
    return existing;
  }

  const config = await getMusicSettings(runtime.guildId);
  const volume = Math.min(
    Math.max(
      Math.trunc(musicNumberSetting(config.settings, "defaultVolume", 50)),
      1
    ),
    100
  );

  const player = await runtime.kazagumo.createPlayer({
    guildId: runtime.guildId,
    voiceId,
    textId: interaction.channelId,
    deaf: true,
    volume
  });

  await saveMusicPlayerState({
    guildId: runtime.guildId,
    voiceChannelId: voiceId,
    textChannelId: interaction.channelId,
    volume,
    autoplay: musicBooleanSetting(config.settings, "autoplay", false)
  });

  return player;
}

function queueEmbed(player: KazagumoPlayer) {
  const current = player.queue.current;
  const lines = Array.from(player.queue)
    .slice(0, 15)
    .map(
      (track, index) =>
        (index + 1) +
        ". **" +
        track.title +
        "** — " +
        (track.author ?? "Неизвестно") +
        " • " +
        formatDuration(track.length ?? 0)
    );

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("📜 Очередь NetroxBot")
    .setDescription(
      current
        ? "Сейчас: **" +
            current.title +
            "** — " +
            (current.author ?? "Неизвестно")
        : "Сейчас ничего не играет."
    )
    .addFields({
      name: "Дальше",
      value:
        lines.length > 0
          ? lines.join("\n") +
            (player.queue.length > 15
              ? "\n…и ещё " + (player.queue.length - 15)
              : "")
          : "Очередь пуста."
    });

  return embed;
}

async function requirePlayer(runtime: MusicRuntime) {
  const player = runtime.kazagumo.getPlayer(runtime.guildId);
  if (!player) {
    throw new Error("Музыкальный плеер сейчас не запущен.");
  }
  return player;
}

async function searchTracks(
  runtime: MusicRuntime,
  interaction: ChatInputCommandInteraction,
  query: string,
  config: MusicSettings
) {
  const source = musicStringSetting(
    config.settings,
    "defaultSearchSource",
    "youtube_music"
  );

  return runtime.kazagumo.search(query, {
    requester: interaction.user,
    source: sourcePrefix(source)
  });
}

async function addSearchResult(
  runtime: MusicRuntime,
  interaction: ChatInputCommandInteraction,
  player: KazagumoPlayer,
  query: string,
  config: MusicSettings
) {
  const result = await searchTracks(runtime, interaction, query, config);

  if (result.tracks.length === 0) {
    throw new Error("Ничего не нашёл по этому запросу.");
  }

  const maxQueue = Math.min(
    Math.max(
      Math.trunc(musicNumberSetting(config.settings, "maxQueueSize", 500)),
      10
    ),
    5000
  );
  const free = Math.max(0, maxQueue - player.queue.length);

  if (free === 0) {
    throw new Error("Очередь уже заполнена.");
  }

  const tracks =
    result.type === "PLAYLIST"
      ? result.tracks.slice(0, free)
      : [result.tracks[0]].filter(
          (track): track is KazagumoTrack => Boolean(track)
        );

  const wasIdle = !player.playing && !player.paused && !player.queue.current;
  player.queue.add([...tracks]);

  if (wasIdle || (!player.playing && !player.paused)) {
    await player.play();
  }

  return {
    result,
    tracks
  };
}

async function doSkip(
  runtime: MusicRuntime,
  interaction: MusicInteraction
) {
  const player = await requirePlayer(runtime);

  if (!(await sameVoice(interaction, player))) {
    throw new Error("Для skip нужно быть в том же голосовом канале.");
  }

  const config = await getMusicSettings(runtime.guildId);
  const current = player.queue.current;

  if (!current) {
    throw new Error("Сейчас ничего не играет.");
  }

  const isDj = await canDjControl(interaction, config);
  const requestedBy = current.requester;

  if (
    isDj ||
    (requestedBy &&
      typeof requestedBy === "object" &&
      "id" in requestedBy &&
      requestedBy.id === interaction.user.id) ||
    !musicBooleanSetting(config.settings, "voteSkipEnabled", true)
  ) {
    player.skip();
    runtime.voteSkips.delete(runtime.guildId);
    return { skipped: true, votes: 0, required: 0 };
  }

  const voice = interaction.guild?.channels.cache.get(player.voiceId ?? "");
  const listeners = voice?.isVoiceBased()
    ? voice.members.filter((member) => !member.user.bot).size
    : 1;
  const percent = Math.min(
    Math.max(
      musicNumberSetting(config.settings, "voteSkipPercent", 50),
      10
    ),
    100
  );
  const required = Math.max(1, Math.ceil((listeners * percent) / 100));
  const key = currentTrackKey(player);
  const state = runtime.voteSkips.get(runtime.guildId);

  const vote =
    state?.trackKey === key
      ? state
      : { trackKey: key, voters: new Set<string>() };

  vote.voters.add(interaction.user.id);
  runtime.voteSkips.set(runtime.guildId, vote);

  if (vote.voters.size >= required) {
    player.skip();
    runtime.voteSkips.delete(runtime.guildId);
    return {
      skipped: true,
      votes: vote.voters.size,
      required
    };
  }

  return {
    skipped: false,
    votes: vote.voters.size,
    required
  };
}

async function requireDjAndVoice(
  runtime: MusicRuntime,
  interaction: MusicInteraction
) {
  const player = await requirePlayer(runtime);

  if (!(await sameVoice(interaction, player))) {
    throw new Error("Нужно быть в том же голосовом канале.");
  }

  if (!(await canDjControl(interaction))) {
    throw new Error("Для этого действия нужна DJ-роль.");
  }

  return player;
}

async function handlePlaylist(
  runtime: MusicRuntime,
  interaction: ChatInputCommandInteraction,
  config: MusicSettings
) {
  if (!musicBooleanSetting(config.settings, "userPlaylists", true)) {
    throw new Error("Плейлисты пользователей отключены в настройках.");
  }

  const action = interaction.options.getSubcommand();
  const name = interaction.options.getString("название")?.trim();

  if (action === "create" && name) {
    await createMusicPlaylist({
      guildId: runtime.guildId,
      ownerId: interaction.user.id,
      name
    });
    await interaction.reply({
      content: "Плейлист **" + name + "** создан.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (action === "delete" && name) {
    await deleteMusicPlaylist({
      guildId: runtime.guildId,
      ownerId: interaction.user.id,
      name
    });
    await interaction.reply({
      content: "Плейлист **" + name + "** удалён.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (action === "list") {
    const playlists = await listMusicPlaylists(
      runtime.guildId,
      interaction.user.id
    );
    const text =
      playlists.length > 0
        ? playlists
            .map(
              (playlist) =>
                "• **" +
                playlist.name +
                "** — " +
                playlist._count.tracks +
                " треков"
            )
            .join("\n")
        : "Плейлистов пока нет.";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle("🎼 Мои плейлисты")
          .setDescription(text)
      ],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if ((action === "show" || action === "play") && name) {
    const playlist = await getMusicPlaylist({
      guildId: runtime.guildId,
      ownerId: interaction.user.id,
      name
    });

    if (!playlist) {
      throw new Error("Плейлист не найден.");
    }

    if (action === "show") {
      const rows = playlist.tracks
        .slice(0, 30)
        .map(
          (track, index) =>
            index +
            1 +
            ". **" +
            track.title +
            "** — " +
            track.author
        );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle("🎼 " + playlist.name)
            .setDescription(
              rows.length > 0 ? rows.join("\n") : "Плейлист пуст."
            )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (playlist.tracks.length === 0) {
      throw new Error("Плейлист пуст.");
    }

    await interaction.deferReply();
    const player = await ensurePlayer(runtime, interaction);
    let added = 0;

    for (const stored of playlist.tracks.slice(0, 100)) {
      const query =
        stored.uri ?? stored.author + " - " + stored.title;
      const result = await runtime.kazagumo
        .search(query, {
          requester: interaction.user,
          source: sourcePrefix(
            musicStringSetting(
              config.settings,
              "defaultSearchSource",
              "youtube_music"
            )
          )
        })
        .catch(() => null);
      const track = result?.tracks[0];

      if (track) {
        player.queue.add(track);
        added += 1;
      }
    }

    if (!player.playing && !player.paused && player.queue.current) {
      await player.play();
    }

    await interaction.editReply(
      "🎼 Добавлено из **" + playlist.name + "**: " + added + " треков."
    );
    return;
  }

  if (action === "add" && name) {
    const player = await requirePlayer(runtime);
    const track = player.queue.current;

    if (!track) {
      throw new Error("Сейчас ничего не играет.");
    }

    await addTrackToMusicPlaylist({
      guildId: runtime.guildId,
      ownerId: interaction.user.id,
      name,
      addedBy: interaction.user.id,
      track: musicTrackData(track)
    });

    await interaction.reply({
      content: "⭐ **" + track.title + "** добавлен в **" + name + "**.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (action === "remove" && name) {
    const position = interaction.options.getInteger("позиция", true);

    await removeTrackFromMusicPlaylist({
      guildId: runtime.guildId,
      ownerId: interaction.user.id,
      name,
      position: position - 1
    });

    await interaction.reply({
      content: "Трек #" + position + " удалён из **" + name + "**.",
      flags: MessageFlags.Ephemeral
    });
  }
}

export async function handleMusicCommand(
  runtime: MusicRuntime,
  interaction: ChatInputCommandInteraction
) {
  if (!musicCommandNames.has(interaction.commandName)) {
    return false;
  }

  try {
    const config = await getMusicSettings(runtime.guildId);

    if (!config.enabled) {
      throw new Error("Музыкальный модуль сейчас выключен.");
    }

    if (interaction.commandName === "play") {
      await interaction.deferReply();
      const query = interaction.options.getString("запрос", true);
      const player = await ensurePlayer(runtime, interaction);
      const { result, tracks } = await addSearchResult(
        runtime,
        interaction,
        player,
        query,
        config
      );

      const text =
        result.type === "PLAYLIST"
          ? "🎼 Добавлено **" +
            tracks.length +
            "** треков" +
            (result.playlistName ? " из **" + result.playlistName + "**." : ".")
          : "🎵 В очередь добавлен **" + tracks[0]?.title + "**.";

      await interaction.editReply(text);
      return true;
    }

    if (interaction.commandName === "pause") {
      const player = await requireDjAndVoice(runtime, interaction);
      player.pause(true);
      await updateMusicController(runtime, player);
      await interaction.reply({
        content: "⏸️ Пауза.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "resume") {
      const player = await requireDjAndVoice(runtime, interaction);
      player.pause(false);
      await updateMusicController(runtime, player);
      await interaction.reply({
        content: "▶️ Продолжаю.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "skip") {
      const result = await doSkip(runtime, interaction);
      await interaction.reply({
        content: result.skipped
          ? "⏭️ Трек пропущен."
          : "🗳️ Голос за skip: " + result.votes + "/" + result.required + ".",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "stop") {
      const player = await requireDjAndVoice(runtime, interaction);
      player.queue.clear();
      await player.destroy();
      await clearMusicQueue(runtime.guildId);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        voiceChannelId: null,
        controllerMessageId: null,
        stayConnected: false,
        lastTrack: null
      });
      await interaction.reply({
        content: "⏹️ Плеер остановлен.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "queue") {
      const player = await requirePlayer(runtime);
      await interaction.reply({
        embeds: [queueEmbed(player)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "nowplaying") {
      const player = await requirePlayer(runtime);
      await interaction.reply({
        embeds: [musicControllerEmbed(player)]
      });
      return true;
    }

    if (interaction.commandName === "seek") {
      const player = await requireDjAndVoice(runtime, interaction);
      const input = interaction.options.getString("позиция", true);
      const seconds = parseDurationSeconds(input, {
        minSeconds: 1,
        maxSeconds: 60 * 60 * 24
      });

      if (!seconds) {
        throw new Error("Не понял позицию. Пример: 1m30s.");
      }

      const current = player.queue.current;
      if (!current || current.isStream) {
        throw new Error("Этот трек нельзя перемотать.");
      }

      if (current.length && seconds * 1000 >= current.length) {
        throw new Error("Позиция находится за концом трека.");
      }

      await player.seek(seconds);
      await interaction.reply({
        content: "⏩ Перемотал на " + input + ".",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "volume") {
      const player = await requireDjAndVoice(runtime, interaction);
      const volume = interaction.options.getInteger("процент", true);
      await player.setVolume(volume);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        volume
      });
      await updateMusicController(runtime, player);
      await interaction.reply({
        content: "🔊 Громкость: " + volume + "%.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "loop") {
      const player = await requireDjAndVoice(runtime, interaction);
      const mode = interaction.options.getString("режим", true) as
        | "none"
        | "track"
        | "queue";
      player.setLoop(mode);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        loopMode: mode
      });
      await updateMusicController(runtime, player);
      await interaction.reply({
        content: "🔁 Режим повтора: **" + mode + "**.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "shuffle") {
      const player = await requireDjAndVoice(runtime, interaction);
      player.queue.shuffle();
      await updateMusicController(runtime, player);
      await interaction.reply({
        content: "🔀 Очередь перемешана.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "autoplay") {
      await requireDjAndVoice(runtime, interaction);
      const enabled = interaction.options.getBoolean("включен", true);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        autoplay: enabled
      });
      await interaction.reply({
        content: "♾️ Autoplay " + (enabled ? "включён." : "выключен."),
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "music247") {
      await requireDjAndVoice(runtime, interaction);

      if (!musicBooleanSetting(config.settings, "allow247", true)) {
        throw new Error("Режим 24/7 отключён в настройках сервера.");
      }

      const enabled = interaction.options.getBoolean("включен", true);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        stayConnected: enabled
      });
      await interaction.reply({
        content: "🛰️ Режим 24/7 " + (enabled ? "включён." : "выключен."),
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "favorite") {
      if (!musicBooleanSetting(config.settings, "favorites", true)) {
        throw new Error("Избранное отключено в настройках.");
      }

      const action = interaction.options.getSubcommand();

      if (action === "toggle") {
        const player = await requirePlayer(runtime);
        const track = player.queue.current;
        if (!track) throw new Error("Сейчас ничего не играет.");

        const result = await toggleMusicFavorite({
          guildId: runtime.guildId,
          userId: interaction.user.id,
          track: musicTrackData(track)
        });

        await interaction.reply({
          content: result.favorite
            ? "⭐ Добавил **" + track.title + "** в избранное."
            : "☆ Убрал **" + track.title + "** из избранного.",
          flags: MessageFlags.Ephemeral
        });
      } else {
        const favorites = await listMusicFavorites(
          runtime.guildId,
          interaction.user.id,
          30
        );
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(ACCENT)
              .setTitle("⭐ Избранное")
              .setDescription(
                favorites.length > 0
                  ? favorites
                      .map(
                        (track, index) =>
                          index +
                          1 +
                          ". **" +
                          track.title +
                          "** — " +
                          track.author
                      )
                      .join("\n")
                  : "Здесь пока пусто."
              )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      return true;
    }

    if (interaction.commandName === "history") {
      const history = await listMusicHistory(
        runtime.guildId,
        interaction.user.id,
        30
      );
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle("🕘 История прослушивания")
            .setDescription(
              history.length > 0
                ? history
                    .map(
                      (track, index) =>
                        index +
                        1 +
                        ". **" +
                        track.title +
                        "** — " +
                        track.author
                    )
                    .join("\n")
                : "История пока пустая."
            )
        ],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "playlist") {
      await handlePlaylist(runtime, interaction, config);
      return true;
    }

    return true;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Не удалось выполнить музыкальную команду.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: "⚠️ " + message }).catch(() => undefined);
    } else {
      await interaction
        .reply({
          content: "⚠️ " + message,
          flags: MessageFlags.Ephemeral
        })
        .catch(() => undefined);
    }

    return true;
  }
}

export async function handleMusicButton(
  runtime: MusicRuntime,
  interaction: ButtonInteraction
) {
  if (!interaction.customId.startsWith("music:")) {
    return false;
  }

  try {
    const player = await requirePlayer(runtime);

    if (!(await sameVoice(interaction, player))) {
      throw new Error("Нужно быть в том же голосовом канале.");
    }

    const action = interaction.customId.slice("music:".length);

    if (action === "queue") {
      await interaction.reply({
        embeds: [queueEmbed(player)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (action === "favorite") {
      const config = await getMusicSettings(runtime.guildId);
      if (!musicBooleanSetting(config.settings, "favorites", true)) {
        throw new Error("Избранное отключено.");
      }
      const track = player.queue.current;
      if (!track) throw new Error("Сейчас ничего не играет.");

      const result = await toggleMusicFavorite({
        guildId: runtime.guildId,
        userId: interaction.user.id,
        track: musicTrackData(track)
      });

      await interaction.reply({
        content: result.favorite
          ? "⭐ Трек добавлен в избранное."
          : "☆ Трек удалён из избранного.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (action === "skip") {
      const result = await doSkip(runtime, interaction);
      await interaction.reply({
        content: result.skipped
          ? "⏭️ Трек пропущен."
          : "🗳️ Голос за skip: " + result.votes + "/" + result.required + ".",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const isDj = await canDjControl(interaction);
    if (!isDj) {
      throw new Error("Для этой кнопки нужна DJ-роль.");
    }

    if (action === "pause") {
      player.pause(!player.paused);
    } else if (action === "previous") {
      const previous = player.getPrevious(true);
      if (!previous) throw new Error("Предыдущего трека нет.");
      await player.play(previous);
    } else if (action === "shuffle") {
      player.queue.shuffle();
    } else if (action === "loop") {
      const next =
        player.loop === "none"
          ? "track"
          : player.loop === "track"
            ? "queue"
            : "none";
      player.setLoop(next);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        loopMode: next
      });
    } else if (action === "stop") {
      player.queue.clear();
      await player.destroy();
      await clearMusicQueue(runtime.guildId);
      await saveMusicPlayerState({
        guildId: runtime.guildId,
        voiceChannelId: null,
        controllerMessageId: null,
        stayConnected: false,
        lastTrack: null
      });
      await interaction.reply({
        content: "⏹️ Плеер остановлен.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await updateMusicController(runtime, player);
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось выполнить действие.";

    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "⚠️ " + message,
          flags: MessageFlags.Ephemeral
        })
        .catch(() => undefined);
    }

    return true;
  }
}
