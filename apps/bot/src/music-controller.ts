import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import type { KazagumoPlayer } from "kazagumo";
import {
  getMusicPlayerState,
  saveMusicPlayerState
} from "@netrox/database";
import type { MusicRuntime } from "./music-runtime.js";

const ACCENT = 0x57f287;

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes + ":" + rest.toString().padStart(2, "0");
}

function progressBar(positionMs: number, lengthMs: number) {
  if (lengthMs <= 0) {
    return "🔴 LIVE";
  }

  const size = 16;
  const ratio = Math.min(Math.max(positionMs / lengthMs, 0), 1);
  const marker = Math.min(size - 1, Math.floor(ratio * size));

  return Array.from({ length: size }, (_, index) =>
    index === marker ? "●" : "─"
  ).join("");
}

export function musicControllerEmbed(player: KazagumoPlayer) {
  const track = player.queue.current;

  if (!track) {
    return new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle("🎵 NetroxBot Music")
      .setDescription("Очередь пуста.");
  }

  const length = track.length ?? 0;
  const position = Math.max(0, player.position);
  const title = track.uri
    ? "[" + track.title + "](" + track.uri + ")"
    : "**" + track.title + "**";

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🎵 Сейчас играет")
    .setDescription(title)
    .addFields(
      {
        name: "Исполнитель",
        value: track.author ?? "Неизвестно",
        inline: true
      },
      {
        name: "Источник",
        value: track.sourceName,
        inline: true
      },
      {
        name: "Громкость",
        value: player.volume + "%",
        inline: true
      },
      {
        name: "Прогресс",
        value:
          progressBar(position, length) +
          "\n" +
          clock(position) +
          " / " +
          (track.isStream ? "LIVE" : clock(length))
      }
    )
    .setFooter({
      text:
        "В очереди: " +
        player.queue.length +
        " • Повтор: " +
        player.loop
    });

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  return embed;
}

export function musicControllerComponents(player: KazagumoPlayer) {
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:previous")
      .setEmoji("⏮️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:pause")
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("music:skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:shuffle")
      .setEmoji("🔀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger)
  );

  const second = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:favorite")
      .setLabel("Избранное")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:loop")
      .setLabel(
        player.loop === "track"
          ? "Трек"
          : player.loop === "queue"
            ? "Очередь"
            : "Повтор"
      )
      .setEmoji("🔁")
      .setStyle(
        player.loop === "none" ? ButtonStyle.Secondary : ButtonStyle.Success
      ),
    new ButtonBuilder()
      .setCustomId("music:queue")
      .setLabel("Очередь")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Secondary)
  );

  return [first, second];
}

export async function updateMusicController(
  runtime: MusicRuntime,
  player: KazagumoPlayer
) {
  if (!player.textId) {
    return;
  }

  const channel = await runtime.client.channels
    .fetch(player.textId)
    .catch(() => null);

  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  const state = await getMusicPlayerState(runtime.guildId);
  const payload = {
    embeds: [musicControllerEmbed(player)],
    components: musicControllerComponents(player)
  };

  if (state?.controllerMessageId && "messages" in channel) {
    const message = await channel.messages
      .fetch(state.controllerMessageId)
      .catch(() => null);

    if (message) {
      await message.edit(payload).catch(() => undefined);
      return;
    }
  }

  const message = await channel.send(payload).catch(() => null);

  if (!message) {
    return;
  }

  await saveMusicPlayerState({
    guildId: runtime.guildId,
    controllerMessageId: message.id,
    textChannelId: player.textId,
    voiceChannelId: player.voiceId
  });
}

export function registerMusicController(runtime: MusicRuntime) {
  runtime.kazagumo.on("playerStart", (player) => {
    void updateMusicController(runtime, player);
  });

  runtime.kazagumo.on("queueUpdate", (player) => {
    void updateMusicController(runtime, player);
  });

  runtime.kazagumo.on("playerDestroy", async (player) => {
    const state = await getMusicPlayerState(player.guildId);

    if (!state?.controllerMessageId || !state.textChannelId) {
      return;
    }

    const channel = await runtime.client.channels
      .fetch(state.textChannelId)
      .catch(() => null);

    if (!channel?.isTextBased() || !("messages" in channel)) {
      return;
    }

    const message = await channel.messages
      .fetch(state.controllerMessageId)
      .catch(() => null);

    if (message) {
      await message
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0x747f8d)
              .setTitle("🎵 NetroxBot Music")
              .setDescription("Плеер остановлен.")
          ],
          components: []
        })
        .catch(() => undefined);
    }
  });
}
