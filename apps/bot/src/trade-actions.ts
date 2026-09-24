import {
  MessageFlags,
  type Interaction
} from "discord.js";
import { EconomyError } from "@netrox/database";
import {
  handleMarketCommand,
  handleMarketSelect,
  type TradeRuntime
} from "./market-actions.js";
import { handleAuctionCommand } from "./auction-actions.js";
import { handleLotteryCommand } from "./lottery-actions.js";
import {
  handleGameButton,
  handleGameCommand,
  handleGameModal
} from "./game-actions.js";
import { tradeCommandNames } from "./trade-commands.js";

async function replyError(
  interaction: Interaction,
  error: unknown
) {
  if (!interaction.isRepliable()) {
    return;
  }

  const message =
    error instanceof EconomyError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Не удалось выполнить действие.";

  const payload = {
    content: message,
    flags: MessageFlags.Ephemeral
  } as const;

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => undefined);
  } else {
    await interaction.reply(payload).catch(() => undefined);
  }
}

export async function handleTradeInteraction(
  runtime: TradeRuntime,
  interaction: Interaction
): Promise<boolean> {
  try {
    if (interaction.isStringSelectMenu()) {
      return await handleMarketSelect(runtime, interaction);
    }

    if (interaction.isButton()) {
      return await handleGameButton(interaction);
    }

    if (interaction.isModalSubmit()) {
      return await handleGameModal(interaction);
    }

    if (!interaction.isChatInputCommand()) {
      return false;
    }

    if (!tradeCommandNames.has(interaction.commandName)) {
      return false;
    }

    if (interaction.commandName === "market") {
      return await handleMarketCommand(runtime, interaction);
    }

    if (interaction.commandName === "auction") {
      return await handleAuctionCommand(runtime, interaction);
    }

    if (interaction.commandName === "lottery") {
      return await handleLotteryCommand(runtime, interaction);
    }

    if (interaction.commandName === "game") {
      return await handleGameCommand(runtime, interaction);
    }

    return false;
  } catch (error) {
    await replyError(interaction, error);
    return true;
  }
}

export type { TradeRuntime };
