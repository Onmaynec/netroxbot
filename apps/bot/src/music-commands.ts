import { SlashCommandBuilder } from "discord.js";

export const musicCommandBuilders = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Включить трек, плейлист или найти музыку")
    .addStringOption((option) =>
      option
        .setName("запрос")
        .setDescription("Название или ссылка на трек/плейлист")
        .setRequired(true)
        .setMaxLength(500)
    ),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Поставить музыку на паузу"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Продолжить воспроизведение"),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Пропустить текущий трек или проголосовать за skip"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Остановить музыку и очистить очередь"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Показать текущую очередь"),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Показать текущий трек"),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Перемотать текущий трек")
    .addStringOption((option) =>
      option
        .setName("позиция")
        .setDescription("Например: 1m30s или 45s")
        .setRequired(true)
        .setMaxLength(32)
    ),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Изменить громкость")
    .addIntegerOption((option) =>
      option
        .setName("процент")
        .setDescription("Громкость от 1 до 100")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Настроить повтор")
    .addStringOption((option) =>
      option
        .setName("режим")
        .setDescription("Что повторять")
        .setRequired(true)
        .addChoices(
          { name: "Выключен", value: "none" },
          { name: "Текущий трек", value: "track" },
          { name: "Вся очередь", value: "queue" }
        )
    ),
  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Перемешать очередь"),
  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Включить или выключить Autoplay")
    .addBooleanOption((option) =>
      option
        .setName("включен")
        .setDescription("Состояние Autoplay")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("music247")
    .setDescription("Закрепить плеер в голосовом канале 24/7")
    .addBooleanOption((option) =>
      option
        .setName("включен")
        .setDescription("Не отключаться после окончания очереди")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("favorite")
    .setDescription("Работа с избранными треками")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("toggle")
        .setDescription("Добавить текущий трек в избранное или убрать его")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Показать избранные треки")
    ),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Показать историю прослушивания"),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Личные музыкальные плейлисты")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Создать плейлист")
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название плейлиста")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(64)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Удалить плейлист")
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название плейлиста")
            .setRequired(true)
            .setMaxLength(64)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Показать свои плейлисты")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("show")
        .setDescription("Показать содержимое плейлиста")
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название плейлиста")
            .setRequired(true)
            .setMaxLength(64)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Добавить текущий трек в плейлист")
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название плейлиста")
            .setRequired(true)
            .setMaxLength(64)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Удалить трек из плейлиста")
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название плейлиста")
            .setRequired(true)
            .setMaxLength(64)
        )
        .addIntegerOption((option) =>
          option
            .setName("позиция")
            .setDescription("Номер трека в плейлисте")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("play")
        .setDescription("Добавить плейлист в очередь")
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название плейлиста")
            .setRequired(true)
            .setMaxLength(64)
        )
    )
];

export const musicCommands = musicCommandBuilders.map((command) =>
  command.toJSON()
);

export const musicCommandNames = new Set(
  musicCommandBuilders.map((command) => command.name)
);
