import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
  ModalBuilder,
  Partials,
  REST,
  RoleSelectMenuBuilder,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import {
  MODULES,
  SETTINGS_CATEGORIES,
  getCategory,
  getModule,
  getModulesByCategory,
  getModuleSettingFields,
  type SettingFieldDefinition
} from "@netrox/core";
import { prisma } from "@netrox/database";
import { z } from "zod";
import {
  handleModerationInteraction,
  moderationCommands,
  startModerationScheduler
} from "./moderation.js";
import { handleAutomodMessage } from "./automod.js";
import { emitServerLog, registerServerLogging } from "./logging.js";
import { musicCommands } from "./music-commands.js";
import { createMusicRuntime } from "./music-runtime.js";
import { registerMusicController } from "./music-controller.js";
import { handleMusicButton, handleMusicCommand } from "./music-actions.js";
import { economyCommands } from "./economy-commands.js";
import { handleEconomyInteraction } from "./economy-actions.js";
import { handleEconomyMessage, startEconomyVoiceRewards } from "./economy-activity.js";

const env = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  SUPERADMIN_DISCORD_ID: z.string().trim().optional().transform((value) => value || undefined),
  LAVALINK_HOST: z.string().min(1).default("lavalink"),
  LAVALINK_PORT: z.coerce.number().int().positive().default(2333),
  LAVALINK_PASSWORD: z.string().min(1)
}).parse(process.env);

const ACCENT = 0x57f287;
const MUTED = 0x747f8d;

const commands = [
  ...[
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Открыть справку NetroxBot"),
    new SlashCommandBuilder()
      .setName("settings")
      .setDescription("Открыть настройки NetroxBot")
  ].map((command) => command.toJSON()),
  ...moderationCommands,
  ...musicCommands,
  ...economyCommands
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildWebhooks
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const moderationRuntime = {
  client,
  guildId: env.DISCORD_GUILD_ID
};

const economyRuntime = {
  guildId: env.DISCORD_GUILD_ID
};

const musicRuntime = createMusicRuntime(client, {
  guildId: env.DISCORD_GUILD_ID,
  host: env.LAVALINK_HOST,
  port: env.LAVALINK_PORT,
  password: env.LAVALINK_PASSWORD
});

registerMusicController(musicRuntime);
registerServerLogging(client, env.DISCORD_GUILD_ID);

async function canManageSettings(userId: string): Promise<boolean> {
  if (userId === env.SUPERADMIN_DISCORD_ID) {
    return true;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { discordId: userId }
  });

  return Boolean(admin && !admin.revokedAt);
}

async function getModuleState(moduleKey: string) {
  const definition = getModule(moduleKey);

  if (!definition) {
    return null;
  }

  return prisma.moduleConfig.upsert({
    where: {
      guildId_moduleKey: {
        guildId: env.DISCORD_GUILD_ID,
        moduleKey
      }
    },
    update: {},
    create: {
      guildId: env.DISCORD_GUILD_ID,
      moduleKey,
      enabled: definition.defaultEnabled,
      settings: {}
    }
  });
}

function readSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function displaySettingValue(
  field: SettingFieldDefinition,
  value: unknown
): string {
  const current = value ?? field.defaultValue ?? null;

  if (current === null || current === undefined || current === "") {
    return "Не задано";
  }

  if (field.kind === "boolean") {
    return current ? "Включено" : "Выключено";
  }

  if (field.kind === "channel") {
    return typeof current === "string" ? `<#${current}>` : "Не задано";
  }

  if (field.kind === "role") {
    return typeof current === "string" ? `<@&${current}>` : "Не задано";
  }

  if (field.kind === "select" && typeof current === "string") {
    return field.options?.find((option) => option.value === current)?.label ?? current;
  }

  return String(current);
}

function getField(moduleKey: string, fieldKey: string) {
  return getModuleSettingFields(moduleKey).find((field) => field.key === fieldKey);
}

async function saveModuleSetting(
  moduleKey: string,
  fieldKey: string,
  value: string | number | boolean | null,
  actorId: string
) {
  const module = getModule(moduleKey);
  const field = getField(moduleKey, fieldKey);

  if (!module || !field) {
    throw new Error("Параметр модуля не найден.");
  }

  const current = await getModuleState(moduleKey);

  if (!current) {
    throw new Error("Модуль не найден.");
  }

  const settings = readSettings(current.settings);
  const nextSettings = JSON.parse(JSON.stringify({
    ...settings,
    [fieldKey]: value
  }));

  const [updated] = await prisma.$transaction([
    prisma.moduleConfig.update({
      where: {
        guildId_moduleKey: {
          guildId: env.DISCORD_GUILD_ID,
          moduleKey
        }
      },
      data: {
        settings: nextSettings
      }
    }),
    prisma.auditLog.create({
      data: {
        guildId: env.DISCORD_GUILD_ID,
        actorId,
        action: "settings.module.parameter",
        targetType: "module",
        targetId: moduleKey,
        payload: {
          field: fieldKey,
          value,
          source: "discord"
        }
      }
    })
  ]);

  await emitServerLog(client, env.DISCORD_GUILD_ID, {
    category: "settings",
    eventType: "settings.module.parameter",
    summary:
      "Изменён параметр " +
      field.label +
      " модуля " +
      module.title +
      " через Discord.",
    actorId,
    targetType: "module",
    targetId: moduleKey,
    payload: {
      field: fieldKey,
      value
    }
  });

  return updated;
}

function buildSettingsHome() {
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("⚙️ Настройки NetroxBot")
    .setDescription(
      "Выбери раздел. Настройки применяются без ручной правки конфигов и сохраняются в общей базе с веб-панелью."
    )
    .addFields(
      SETTINGS_CATEGORIES.map((category) => ({
        name: `${category.emoji} ${category.title}`,
        value: category.description,
        inline: false
      }))
    )
    .setFooter({ text: `Mothers Fantastic • ${MODULES.length} модулей` });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("settings:category")
    .setPlaceholder("Выбрать раздел настроек")
    .addOptions(
      SETTINGS_CATEGORIES.map((category) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(category.title)
          .setDescription(category.description.slice(0, 100))
          .setEmoji(category.emoji)
          .setValue(category.key)
      )
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
    ]
  };
}

function buildCategoryView(categoryKey: string) {
  const category = getCategory(categoryKey);

  if (!category) {
    return null;
  }

  const modules = getModulesByCategory(category.key);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`${category.emoji} ${category.title}`)
    .setDescription(
      `${category.description}\n\nВыбери модуль, который нужно настроить.`
    )
    .addFields(
      modules.map((module) => ({
        name: `${module.emoji} ${module.title}`,
        value: module.description,
        inline: false
      }))
    );

  const moduleMenu = new StringSelectMenuBuilder()
    .setCustomId("settings:module")
    .setPlaceholder("Выбрать модуль")
    .addOptions(
      modules.map((module) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(module.title)
          .setDescription(module.description.slice(0, 100))
          .setEmoji(module.emoji)
          .setValue(module.key)
      )
    );

  const homeButton = new ButtonBuilder()
    .setCustomId("settings:home")
    .setLabel("Все разделы")
    .setEmoji("↩️")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(moduleMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(homeButton)
    ]
  };
}

async function buildModuleView(moduleKey: string) {
  const module = getModule(moduleKey);

  if (!module) {
    return null;
  }

  const state = await getModuleState(module.key);

  if (!state) {
    return null;
  }

  const fields = getModuleSettingFields(module.key);
  const status = state.enabled ? "🟢 Включён" : "⚫ Выключен";
  const embed = new EmbedBuilder()
    .setColor(state.enabled ? ACCENT : MUTED)
    .setTitle(`${module.emoji} ${module.title}`)
    .setDescription(module.description)
    .addFields(
      { name: "Состояние", value: status, inline: true },
      {
        name: "Параметры",
        value: fields.length > 0 ? `${fields.length} доступно` : "Нет",
        inline: true
      },
      { name: "Ключ модуля", value: `\`${module.key}\``, inline: true }
    )
    .setFooter({
      text: "Изменения применяются сразу и записываются в журнал."
    });

  const toggle = new ButtonBuilder()
    .setCustomId(`settings:toggle:${module.key}`)
    .setLabel(state.enabled ? "Выключить модуль" : "Включить модуль")
    .setEmoji(state.enabled ? "⏸️" : "▶️")
    .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const parameters = new ButtonBuilder()
    .setCustomId(`settings:parameters:${module.key}`)
    .setLabel("Параметры")
    .setEmoji("🛠️")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(fields.length === 0);

  const back = new ButtonBuilder()
    .setCustomId(`settings:category:${module.category}`)
    .setLabel("Назад")
    .setEmoji("↩️")
    .setStyle(ButtonStyle.Secondary);

  const home = new ButtonBuilder()
    .setCustomId("settings:home")
    .setLabel("Главное меню")
    .setEmoji("🏠")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        toggle,
        parameters,
        back,
        home
      )
    ]
  };
}

async function buildParametersView(moduleKey: string) {
  const module = getModule(moduleKey);
  const fields = getModuleSettingFields(moduleKey);
  const state = await getModuleState(moduleKey);

  if (!module || !state || fields.length === 0) {
    return null;
  }

  const settings = readSettings(state.settings);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`🛠️ ${module.title} — параметры`)
    .setDescription(
      "Выбери параметр. Каналы и роли выбираются из Discord, текст и числа вводятся через отдельное окно."
    )
    .addFields(
      fields.map((field) => ({
        name: field.label,
        value: `${field.description}\n**Сейчас:** ${displaySettingValue(
          field,
          settings[field.key]
        )}`,
        inline: false
      }))
    );

  const fieldMenu = new StringSelectMenuBuilder()
    .setCustomId(`settings:field:${moduleKey}`)
    .setPlaceholder("Выбрать параметр")
    .addOptions(
      fields.map((field) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(field.label.slice(0, 100))
          .setDescription(field.description.slice(0, 100))
          .setValue(field.key)
      )
    );

  const back = new ButtonBuilder()
    .setCustomId(`settings:moduleview:${moduleKey}`)
    .setLabel("Назад к модулю")
    .setEmoji("↩️")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(fieldMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(back)
    ]
  };
}

async function buildFieldEditor(moduleKey: string, fieldKey: string) {
  const module = getModule(moduleKey);
  const field = getField(moduleKey, fieldKey);
  const state = await getModuleState(moduleKey);

  if (!module || !field || !state) {
    return null;
  }

  const settings = readSettings(state.settings);
  const current = displaySettingValue(field, settings[field.key]);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`${module.emoji} ${field.label}`)
    .setDescription(field.description)
    .addFields({
      name: "Текущее значение",
      value: current
    });

  const back = new ButtonBuilder()
    .setCustomId(`settings:parameters:${moduleKey}`)
    .setLabel("К параметрам")
    .setEmoji("↩️")
    .setStyle(ButtonStyle.Secondary);

  if (field.kind === "boolean") {
    const enabled = new ButtonBuilder()
      .setCustomId(`settings:setbool:${moduleKey}:${fieldKey}:true`)
      .setLabel("Включить")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success);

    const disabled = new ButtonBuilder()
      .setCustomId(`settings:setbool:${moduleKey}:${fieldKey}:false`)
      .setLabel("Выключить")
      .setEmoji("⛔")
      .setStyle(ButtonStyle.Danger);

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          enabled,
          disabled,
          back
        )
      ]
    };
  }

  if (field.kind === "select") {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`settings:setselect:${moduleKey}:${fieldKey}`)
      .setPlaceholder("Выбрать значение")
      .addOptions(
        (field.options ?? []).map((option) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(option.label)
            .setValue(option.value)
        )
      );

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(back)
      ]
    };
  }

  if (field.kind === "channel") {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`settings:setchannel:${moduleKey}:${fieldKey}`)
      .setPlaceholder("Выбрать канал")
      .setMinValues(1)
      .setMaxValues(1);

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(back)
      ]
    };
  }

  if (field.kind === "role") {
    const select = new RoleSelectMenuBuilder()
      .setCustomId(`settings:setrole:${moduleKey}:${fieldKey}`)
      .setPlaceholder("Выбрать роль")
      .setMinValues(1)
      .setMaxValues(1);

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(back)
      ]
    };
  }

  return null;
}

function buildTextModal(
  moduleKey: string,
  field: SettingFieldDefinition,
  currentValue: unknown
) {
  const isNumber = field.kind === "number";
  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(field.label.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(
      isNumber
        ? [
            field.min !== undefined ? `от ${field.min}` : null,
            field.max !== undefined ? `до ${field.max}` : null
          ]
            .filter(Boolean)
            .join(" ")
            .slice(0, 100)
        : field.description.slice(0, 100)
    );

  const value = currentValue ?? field.defaultValue;

  if (value !== undefined && value !== null && value !== "") {
    input.setValue(String(value).slice(0, 4000));
  }

  return new ModalBuilder()
    .setCustomId(`settings:modal:${moduleKey}:${field.key}`)
    .setTitle(field.label.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input)
    );
}

function parseSettingCustomId(
  customId: string,
  prefix: string
): { moduleKey: string; fieldKey: string } | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const rest = customId.slice(prefix.length);
  const separator = rest.indexOf(":");

  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }

  return {
    moduleKey: rest.slice(0, separator),
    fieldKey: rest.slice(separator + 1)
  };
}

async function denySettingsAccess(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  await interaction.reply({
    content: "У тебя нет доступа к настройкам NetroxBot.",
    flags: MessageFlags.Ephemeral
  });
}

client.once("ready", async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      env.DISCORD_CLIENT_ID,
      env.DISCORD_GUILD_ID
    ),
    { body: commands }
  );

  startModerationScheduler(moderationRuntime);
  startEconomyVoiceRewards(client, economyRuntime);

  console.log(`NetroxBot запущен как ${readyClient.user.tag}`);
});

client.on("messageCreate", async (message) => {
  try {
    await handleAutomodMessage(message, moderationRuntime);
  } catch (error) {
    console.error("Ошибка автомодерации", error);
  }

  try {
    await handleEconomyMessage(economyRuntime, message);
  } catch (error) {
    console.error("Ошибка экономики активности", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.guildId && interaction.guildId !== env.DISCORD_GUILD_ID) {
      return;
    }

    if (await handleModerationInteraction(interaction, moderationRuntime)) {
      return;
    }

    if (await handleEconomyInteraction(economyRuntime, interaction)) {
      return;
    }

    if (
      interaction.isChatInputCommand() &&
      (await handleMusicCommand(musicRuntime, interaction))
    ) {
      return;
    }

    if (
      interaction.isButton() &&
      (await handleMusicButton(musicRuntime, interaction))
    ) {
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "help") {
        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle("NetroxBot — помощь")
          .setDescription(
            "Главное меню помощи. Разделы будут подключаться по мере готовности модулей."
          )
          .addFields(
            {
              name: "Модерация",
              value: "Наказания, автомодерация, апелляции и логи.",
              inline: true
            },
            {
              name: "Экономика",
              value: "🪙 NetCoin, банк, предметы, магазин и аукционы.",
              inline: true
            },
            {
              name: "Музыка",
              value: "Очередь, плейлисты, управление и 24/7 режим.",
              inline: true
            },
            {
              name: "Сервер",
              value: "Тикеты, роли, заявки, события, статистика и другое.",
              inline: true
            }
          )
          .setFooter({ text: "Mothers Fantastic" });

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.commandName === "settings") {
        if (!(await canManageSettings(interaction.user.id))) {
          await denySettingsAccess(interaction);
          return;
        }

        await interaction.reply({
          ...buildSettingsHome(),
          flags: MessageFlags.Ephemeral
        });
      }

      return;
    }

    if (
      interaction.isStringSelectMenu() ||
      interaction.isChannelSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isButton() ||
      interaction.isModalSubmit()
    ) {
      if (!(await canManageSettings(interaction.user.id))) {
        await denySettingsAccess(interaction);
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "settings:category") {
        const view = buildCategoryView(interaction.values[0] ?? "");

        if (!view) {
          await interaction.reply({
            content: "Раздел настроек не найден.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.update(view);
        return;
      }

      if (interaction.customId === "settings:module") {
        const view = await buildModuleView(interaction.values[0] ?? "");

        if (!view) {
          await interaction.reply({
            content: "Модуль настроек не найден.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.update(view);
        return;
      }

      if (interaction.customId.startsWith("settings:field:")) {
        const moduleKey = interaction.customId.slice("settings:field:".length);
        const fieldKey = interaction.values[0] ?? "";
        const field = getField(moduleKey, fieldKey);

        if (!field) {
          await interaction.reply({
            content: "Параметр не найден.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        if (field.kind === "text" || field.kind === "number") {
          const state = await getModuleState(moduleKey);
          const settings = readSettings(state?.settings);
          await interaction.showModal(
            buildTextModal(moduleKey, field, settings[fieldKey])
          );
          return;
        }

        const view = await buildFieldEditor(moduleKey, fieldKey);

        if (view) {
          await interaction.update(view);
        }

        return;
      }

      const selectTarget = parseSettingCustomId(
        interaction.customId,
        "settings:setselect:"
      );

      if (selectTarget) {
        await saveModuleSetting(
          selectTarget.moduleKey,
          selectTarget.fieldKey,
          interaction.values[0] ?? null,
          interaction.user.id
        );

        const view = await buildParametersView(selectTarget.moduleKey);

        if (view) {
          await interaction.update(view);
        }

        return;
      }
    }

    if (interaction.isChannelSelectMenu()) {
      const target = parseSettingCustomId(
        interaction.customId,
        "settings:setchannel:"
      );

      if (target) {
        await saveModuleSetting(
          target.moduleKey,
          target.fieldKey,
          interaction.values[0] ?? null,
          interaction.user.id
        );

        const view = await buildParametersView(target.moduleKey);

        if (view) {
          await interaction.update(view);
        }
      }

      return;
    }

    if (interaction.isRoleSelectMenu()) {
      const target = parseSettingCustomId(
        interaction.customId,
        "settings:setrole:"
      );

      if (target) {
        await saveModuleSetting(
          target.moduleKey,
          target.fieldKey,
          interaction.values[0] ?? null,
          interaction.user.id
        );

        const view = await buildParametersView(target.moduleKey);

        if (view) {
          await interaction.update(view);
        }
      }

      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === "settings:home") {
        await interaction.update(buildSettingsHome());
        return;
      }

      if (interaction.customId.startsWith("settings:category:")) {
        const categoryKey = interaction.customId.slice(
          "settings:category:".length
        );
        const view = buildCategoryView(categoryKey);

        if (view) {
          await interaction.update(view);
        }

        return;
      }

      if (interaction.customId.startsWith("settings:moduleview:")) {
        const moduleKey = interaction.customId.slice(
          "settings:moduleview:".length
        );
        const view = await buildModuleView(moduleKey);

        if (view) {
          await interaction.update(view);
        }

        return;
      }

      if (interaction.customId.startsWith("settings:parameters:")) {
        const moduleKey = interaction.customId.slice(
          "settings:parameters:".length
        );
        const view = await buildParametersView(moduleKey);

        if (view) {
          await interaction.update(view);
        }

        return;
      }

      if (interaction.customId.startsWith("settings:toggle:")) {
        const moduleKey = interaction.customId.slice("settings:toggle:".length);
        const module = getModule(moduleKey);

        if (!module) {
          await interaction.reply({
            content: "Модуль настроек не найден.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const current = await getModuleState(module.key);

        if (!current) {
          return;
        }

        const nextEnabled = !current.enabled;

        await prisma.$transaction([
          prisma.moduleConfig.update({
            where: {
              guildId_moduleKey: {
                guildId: env.DISCORD_GUILD_ID,
                moduleKey: module.key
              }
            },
            data: { enabled: nextEnabled }
          }),
          prisma.auditLog.create({
            data: {
              guildId: env.DISCORD_GUILD_ID,
              actorId: interaction.user.id,
              action: "settings.module.toggle",
              targetType: "module",
              targetId: module.key,
              payload: {
                module: module.key,
                enabled: nextEnabled,
                source: "discord"
              }
            }
          })
        ]);

        await emitServerLog(client, env.DISCORD_GUILD_ID, {
          category: "settings",
          eventType: "settings.module.toggle",
          summary:
            "Модуль " +
            module.title +
            (nextEnabled ? " включён" : " выключен") +
            " через Discord.",
          actorId: interaction.user.id,
          targetType: "module",
          targetId: module.key,
          payload: {
            enabled: nextEnabled
          }
        });

        const view = await buildModuleView(module.key);

        if (view) {
          await interaction.update(view);
        }

        return;
      }

      if (interaction.customId.startsWith("settings:setbool:")) {
        const raw = interaction.customId.slice("settings:setbool:".length);
        const parts = raw.split(":");

        if (parts.length === 3) {
          const [moduleKey, fieldKey, rawValue] = parts;

          if (moduleKey && fieldKey) {
            await saveModuleSetting(
              moduleKey,
              fieldKey,
              rawValue === "true",
              interaction.user.id
            );

            const view = await buildParametersView(moduleKey);

            if (view) {
              await interaction.update(view);
            }
          }
        }
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      const target = parseSettingCustomId(
        interaction.customId,
        "settings:modal:"
      );

      if (!target) {
        return;
      }

      const field = getField(target.moduleKey, target.fieldKey);

      if (!field || (field.kind !== "text" && field.kind !== "number")) {
        await interaction.reply({
          content: "Параметр не найден.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const rawValue = interaction.fields.getTextInputValue("value").trim();
      let value: string | number = rawValue;

      if (field.kind === "number") {
        const parsed = Number(rawValue);

        if (
          !Number.isFinite(parsed) ||
          (field.min !== undefined && parsed < field.min) ||
          (field.max !== undefined && parsed > field.max)
        ) {
          const limits = [
            field.min !== undefined ? `от ${field.min}` : null,
            field.max !== undefined ? `до ${field.max}` : null
          ]
            .filter(Boolean)
            .join(" ");

          await interaction.reply({
            content: `Нужно указать корректное число${limits ? ` ${limits}` : ""}.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        value = parsed;
      }

      await saveModuleSetting(
        target.moduleKey,
        target.fieldKey,
        value,
        interaction.user.id
      );

      const view = await buildParametersView(target.moduleKey);

      if (view && interaction.isFromMessage()) {
        await interaction.update(view);
      } else {
        await interaction.reply({
          content: "Параметр сохранён.",
          flags: MessageFlags.Ephemeral
        });
      }
    }
  } catch (error) {
    console.error("Ошибка обработки Discord interaction", error);

    if (!interaction.isRepliable()) {
      return;
    }

    const message = {
      content: "Не удалось выполнить действие. Ошибка записана в лог.",
      flags: MessageFlags.Ephemeral
    } as const;

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => undefined);
    } else {
      await interaction.reply(message).catch(() => undefined);
    }
  }
});

async function shutdown(signal: string) {
  console.log(`Получен ${signal}. Останавливаю NetroxBot...`);
  client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

await client.login(env.DISCORD_TOKEN);
