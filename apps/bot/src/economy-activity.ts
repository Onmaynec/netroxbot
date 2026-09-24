import type { Client, Message } from "discord.js";
import {
  EconomyError,
  claimActivityReward
} from "@netrox/database";
import {
  getEconomySettings,
  type EconomyRuntime
} from "./economy-actions.js";

function numberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

export async function handleEconomyMessage(
  runtime: EconomyRuntime,
  message: Message
) {
  if (
    !message.guild ||
    message.guild.id !== runtime.guildId ||
    message.author.bot ||
    message.system ||
    message.content.trim().length < 3
  ) {
    return;
  }

  const config = await getEconomySettings(runtime.guildId);

  if (!config.enabled) {
    return;
  }

  const reward = Math.max(
    0,
    Math.trunc(
      numberSetting(config.settings, "chatReward", 1)
    )
  );

  if (reward === 0) {
    return;
  }

  const cooldown = Math.max(
    5,
    Math.trunc(
      numberSetting(
        config.settings,
        "chatRewardCooldownSeconds",
        60
      )
    )
  );

  try {
    await claimActivityReward({
      guildId: runtime.guildId,
      userId: message.author.id,
      amount: BigInt(reward),
      kind: "MESSAGE",
      cooldownSeconds: cooldown
    });
  } catch (error) {
    if (
      error instanceof EconomyError &&
      error.code === "COOLDOWN"
    ) {
      return;
    }

    throw error;
  }
}

export function startEconomyVoiceRewards(
  client: Client,
  runtime: EconomyRuntime
) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const guild =
        client.guilds.cache.get(runtime.guildId) ??
        (await client.guilds.fetch(runtime.guildId).catch(() => null));

      if (!guild) {
        return;
      }

      const config = await getEconomySettings(runtime.guildId);

      if (!config.enabled) {
        return;
      }

      const reward = Math.max(
        0,
        Math.trunc(
          numberSetting(
            config.settings,
            "voiceRewardPerMinute",
            1
          )
        )
      );
      const cooldown = Math.max(
        30,
        Math.trunc(
          numberSetting(
            config.settings,
            "voiceRewardCooldownSeconds",
            60
          )
        )
      );
      const minimumMembers = Math.max(
        1,
        Math.trunc(
          numberSetting(
            config.settings,
            "minimumVoiceMembers",
            2
          )
        )
      );

      if (reward === 0) {
        return;
      }

      for (const channel of guild.channels.cache.values()) {
        if (!channel.isVoiceBased()) continue;

        const humans = channel.members.filter(
          (member) => !member.user.bot
        );

        if (humans.size < minimumMembers) {
          continue;
        }

        for (const member of humans.values()) {
          if (
            member.voice.selfDeaf ||
            member.voice.serverDeaf
          ) {
            continue;
          }

          try {
            await claimActivityReward({
              guildId: runtime.guildId,
              userId: member.id,
              amount: BigInt(reward),
              kind: "VOICE",
              cooldownSeconds: cooldown
            });
          } catch (error) {
            if (
              error instanceof EconomyError &&
              error.code === "COOLDOWN"
            ) {
              continue;
            }

            console.error(
              "Ошибка начисления NEC за голосовую активность",
              error
            );
          }
        }
      }
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, 30_000);

  interval.unref();
  void tick();

  return () => clearInterval(interval);
}
