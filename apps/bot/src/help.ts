import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction
} from "discord.js";
import { moderationCommands } from "./moderation-commands.js";
import { economyCommands } from "./economy-commands.js";
import { musicCommands } from "./music-commands.js";

const ACCENT = 0x57f287;
const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

type HelpPage = "home" | "moderation" | "economy" | "music" | "system";

type HelpOption = {
  type?: number | undefined;
  name: string;
  description?: string | undefined;
  required?: boolean | undefined;
  options?: HelpOption[] | undefined;
};

type HelpCommand = {
  name: string;
  description: string;
  options?: HelpOption[] | undefined;
};

const sections: Record<
  Exclude<HelpPage, "home" | "system">,
  {
    emoji: string;
    title: string;
    description: string;
    commands: HelpCommand[];
  }
> = {
  moderation: {
    emoji: "🛡️",
    title: "Модерация",
    description:
      "Наказания, управление каналами, moderation-кейсы, апелляции и статистика модераторов.",
    commands: moderationCommands
  },
  economy: {
    emoji: "🪙",
    title: "Экономика NetCoin",
    description:
      "Кошелёк, банк, переводы, награды, магазин, инвентарь, кредиты и администрирование экономики.",
    commands: economyCommands
  },
  music: {
    emoji: "🎵",
    title: "Музыка",
    description:
      "Поиск и воспроизведение музыки, очередь, плейлисты, избранное, история и управление плеером.",
    commands: musicCommands
  }
};

function optionToken(option: HelpOption) {
  return option.required ? `<${option.name}>` : `[${option.name}]`;
}

function simpleOptions(options: HelpOption[] | undefined) {
  return (options ?? [])
    .filter(
      (option) =>
        option.type !== SUBCOMMAND && option.type !== SUBCOMMAND_GROUP
    )
    .map(optionToken);
}

function commandLines(command: HelpCommand): string[] {
  const options = command.options ?? [];
  const subcommands = options.filter((option) => option.type === SUBCOMMAND);
  const groups = options.filter((option) => option.type === SUBCOMMAND_GROUP);

  if (subcommands.length === 0 && groups.length === 0) {
    const suffix = simpleOptions(options);
    const signature =
      `/${command.name}` + (suffix.length > 0 ? ` ${suffix.join(" ")}` : "");

    return [`\`${signature}\` — ${command.description}`];
  }

  const lines: string[] = [];

  for (const subcommand of subcommands) {
    const suffix = simpleOptions(subcommand.options);
    const signature =
      `/${command.name} ${subcommand.name}` +
      (suffix.length > 0 ? ` ${suffix.join(" ")}` : "");

    lines.push(
      `\`${signature}\` — ${subcommand.description ?? command.description}`
    );
  }

  for (const group of groups) {
    const nested = (group.options ?? []).filter(
      (option) => option.type === SUBCOMMAND
    );

    for (const subcommand of nested) {
      const suffix = simpleOptions(subcommand.options);
      const signature =
        `/${command.name} ${group.name} ${subcommand.name}` +
        (suffix.length > 0 ? ` ${suffix.join(" ")}` : "");

      lines.push(
        `\`${signature}\` — ${subcommand.description ?? group.description ?? command.description}`
      );
    }
  }

  return lines;
}

function chunkLines(lines: string[], maxLength = 980) {
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? current + "\n" + line : line;

    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function navigation(page: HelpPage) {
  const entries: Array<{
    page: HelpPage;
    label: string;
    emoji: string;
  }> = [
    { page: "home", label: "Главная", emoji: "🏠" },
    { page: "moderation", label: "Модерация", emoji: "🛡️" },
    { page: "economy", label: "Экономика", emoji: "🪙" },
    { page: "music", label: "Музыка", emoji: "🎵" },
    { page: "system", label: "Система", emoji: "⚙️" }
  ];

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...entries.map((entry) =>
        new ButtonBuilder()
          .setCustomId(`help:${entry.page}`)
          .setLabel(entry.label)
          .setEmoji(entry.emoji)
          .setStyle(
            entry.page === page ? ButtonStyle.Primary : ButtonStyle.Secondary
          )
      )
    )
  ];
}

function baseEmbed(botAvatarUrl?: string) {
  const embed = new EmbedBuilder().setColor(ACCENT);

  if (botAvatarUrl) {
    embed.setAuthor({
      name: "NetroxBot • Command Center",
      iconURL: botAvatarUrl
    });
  } else {
    embed.setAuthor({ name: "NetroxBot • Command Center" });
  }

  return embed.setFooter({
    text: "Mothers Fantastic • <аргумент> обязателен • [аргумент] необязателен"
  });
}

function homeView(botAvatarUrl?: string) {
  const total =
    2 +
    moderationCommands.length +
    economyCommands.length +
    musicCommands.length;

  const embed = baseEmbed(botAvatarUrl)
    .setTitle("📚 Центр помощи")
    .setDescription(
      "Здесь собраны **реальные команды NetroxBot**, которые сейчас зарегистрированы на сервере.\n" +
        "Выбери раздел кнопками ниже — внутри будут синтаксис команды и её назначение."
    )
    .addFields(
      {
        name: "⚡ Быстрый старт",
        value:
          "\`/help\` — открыть этот центр помощи\n" +
          "\`/settings\` — открыть настройки модулей NetroxBot",
        inline: false
      },
      {
        name: "🛡️ Модерация",
        value: `**${moderationCommands.length}** команд\nНаказания, кейсы, апелляции, управление каналами.`,
        inline: true
      },
      {
        name: "🪙 Экономика",
        value: `**${economyCommands.length}** команд\nNetCoin, банк, магазин, инвентарь, кредиты.`,
        inline: true
      },
      {
        name: "🎵 Музыка",
        value: `**${musicCommands.length}** команд\nПлеер, очередь, плейлисты, избранное и 24/7.`,
        inline: true
      },
      {
        name: "📌 Сейчас доступно",
        value:
          `**${total}** slash-команд верхнего уровня. Команды с подкомандами раскрываются на страницах разделов.`,
        inline: false
      }
    );

  return {
    embeds: [embed],
    components: navigation("home")
  };
}

function sectionView(
  page: "moderation" | "economy" | "music",
  botAvatarUrl?: string
) {
  const section = sections[page];
  const lines = section.commands.flatMap(commandLines);
  const chunks = chunkLines(lines);

  const embed = baseEmbed(botAvatarUrl)
    .setTitle(`${section.emoji} ${section.title}`)
    .setDescription(
      section.description +
        `\n\n**Команд верхнего уровня:** ${section.commands.length} • **вариантов вызова:** ${lines.length}`
    )
    .addFields(
      chunks.map((chunk, index) => ({
        name: index === 0 ? "Доступные команды" : `Продолжение • ${index + 1}`,
        value: chunk,
        inline: false
      }))
    );

  return {
    embeds: [embed],
    components: navigation(page)
  };
}

function systemView(botAvatarUrl?: string) {
  const embed = baseEmbed(botAvatarUrl)
    .setTitle("⚙️ Система и настройки")
    .setDescription(
      "Системные команды NetroxBot и короткая памятка по работе со справкой."
    )
    .addFields(
      {
        name: "Команды",
        value:
          "\`/help\` — открыть интерактивную справку\n" +
          "\`/settings\` — открыть настройки модулей бота",
        inline: false
      },
      {
        name: "Как читать синтаксис",
        value:
          "\`<параметр>\` — обязателен\n" +
          "\`[параметр]\` — необязателен\n" +
          "Если у команды есть подкоманды, в справке показывается полный путь, например \`/bank deposit <сумма>\`.",
        inline: false
      },
      {
        name: "Доступ к настройкам",
        value:
          "Часть административных действий доступна только владельцу, администраторам или пользователям с нужными правами.",
        inline: false
      }
    );

  return {
    embeds: [embed],
    components: navigation("system")
  };
}

export function buildHelpView(page: HelpPage, botAvatarUrl?: string) {
  if (page === "home") {
    return homeView(botAvatarUrl);
  }

  if (page === "system") {
    return systemView(botAvatarUrl);
  }

  return sectionView(page, botAvatarUrl);
}

export async function handleHelpButton(
  interaction: ButtonInteraction,
  botAvatarUrl?: string
) {
  if (!interaction.customId.startsWith("help:")) {
    return false;
  }

  const rawPage = interaction.customId.slice("help:".length);
  const page: HelpPage =
    rawPage === "moderation" ||
    rawPage === "economy" ||
    rawPage === "music" ||
    rawPage === "system"
      ? rawPage
      : "home";

  await interaction.update(buildHelpView(page, botAvatarUrl));
  return true;
}
