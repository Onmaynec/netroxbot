import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import { MODULES, SETTINGS_CATEGORIES, getCategory, getModule, getModulesByCategory } from "@netrox/core";
import { prisma } from "@netrox/database";
import { z } from "zod";

const env = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  SUPERADMIN_DISCORD_ID: z.string().min(1)
}).parse(process.env);

const ACCENT = 0x57f287;

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Открыть справку NetroxBot"),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Открыть настройки NetroxBot")
].map((command) => command.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences
  ]
});

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

function buildSettingsHome() {
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("⚙️ Настройки NetroxBot")
    .setDescription(
      "Выбери раздел. Здесь постепенно собираются все настройки бота — без ручной правки конфигов и перезапуска."
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
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)]
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
    .setDescription(`${category.description}\n\nВыбери модуль, который нужно настроить.`)
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

  const status = state.enabled ? "🟢 Включён" : "⚫ Выключен";
  const embed = new EmbedBuilder()
    .setColor(state.enabled ? ACCENT : 0x747f8d)
    .setTitle(`${module.emoji} ${module.title}`)
    .setDescription(module.description)
    .addFields(
      { name: "Состояние", value: status, inline: true },
      { name: "Ключ модуля", value: `\`${module.key}\``, inline: true }
    )
    .setFooter({ text: "Изменения применяются сразу и записываются в журнал." });

  const toggle = new ButtonBuilder()
    .setCustomId(`settings:toggle:${module.key}`)
    .setLabel(state.enabled ? "Выключить модуль" : "Включить модуль")
    .setEmoji(state.enabled ? "⏸️" : "▶️")
    .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const back = new ButtonBuilder()
    .setCustomId(`settings:category:${module.category}`)
    .setLabel("Назад к разделу")
    .setEmoji("↩️")
    .setStyle(ButtonStyle.Secondary);

  const home = new ButtonBuilder()
    .setCustomId("settings:home")
    .setLabel("Главное меню")
    .setEmoji("🏠")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(toggle, back, home)]
  };
}

async function denySettingsAccess(
  interaction:
    | Parameters<NonNullable<Parameters<typeof client.on<"interactionCreate">>[1]>>[0]
): Promise<void> {
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
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body: commands }
  );

  console.log(`NetroxBot запущен как ${readyClient.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.guildId && interaction.guildId !== env.DISCORD_GUILD_ID) {
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "help") {
        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle("NetroxBot — помощь")
          .setDescription("Главное меню помощи. Разделы будут подключаться по мере готовности модулей.")
          .addFields(
            { name: "Модерация", value: "Наказания, автомодерация, апелляции и логи.", inline: true },
            { name: "Экономика", value: "🪙 NetCoin, банк, предметы, магазин и аукционы.", inline: true },
            { name: "Музыка", value: "Очередь, плейлисты, управление и 24/7 режим.", inline: true },
            { name: "Сервер", value: "Тикеты, роли, заявки, события, статистика и другое.", inline: true }
          )
          .setFooter({ text: "Mothers Fantastic" });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

    if (interaction.isStringSelectMenu()) {
      if (!(await canManageSettings(interaction.user.id))) {
        await denySettingsAccess(interaction);
        return;
      }

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
    }

    if (interaction.isButton()) {
      if (!(await canManageSettings(interaction.user.id))) {
        await denySettingsAccess(interaction);
        return;
      }

      if (interaction.customId === "settings:home") {
        await interaction.update(buildSettingsHome());
        return;
      }

      if (interaction.customId.startsWith("settings:category:")) {
        const categoryKey = interaction.customId.slice("settings:category:".length);
        const view = buildCategoryView(categoryKey);

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

        const view = await buildModuleView(module.key);

        if (view) {
          await interaction.update(view);
        }
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
