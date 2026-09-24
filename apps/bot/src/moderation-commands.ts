
import { SlashCommandBuilder } from "discord.js";

export const moderationCommandBuilders = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Забанить участника")
    .addUserOption((option) =>
      option.setName("user").setDescription("Участник").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("duration").setDescription("Временно: 30m, 2h, 7d, 1w")
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Выгнать участника")
    .addUserOption((option) =>
      option.setName("user").setDescription("Участник").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Выдать Discord timeout")
    .addUserOption((option) =>
      option.setName("user").setDescription("Участник").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("duration")
        .setDescription("Например: 10m, 2h, 3d")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Выдать mute-роль")
    .addUserOption((option) =>
      option.setName("user").setDescription("Участник").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("duration").setDescription("Необязательно: 30m, 2h, 7d")
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Выдать предупреждение")
    .addUserOption((option) =>
      option.setName("user").setDescription("Участник").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Причина")
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Снять предупреждение по номеру кейса")
    .addIntegerOption((option) =>
      option
        .setName("case")
        .setDescription("Номер warn-кейса")
        .setMinValue(1)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Причина снятия")
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Удалить сообщения из канала")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Количество сообщений")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Удалять только сообщения этого участника")
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Изменить slowmode текущего канала")
    .addIntegerOption((option) =>
      option
        .setName("seconds")
        .setDescription("0 — выключить, максимум 21600")
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Закрыть текущий текстовый канал")
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Открыть текущий текстовый канал")
    .addStringOption((option) =>
      option.setName("reason").setDescription("Причина").setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Показать историю наказаний участника")
    .addUserOption((option) =>
      option.setName("user").setDescription("Участник").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("case")
    .setDescription("Работа с moderation-кейсами")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("Посмотреть кейс")
        .addIntegerOption((option) =>
          option
            .setName("number")
            .setDescription("Номер кейса")
            .setMinValue(1)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Отменить активное наказание")
        .addIntegerOption((option) =>
          option
            .setName("number")
            .setDescription("Номер кейса")
            .setMinValue(1)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Причина отмены")
            .setMaxLength(1000)
        )
    ),

  new SlashCommandBuilder()
    .setName("modstats")
    .setDescription("Статистика модератора")
    .addUserOption((option) =>
      option
        .setName("moderator")
        .setDescription("Модератор; по умолчанию — ты")
    )
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("Период")
        .addChoices(
          { name: "7 дней", value: "7d" },
          { name: "30 дней", value: "30d" },
          { name: "Всё время", value: "all" }
        )
    ),

  new SlashCommandBuilder()
    .setName("appeal")
    .setDescription("Подать апелляцию на свой moderation-кейс")
    .addIntegerOption((option) =>
      option
        .setName("case")
        .setDescription("Номер кейса")
        .setMinValue(1)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("Почему наказание нужно пересмотреть")
        .setMinLength(10)
        .setMaxLength(1500)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("appeals")
    .setDescription("Рассмотрение апелляций")
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Список ожидающих апелляций")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("accept")
        .setDescription("Принять апелляцию")
        .addStringOption((option) =>
          option.setName("id").setDescription("ID апелляции").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Комментарий").setMaxLength(1000)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reject")
        .setDescription("Отклонить апелляцию")
        .addStringOption((option) =>
          option.setName("id").setDescription("ID апелляции").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Комментарий").setMaxLength(1000)
        )
    )
];

export const moderationCommands = moderationCommandBuilders.map((command) =>
  command.toJSON()
);

export const moderationCommandNames = new Set(
  moderationCommandBuilders.map((command) => command.name)
);
