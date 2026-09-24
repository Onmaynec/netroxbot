import { SlashCommandBuilder } from "discord.js";

export const tradeCommandBuilders = [
  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Торговая площадка предметов")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("browse")
        .setDescription("Показать активные объявления")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("sell")
        .setDescription("Выставить серийный предмет на продажу")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID экземпляра предмета из /inventory")
            .setRequired(true)
            .setMaxLength(64)
        )
        .addIntegerOption((option) =>
          option
            .setName("цена")
            .setDescription("Цена в NEC")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("buy")
        .setDescription("Купить предмет по ID объявления")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID объявления")
            .setRequired(true)
            .setMaxLength(64)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Снять своё объявление")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID объявления")
            .setRequired(true)
            .setMaxLength(64)
        )
    ),
  new SlashCommandBuilder()
    .setName("auction")
    .setDescription("Аукционы NetCoin")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("browse")
        .setDescription("Показать активные аукционы")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Выставить свой предмет на аукцион")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID экземпляра предмета из /inventory")
            .setRequired(true)
            .setMaxLength(64)
        )
        .addIntegerOption((option) =>
          option
            .setName("старт")
            .setDescription("Стартовая цена в NEC")
            .setRequired(true)
            .setMinValue(1)
        )
        .addIntegerOption((option) =>
          option
            .setName("шаг")
            .setDescription("Минимальный шаг ставки")
            .setMinValue(1)
        )
        .addIntegerOption((option) =>
          option
            .setName("часы")
            .setDescription("Длительность аукциона")
            .setMinValue(1)
            .setMaxValue(336)
        )
        .addIntegerOption((option) =>
          option
            .setName("выкуп")
            .setDescription("Цена моментального выкупа")
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("bid")
        .setDescription("Сделать ставку")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID аукциона")
            .setRequired(true)
            .setMaxLength(64)
        )
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Ставка в NEC")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Отменить свой аукцион")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID аукциона")
            .setRequired(true)
            .setMaxLength(64)
        )
    ),
  new SlashCommandBuilder()
    .setName("lottery")
    .setDescription("Серверная лотерея")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("browse")
        .setDescription("Показать текущие лотереи")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("buy")
        .setDescription("Купить билеты")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID лотереи")
            .setRequired(true)
            .setMaxLength(64)
        )
        .addIntegerOption((option) =>
          option
            .setName("количество")
            .setDescription("Сколько билетов купить")
            .setRequired(true)
            .setMinValue(1)
        )
    ),
  new SlashCommandBuilder()
    .setName("game")
    .setDescription("Мини-игры NetroxBot")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("dice")
        .setDescription("Бросить вызов в кости")
        .addUserOption((option) =>
          option
            .setName("соперник")
            .setDescription("Кому бросить вызов")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("ставка")
            .setDescription("Ставка NEC")
            .setRequired(true)
            .setMinValue(0)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("tictactoe")
        .setDescription("Бросить вызов в крестики-нолики")
        .addUserOption((option) =>
          option
            .setName("соперник")
            .setDescription("Кому бросить вызов")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("ставка")
            .setDescription("Ставка NEC")
            .setRequired(true)
            .setMinValue(0)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("math")
        .setDescription("Бросить вызов в математическую дуэль")
        .addUserOption((option) =>
          option
            .setName("соперник")
            .setDescription("Кому бросить вызов")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("ставка")
            .setDescription("Ставка NEC")
            .setRequired(true)
            .setMinValue(0)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("blackjack")
        .setDescription("Сыграть в blackjack")
        .addIntegerOption((option) =>
          option
            .setName("ставка")
            .setDescription("Ставка NEC")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("guess")
        .setDescription("Сыграть в «Угадай число»")
        .addIntegerOption((option) =>
          option
            .setName("ставка")
            .setDescription("Ставка NEC")
            .setRequired(true)
            .setMinValue(1)
        )
        .addIntegerOption((option) =>
          option
            .setName("число")
            .setDescription("Число от 1 до 20")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
];

export const tradeCommands = tradeCommandBuilders.map((command) =>
  command.toJSON()
);

export const tradeCommandNames = new Set(
  tradeCommandBuilders.map((command) => command.name)
);
