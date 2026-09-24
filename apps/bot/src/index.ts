import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
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

client.once("ready", async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body: commands }
  );

  console.log(`NetroxBot запущен как ${readyClient.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

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
    const allowed = interaction.user.id === env.SUPERADMIN_DISCORD_ID;
    if (!allowed) {
      await interaction.reply({
        content: "У тебя пока нет доступа к настройкам NetroxBot.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle("Настройки NetroxBot")
      .setDescription("Каркас панели готов. Дальше сюда подключаются разделы модерации, экономики, музыки, ролей, логов, интеграций и остальных модулей.")
      .setFooter({ text: "Изменения настроек будут журналироваться." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
});

client.login(env.DISCORD_TOKEN);
