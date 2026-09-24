import { SlashCommandBuilder } from "discord.js";

export const economyCommandBuilders = [
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Показать баланс NetCoin")
    .addUserOption((option) =>
      option
        .setName("пользователь")
        .setDescription("Чей баланс показать")
    ),
  new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Управление банком NetCoin")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("deposit")
        .setDescription("Перевести NEC из кошелька в банк")
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Сколько NEC внести")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("withdraw")
        .setDescription("Снять NEC из банка")
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Сколько NEC снять")
            .setRequired(true)
            .setMinValue(1)
        )
    ),
  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Перевести NEC другому участнику")
    .addUserOption((option) =>
      option
        .setName("пользователь")
        .setDescription("Кому отправить NEC")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("сумма")
        .setDescription("Сколько NEC отправить")
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Получить ежедневную награду NEC"),
  new SlashCommandBuilder()
    .setName("work")
    .setDescription("Поработать и получить NEC"),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Открыть магазин NetroxBot")
    .addIntegerOption((option) =>
      option
        .setName("страница")
        .setDescription("Страница магазина")
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Показать инвентарь")
    .addUserOption((option) =>
      option
        .setName("пользователь")
        .setDescription("Чей инвентарь показать")
    ),
  new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Подарить предмет другому участнику")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("ID экземпляра предмета из инвентаря")
        .setRequired(true)
        .setMaxLength(64)
    )
    .addUserOption((option) =>
      option
        .setName("пользователь")
        .setDescription("Кому подарить предмет")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("loan")
    .setDescription("Банковские кредиты NetCoin")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Показать текущий кредит")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("take")
        .setDescription("Взять кредит")
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Сумма кредита")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("repay")
        .setDescription("Погасить кредит")
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Сумма платежа")
            .setRequired(true)
            .setMinValue(1)
        )
    ),
  new SlashCommandBuilder()
    .setName("economyadmin")
    .setDescription("Администрирование экономики NetCoin")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("grant")
        .setDescription("Выдать NEC участнику")
        .addUserOption((option) =>
          option
            .setName("пользователь")
            .setDescription("Кому выдать NEC")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Сколько NEC выдать")
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((option) =>
          option
            .setName("причина")
            .setDescription("Причина выдачи")
            .setMaxLength(200)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("take")
        .setDescription("Изъять NEC у участника")
        .addUserOption((option) =>
          option
            .setName("пользователь")
            .setDescription("У кого изъять NEC")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("сумма")
            .setDescription("Сколько NEC изъять")
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((option) =>
          option
            .setName("причина")
            .setDescription("Причина изъятия")
            .setMaxLength(200)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("item-create")
        .setDescription("Добавить предмет в магазин")
        .addStringOption((option) =>
          option
            .setName("sku")
            .setDescription("Уникальный короткий код предмета")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(32)
        )
        .addStringOption((option) =>
          option
            .setName("название")
            .setDescription("Название предмета")
            .setRequired(true)
            .setMaxLength(80)
        )
        .addIntegerOption((option) =>
          option
            .setName("цена")
            .setDescription("Цена в NEC")
            .setRequired(true)
            .setMinValue(0)
        )
        .addStringOption((option) =>
          option
            .setName("редкость")
            .setDescription("Редкость предмета")
            .setRequired(true)
            .addChoices(
              { name: "Обычная", value: "COMMON" },
              { name: "Необычная", value: "UNCOMMON" },
              { name: "Редкая", value: "RARE" },
              { name: "Эпическая", value: "EPIC" },
              { name: "Легендарная", value: "LEGENDARY" },
              { name: "Мифическая", value: "MYTHIC" },
              { name: "Уникальная", value: "UNIQUE" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("тип")
            .setDescription("Тип предмета")
            .setRequired(true)
            .addChoices(
              { name: "Коллекционный", value: "COLLECTIBLE" },
              { name: "Косметика", value: "COSMETIC" },
              { name: "Роль", value: "ROLE" },
              { name: "Значок", value: "BADGE" },
              { name: "Другое", value: "OTHER" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("описание")
            .setDescription("Описание предмета")
            .setMaxLength(300)
        )
        .addStringOption((option) =>
          option
            .setName("картинка")
            .setDescription("HTTPS-ссылка на изображение")
            .setMaxLength(500)
        )
        .addRoleOption((option) =>
          option
            .setName("роль")
            .setDescription("Роль для предмета типа ROLE")
        )
        .addIntegerOption((option) =>
          option
            .setName("остаток")
            .setDescription("Количество в магазине; пусто = без лимита")
            .setMinValue(1)
        )
        .addIntegerOption((option) =>
          option
            .setName("лимит")
            .setDescription("Максимум экземпляров на одного пользователя")
            .setMinValue(1)
        )
    )
];

export const economyCommands = economyCommandBuilders.map((command) =>
  command.toJSON()
);

export const economyCommandNames = new Set(
  economyCommandBuilders.map((command) => command.name)
);
