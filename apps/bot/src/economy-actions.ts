import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction
} from "discord.js";
import {
  EconomyError,
  buyShopItem,
  claimDailyReward,
  claimWorkReward,
  createEconomyItem,
  getActiveLoan,
  getEconomyAccount,
  giftItem,
  grantWallet,
  listInventory,
  listShopItems,
  moveBetweenWalletAndBank,
  removeWallet,
  repayLoan,
  takeLoan,
  transferWallet,
  prisma
} from "@netrox/database";
import { economyCommandNames } from "./economy-commands.js";

const ACCENT = 0x57f287;

export type EconomyRuntime = {
  guildId: string;
};

type EconomySettings = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function booleanSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: boolean
) {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

export async function getEconomySettings(
  guildId: string
): Promise<EconomySettings> {
  const row = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "economy"
      }
    }
  });

  return {
    enabled: row?.enabled ?? true,
    settings: record(row?.settings)
  };
}

function nec(value: bigint) {
  return "🪙 " + value.toLocaleString("ru-RU") + " NEC";
}

function cooldownText(error: EconomyError) {
  if (error.code !== "COOLDOWN") {
    return error.message;
  }

  const date = new Date(error.message);

  if (Number.isNaN(date.getTime())) {
    return "Награда пока недоступна.";
  }

  return (
    "Можно снова использовать команду <t:" +
    Math.floor(date.getTime() / 1000) +
    ":R>."
  );
}

async function replyError(
  interaction: ChatInputCommandInteraction,
  error: unknown
) {
  const text =
    error instanceof EconomyError
      ? cooldownText(error)
      : error instanceof Error
        ? error.message
        : "Не удалось выполнить операцию.";

  if (interaction.replied || interaction.deferred) {
    await interaction
      .followUp({
        content: text,
        flags: MessageFlags.Ephemeral
      })
      .catch(() => undefined);
  } else {
    await interaction
      .reply({
        content: text,
        flags: MessageFlags.Ephemeral
      })
      .catch(() => undefined);
  }
}

async function canAdminEconomy(
  interaction: ChatInputCommandInteraction
) {
  if (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { discordId: interaction.user.id }
  });

  return Boolean(admin && !admin.revokedAt);
}

function balanceEmbed(
  userLabel: string,
  account: Awaited<ReturnType<typeof getEconomyAccount>>
) {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🪙 Баланс NetCoin")
    .setDescription(userLabel)
    .addFields(
      {
        name: "Кошелёк",
        value: nec(account.wallet),
        inline: true
      },
      {
        name: "Банк",
        value: nec(account.bank),
        inline: true
      },
      {
        name: "Всего",
        value: nec(account.wallet + account.bank),
        inline: true
      }
    )
    .setFooter({ text: "NetCoin • NEC" });
}

function rarityLabel(rarity: string) {
  const labels: Record<string, string> = {
    COMMON: "Обычная",
    UNCOMMON: "Необычная",
    RARE: "Редкая",
    EPIC: "Эпическая",
    LEGENDARY: "Легендарная",
    MYTHIC: "Мифическая",
    UNIQUE: "Уникальная"
  };

  return labels[rarity] ?? rarity;
}

async function showShop(
  runtime: EconomyRuntime,
  interaction: ChatInputCommandInteraction
) {
  const items = await listShopItems(runtime.guildId);
  const requestedPage = interaction.options.getInteger("страница") ?? 1;
  const pages = Math.max(1, Math.ceil(items.length / 25));
  const page = Math.min(Math.max(requestedPage, 1), pages);
  const visible = items.slice((page - 1) * 25, page * 25);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🛒 Магазин NetroxBot")
    .setDescription(
      visible.length === 0
        ? "В магазине пока нет активных предметов."
        : visible
            .map(
              (item) =>
                "**" +
                item.name +
                "** • " +
                rarityLabel(item.rarity) +
                "\n" +
                nec(item.price) +
                (item.stock === null
                  ? ""
                  : " • осталось " + item.stock) +
                (item.description
                  ? "\n" + item.description
                  : "")
            )
            .join("\n\n")
    )
    .setFooter({
      text: "Страница " + page + "/" + pages + " • покупка выдаёт отдельный серийный экземпляр"
    });

  if (visible.length === 0) {
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("economy:shop:" + interaction.user.id)
    .setPlaceholder("Купить предмет")
    .addOptions(
      visible.map((item) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(item.name.slice(0, 100))
          .setDescription(
            (rarityLabel(item.rarity) +
              " • " +
              item.price.toLocaleString("ru-RU") +
              " NEC").slice(0, 100)
          )
          .setValue(item.id)
      )
    );

  await interaction.reply({
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
    ],
    flags: MessageFlags.Ephemeral
  });
}

async function handleCommand(
  runtime: EconomyRuntime,
  interaction: ChatInputCommandInteraction
) {
  if (!economyCommandNames.has(interaction.commandName)) {
    return false;
  }

  const config = await getEconomySettings(runtime.guildId);

  if (
    !config.enabled &&
    interaction.commandName !== "economyadmin"
  ) {
    await interaction.reply({
      content: "Экономика NetCoin сейчас отключена.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  try {
    if (interaction.commandName === "balance") {
      const target =
        interaction.options.getUser("пользователь") ?? interaction.user;
      const account = await getEconomyAccount(
        runtime.guildId,
        target.id
      );

      await interaction.reply({
        embeds: [
          balanceEmbed(
            target.id === interaction.user.id
              ? "Твой баланс"
              : "Баланс <@" + target.id + ">",
            account
          )
        ]
      });
      return true;
    }

    if (interaction.commandName === "bank") {
      const action = interaction.options.getSubcommand();
      const amount = BigInt(
        interaction.options.getInteger("сумма", true)
      );

      const account = await moveBetweenWalletAndBank({
        guildId: runtime.guildId,
        userId: interaction.user.id,
        amount,
        direction:
          action === "deposit" ? "DEPOSIT" : "WITHDRAW"
      });

      await interaction.reply({
        embeds: [balanceEmbed("Операция выполнена", account)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "pay") {
      const target = interaction.options.getUser(
        "пользователь",
        true
      );
      const amount = BigInt(
        interaction.options.getInteger("сумма", true)
      );
      const feePercent = Math.max(
        0,
        Math.min(
          numberSetting(
            config.settings,
            "transferFeePercent",
            2
          ),
          100
        )
      );

      const result = await transferWallet({
        guildId: runtime.guildId,
        fromUserId: interaction.user.id,
        toUserId: target.id,
        amount,
        feeBps: Math.round(feePercent * 100)
      });

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle("💸 Перевод выполнен")
            .setDescription(
              "Отправлено <@" +
                target.id +
                ">: **" +
                nec(result.amount) +
                "**"
            )
            .addFields({
              name: "Комиссия",
              value: nec(result.fee),
              inline: true
            })
        ]
      });
      return true;
    }

    if (interaction.commandName === "daily") {
      const amount = BigInt(
        Math.max(
          0,
          Math.trunc(
            numberSetting(config.settings, "dailyReward", 150)
          )
        )
      );
      const hours = Math.max(
        1,
        Math.trunc(
          numberSetting(
            config.settings,
            "dailyCooldownHours",
            24
          )
        )
      );

      const account = await claimDailyReward({
        guildId: runtime.guildId,
        userId: interaction.user.id,
        amount,
        cooldownHours: hours
      });

      await interaction.reply({
        content:
          "Ежедневная награда: **" +
          nec(amount) +
          "**. В кошельке теперь **" +
          nec(account.wallet) +
          "**."
      });
      return true;
    }

    if (interaction.commandName === "work") {
      const min = Math.max(
        0,
        Math.trunc(
          numberSetting(config.settings, "workRewardMin", 25)
        )
      );
      const max = Math.max(
        min,
        Math.trunc(
          numberSetting(config.settings, "workRewardMax", 80)
        )
      );
      const reward =
        min + Math.floor(Math.random() * (max - min + 1));
      const cooldown = Math.max(
        1,
        Math.trunc(
          numberSetting(
            config.settings,
            "workCooldownMinutes",
            60
          )
        )
      );

      const account = await claimWorkReward({
        guildId: runtime.guildId,
        userId: interaction.user.id,
        amount: BigInt(reward),
        cooldownMinutes: cooldown
      });

      await interaction.reply({
        content:
          "За работу начислено **" +
          nec(BigInt(reward)) +
          "**. В кошельке **" +
          nec(account.wallet) +
          "**."
      });
      return true;
    }

    if (interaction.commandName === "shop") {
      await showShop(runtime, interaction);
      return true;
    }

    if (interaction.commandName === "inventory") {
      const target =
        interaction.options.getUser("пользователь") ?? interaction.user;
      const items = await listInventory(
        runtime.guildId,
        target.id,
        50
      );

      const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("🎒 Инвентарь")
        .setDescription(
          items.length === 0
            ? "Инвентарь пуст."
            : items
                .map(
                  (entry) =>
                    "• **" +
                    entry.item.name +
                    "** #" +
                    entry.serialNumber +
                    " • " +
                    rarityLabel(entry.item.rarity) +
                    "\n  ID: `" +
                    entry.id +
                    "`"
                )
                .join("\n")
        )
        .setFooter({
          text:
            target.id === interaction.user.id
              ? "Твой инвентарь"
              : "Инвентарь " + target.username
        });

      await interaction.reply({ embeds: [embed] });
      return true;
    }

    if (interaction.commandName === "gift") {
      const target = interaction.options.getUser(
        "пользователь",
        true
      );
      const instanceId = interaction.options.getString("id", true);

      const item = await giftItem({
        guildId: runtime.guildId,
        fromUserId: interaction.user.id,
        toUserId: target.id,
        instanceId
      });

      await interaction.reply({
        content:
          "🎁 **" +
          item.item.name +
          " #" +
          item.serialNumber +
          "** подарен <@" +
          target.id +
          ">."
      });
      return true;
    }

    if (interaction.commandName === "loan") {
      if (
        !booleanSetting(config.settings, "loansEnabled", true)
      ) {
        throw new EconomyError(
          "LOANS_DISABLED",
          "Кредиты отключены в настройках."
        );
      }

      const action = interaction.options.getSubcommand();

      if (action === "status") {
        const loan = await getActiveLoan(
          runtime.guildId,
          interaction.user.id
        );

        await interaction.reply({
          content: loan
            ? "Текущий долг: **" +
              nec(loan.balance) +
              "**\nСрок: <t:" +
              Math.floor(loan.dueAt.getTime() / 1000) +
              ":F>"
            : "Активного кредита нет.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const amount = BigInt(
        interaction.options.getInteger("сумма", true)
      );

      if (action === "take") {
        const maxLoan = BigInt(
          Math.max(
            0,
            Math.trunc(
              numberSetting(
                config.settings,
                "maxLoanAmount",
                5000
              )
            )
          )
        );
        const interestPercent = Math.max(
          0,
          Math.min(
            numberSetting(
              config.settings,
              "loanInterestPercent",
              10
            ),
            100
          )
        );
        const dueDays = Math.max(
          1,
          Math.trunc(
            numberSetting(config.settings, "loanDueDays", 14)
          )
        );

        const loan = await takeLoan({
          guildId: runtime.guildId,
          userId: interaction.user.id,
          amount,
          interestBps: Math.round(interestPercent * 100),
          dueDays,
          maxPrincipal: maxLoan
        });

        await interaction.reply({
          content:
            "Кредит выдан: **" +
            nec(loan.principal) +
            "**. К возврату **" +
            nec(loan.balance) +
            "** до <t:" +
            Math.floor(loan.dueAt.getTime() / 1000) +
            ":F>.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const payment = await repayLoan({
        guildId: runtime.guildId,
        userId: interaction.user.id,
        amount
      });

      await interaction.reply({
        content:
          "Платёж принят: **" +
          nec(payment.paid) +
          "**. Осталось **" +
          nec(payment.remaining) +
          "**.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.commandName === "economyadmin") {
      if (!(await canAdminEconomy(interaction))) {
        await interaction.reply({
          content: "У тебя нет доступа к управлению экономикой.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const action = interaction.options.getSubcommand();

      if (action === "grant" || action === "take") {
        const target = interaction.options.getUser(
          "пользователь",
          true
        );
        const amount = BigInt(
          interaction.options.getInteger("сумма", true)
        );
        const reason =
          interaction.options.getString("причина") ??
          "Административная операция";

        const account =
          action === "grant"
            ? await grantWallet({
                guildId: runtime.guildId,
                userId: target.id,
                amount,
                type: "ADMIN_GRANT",
                metadata: {
                  actorId: interaction.user.id,
                  reason
                }
              })
            : await removeWallet({
                guildId: runtime.guildId,
                userId: target.id,
                amount,
                type: "ADMIN_TAKE",
                metadata: {
                  actorId: interaction.user.id,
                  reason
                }
              });

        await interaction.reply({
          content:
            (action === "grant" ? "Выдано " : "Изъято ") +
            "**" +
            nec(amount) +
            "** у <@" +
            target.id +
            ">. Баланс кошелька: **" +
            nec(account.wallet) +
            "**.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (action === "item-create") {
        const role = interaction.options.getRole("роль");
        const imageUrl =
          interaction.options.getString("картинка");

        if (
          imageUrl &&
          !/^https:\/\//i.test(imageUrl)
        ) {
          throw new EconomyError(
            "INVALID_IMAGE_URL",
            "Картинка должна быть HTTPS-ссылкой."
          );
        }

        const item = await createEconomyItem({
          guildId: runtime.guildId,
          sku: interaction.options.getString("sku", true),
          name: interaction.options.getString("название", true),
          description:
            interaction.options.getString("описание"),
          rarity:
            interaction.options.getString("редкость", true),
          itemType: interaction.options.getString("тип", true),
          imageUrl,
          roleId: role?.id ?? null,
          price: BigInt(
            interaction.options.getInteger("цена", true)
          ),
          stock: interaction.options.getInteger("остаток"),
          maxPerUser: interaction.options.getInteger("лимит"),
          createdBy: interaction.user.id
        });

        await interaction.reply({
          content:
            "Предмет **" +
            item.name +
            "** добавлен в магазин. SKU: `" +
            item.sku +
            "`.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
    }

    return true;
  } catch (error) {
    await replyError(interaction, error);
    return true;
  }
}

async function handleShopSelect(
  runtime: EconomyRuntime,
  interaction: StringSelectMenuInteraction
) {
  if (!interaction.customId.startsWith("economy:shop:")) {
    return false;
  }

  const ownerId = interaction.customId.slice(
    "economy:shop:".length
  );

  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Это меню магазина открыто другим пользователем.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const itemId = interaction.values[0];

  if (!itemId) {
    return true;
  }

  try {
    const item = await prisma.economyItemDefinition.findFirst({
      where: {
        id: itemId,
        guildId: runtime.guildId,
        active: true
      }
    });

    if (!item) {
      throw new EconomyError(
        "ITEM_NOT_FOUND",
        "Предмет больше не продаётся."
      );
    }

    if (item.roleId && interaction.guild) {
      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );
      const role = await interaction.guild.roles
        .fetch(item.roleId)
        .catch(() => null);
      const me = interaction.guild.members.me;

      if (!role || role.managed || !me) {
        throw new EconomyError(
          "ROLE_UNAVAILABLE",
          "Роль этого предмета сейчас нельзя выдать."
        );
      }

      if (
        me.roles.highest.comparePositionTo(role) <= 0
      ) {
        throw new EconomyError(
          "ROLE_HIERARCHY",
          "Роль предмета находится выше роли NetroxBot."
        );
      }

      if (member.roles.cache.has(role.id)) {
        throw new EconomyError(
          "ROLE_ALREADY_OWNED",
          "У тебя уже есть эта роль."
        );
      }
    }

    const purchase = await buyShopItem({
      guildId: runtime.guildId,
      userId: interaction.user.id,
      itemId
    });

    if (purchase.instance.item.roleId && interaction.guild) {
      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );
      await member.roles.add(
        purchase.instance.item.roleId,
        "Покупка в магазине NetroxBot"
      );
    }

    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle("✅ Покупка завершена")
      .setDescription(
        "**" +
          purchase.instance.item.name +
          " #" +
          purchase.instance.serialNumber +
          "** добавлен в инвентарь."
      )
      .addFields({
        name: "Остаток в кошельке",
        value: nec(purchase.account.wallet)
      });

    if (purchase.instance.item.imageUrl) {
      embed.setThumbnail(purchase.instance.item.imageUrl);
    }

    await interaction.update({
      embeds: [embed],
      components: []
    });
    return true;
  } catch (error) {
    const text =
      error instanceof EconomyError
        ? cooldownText(error)
        : error instanceof Error
          ? error.message
          : "Не удалось купить предмет.";

    await interaction.reply({
      content: text,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
}

export async function handleEconomyInteraction(
  runtime: EconomyRuntime,
  interaction: Interaction
): Promise<boolean> {
  if (
    interaction.isChatInputCommand() &&
    economyCommandNames.has(interaction.commandName)
  ) {
    return handleCommand(runtime, interaction);
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("economy:shop:")
  ) {
    return handleShopSelect(runtime, interaction);
  }

  return false;
}
