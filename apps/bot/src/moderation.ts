
import type { Interaction } from "discord.js";
import { moderationCommands } from "./moderation-commands.js";
import { handleUserModerationCommand, handleAppealComponent } from "./moderation-user-actions.js";
import { handleAdminModerationCommand } from "./moderation-admin-actions.js";
import {
  startModerationScheduler,
  type ModerationRuntime
} from "./moderation-service.js";

export { moderationCommands, startModerationScheduler };
export type { ModerationRuntime };

export async function handleModerationInteraction(
  interaction: Interaction,
  runtime: ModerationRuntime
): Promise<boolean> {
  if (await handleAppealComponent(interaction, runtime)) {
    return true;
  }

  if (!interaction.isChatInputCommand()) {
    return false;
  }

  if (await handleUserModerationCommand(interaction, runtime)) {
    return true;
  }

  if (await handleAdminModerationCommand(interaction, runtime)) {
    return true;
  }

  return false;
}
