import { randomInt } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction
} from "discord.js";
import {
  EconomyError,
  cancelGameSession,
  createPvpGame,
  createSoloGame,
  joinPvpGame,
  playInstantHouseGame,
  prisma,
  settleHouseGame,
  settlePvpGame,
  updateGameState
} from "@netrox/database";
import type { TradeRuntime } from "./market-actions.js";

const ACCENT = 0x57f287;

type GameSettings = {
  enabled: boolean;
  settings: Record<string, unknown>;
};

type TicTacToeState = {
  board: string[];
  turn: string;
};

type MathState = {
  expression: string;
  answer: number;
};

type BlackjackState = {
  deck: string[];
  player: string[];
  dealer: string[];
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

async function getGameSettings(guildId: string): Promise<GameSettings> {
  const row = await prisma.moduleConfig.findUnique({
    where: {
      guildId_moduleKey: {
        guildId,
        moduleKey: "games"
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

function toBps(percent: number) {
  return Math.max(0, Math.round(percent * 100));
}

function assertBet(
  settings: Record<string, unknown>,
  stake: bigint,
  allowZero: boolean
) {
  const wagers = booleanSetting(settings, "wagers", true);

  if (!wagers && stake > 0n) {
    throw new EconomyError(
      "WAGERS_DISABLED",
      "Ставки NEC в мини-играх сейчас отключены."
    );
  }

  if (stake === 0n && allowZero) {
    return;
  }

  const minBet = BigInt(
    Math.max(
      0,
      Math.trunc(numberSetting(settings, "minBet", 1))
    )
  );
  const maxBet = BigInt(
    Math.max(
      0,
      Math.trunc(numberSetting(settings, "maxBet", 10000))
    )
  );

  if (stake < minBet || stake > maxBet) {
    throw new EconomyError(
      "BET_LIMIT",
      "Допустимая ставка: от " +
        nec(minBet) +
        " до " +
        nec(maxBet) +
        "."
    );
  }
}

function gameFeeBps(settings: Record<string, unknown>) {
  return Math.max(
    0,
    Math.min(
      10000,
      toBps(numberSetting(settings, "gameFeePercent", 2))
    )
  );
}

function timeoutSeconds(settings: Record<string, unknown>) {
  return (
    Math.max(
      1,
      Math.trunc(
        numberSetting(settings, "sessionTimeoutMinutes", 10)
      )
    ) * 60
  );
}

function challengeRows(sessionId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("game:accept:" + sessionId)
        .setLabel("Принять")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("game:decline:" + sessionId)
        .setLabel("Отклонить")
        .setEmoji("✖️")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function gameTitle(type: string) {
  if (type === "DICE") return "🎲 Кости";
  if (type === "TICTACTOE") return "❎ Крестики-нолики";
  if (type === "MATH") return "🧮 Математическая дуэль";
  if (type === "BLACKJACK") return "🃏 Blackjack";
  if (type === "GUESS") return "🔢 Угадай число";
  return "🎮 Мини-игра";
}

function makeMathProblem(): MathState {
  const a = randomInt(2, 31);
  const b = randomInt(2, 21);
  const operation = randomInt(0, 3);

  if (operation === 0) {
    return {
      expression: a + " + " + b,
      answer: a + b
    };
  }

  if (operation === 1) {
    const high = Math.max(a, b);
    const low = Math.min(a, b);
    return {
      expression: high + " - " + low,
      answer: high - low
    };
  }

  return {
    expression: a + " × " + b,
    answer: a * b
  };
}

function parseTtt(value: unknown): TicTacToeState {
  const data = record(value);
  const board = Array.isArray(data.board)
    ? data.board.map((cell) =>
        cell === "X" || cell === "O" ? cell : ""
      )
    : Array(9).fill("");
  const turn = typeof data.turn === "string" ? data.turn : "";

  while (board.length < 9) board.push("");

  return {
    board: board.slice(0, 9),
    turn
  };
}

function tttWinner(board: string[]) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];

  for (const [a, b, c] of lines) {
    if (
      a !== undefined &&
      b !== undefined &&
      c !== undefined &&
      board[a] &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return board[a];
    }
  }

  return null;
}

function tttRows(sessionId: string, board: string[], disabled = false) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let row = 0; row < 3; row += 1) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();

    for (let column = 0; column < 3; column += 1) {
      const index = row * 3 + column;
      const value = board[index] ?? "";

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(
            "game:ttt:" + sessionId + ":" + index
          )
          .setLabel(value || "·")
          .setStyle(
            value === "X"
              ? ButtonStyle.Primary
              : value === "O"
                ? ButtonStyle.Danger
                : ButtonStyle.Secondary
          )
          .setDisabled(disabled || Boolean(value))
      );
    }

    rows.push(actionRow);
  }

  return rows;
}

function parseMath(value: unknown): MathState {
  const data = record(value);
  return {
    expression:
      typeof data.expression === "string"
        ? data.expression
        : "0 + 0",
    answer:
      typeof data.answer === "number" &&
      Number.isFinite(data.answer)
        ? data.answer
        : 0
  };
}

const ranks = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
];
const suits = ["♠", "♥", "♦", "♣"];

function makeDeck() {
  const deck: string[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(rank + suit);
    }
  }

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    const value = deck[i];
    deck[i] = deck[j] ?? deck[i] ?? "";
    deck[j] = value ?? deck[j] ?? "";
  }

  return deck;
}

function cardRank(card: string) {
  return card.slice(0, -1);
}

function handValue(hand: string[]) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    const rank = cardRank(card);

    if (rank === "A") {
      total += 11;
      aces += 1;
    } else if (["J", "Q", "K"].includes(rank)) {
      total += 10;
    } else {
      total += Number(rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function parseBlackjack(value: unknown): BlackjackState {
  const data = record(value);
  const strings = (key: string) =>
    Array.isArray(data[key])
      ? (data[key] as unknown[]).filter(
          (item): item is string => typeof item === "string"
        )
      : [];

  return {
    deck: strings("deck"),
    player: strings("player"),
    dealer: strings("dealer")
  };
}

function blackjackEmbed(
  state: BlackjackState,
  stake: bigint,
  hideDealer = true,
  note?: string
) {
  const dealerCards =
    hideDealer && state.dealer.length > 1
      ? [state.dealer[0] ?? "?", "🂠"]
      : state.dealer;
  const dealerValue = hideDealer
    ? "?"
    : String(handValue(state.dealer));

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🃏 Blackjack")
    .addFields(
      {
        name: "Твои карты",
        value:
          state.player.join(" ") +
          "\nСумма: **" +
          handValue(state.player) +
          "**"
      },
      {
        name: "Дилер",
        value:
          dealerCards.join(" ") +
          "\nСумма: **" +
          dealerValue +
          "**"
      },
      {
        name: "Ставка",
        value: nec(stake)
      }
    );

  if (note) embed.setDescription(note);

  return embed;
}

function blackjackRows(sessionId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("game:blackjack-hit:" + sessionId)
        .setLabel("Ещё карту")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("game:blackjack-stand:" + sessionId)
        .setLabel("Хватит")
        .setEmoji("✋")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function createChallenge(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction,
  type: "DICE" | "TICTACTOE" | "MATH",
  stake: bigint,
  opponentId: string,
  settings: Record<string, unknown>
) {
  if (opponentId === interaction.user.id) {
    throw new EconomyError(
      "SELF_GAME",
      "Нельзя бросить вызов самому себе."
    );
  }

  assertBet(settings, stake, true);

  const state =
    type === "TICTACTOE"
      ? {
          board: Array(9).fill(""),
          turn: interaction.user.id
        }
      : type === "MATH"
        ? makeMathProblem()
        : {};

  const session = await createPvpGame({
    guildId: runtime.guildId,
    requestId: interaction.id,
    gameType: type,
    hostId: interaction.user.id,
    opponentId,
    channelId: interaction.channelId,
    stake,
    feeBps: gameFeeBps(settings),
    state,
    ttlSeconds: timeoutSeconds(settings)
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(gameTitle(type))
        .setDescription(
          "<@" +
            opponentId +
            ">, тебе бросил вызов <@" +
            interaction.user.id +
            ">."
        )
        .addFields({
          name: "Ставка каждого",
          value: nec(stake)
        })
        .setFooter({
          text: "Ставка создателя уже находится в escrow."
        })
    ],
    components: challengeRows(session.id)
  });

  const message = await interaction.fetchReply().catch(() => null);

  if (message) {
    await prisma.economyGameSession.updateMany({
      where: {
        id: session.id,
        messageId: null
      },
      data: {
        messageId: message.id,
        channelId: message.channelId
      }
    });
  }
}

async function handleDiceAccept(
  interaction: ButtonInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (!session || session.gameType !== "DICE") {
    throw new EconomyError("GAME_NOT_FOUND", "Матч не найден.");
  }

  if (
    session.opponentId &&
    session.opponentId !== interaction.user.id
  ) {
    throw new EconomyError(
      "GAME_RESERVED",
      "Этот вызов предназначен другому участнику."
    );
  }

  const active = await joinPvpGame({
    guildId: session.guildId,
    sessionId,
    userId: interaction.user.id
  });

  const hostRoll = randomInt(1, 7);
  const opponentRoll = randomInt(1, 7);
  const winnerId =
    hostRoll === opponentRoll
      ? null
      : hostRoll > opponentRoll
        ? active.hostId
        : interaction.user.id;

  await settlePvpGame({
    guildId: session.guildId,
    sessionId,
    winnerId,
    reason: "dice"
  });

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("🎲 Кости — результат")
        .setDescription(
          "<@" +
            active.hostId +
            "> выбросил **" +
            hostRoll +
            "**\n<@" +
            interaction.user.id +
            "> выбросил **" +
            opponentRoll +
            "**\n\n" +
            (winnerId
              ? "Победитель: <@" + winnerId + ">."
              : "Ничья — ставки возвращены.")
        )
    ],
    components: []
  });
}

async function handleTttAccept(
  interaction: ButtonInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (!session || session.gameType !== "TICTACTOE") {
    throw new EconomyError("GAME_NOT_FOUND", "Матч не найден.");
  }

  if (
    session.opponentId &&
    session.opponentId !== interaction.user.id
  ) {
    throw new EconomyError(
      "GAME_RESERVED",
      "Этот вызов предназначен другому участнику."
    );
  }

  const active = await joinPvpGame({
    guildId: session.guildId,
    sessionId,
    userId: interaction.user.id
  });
  const state = parseTtt(active.state);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("❎ Крестики-нолики")
        .setDescription(
          "<@" +
            active.hostId +
            "> играет **X**, <@" +
            interaction.user.id +
            "> играет **O**.\nХод: <@" +
            state.turn +
            ">."
        )
        .addFields({
          name: "Ставка каждого",
          value: nec(active.stake)
        })
    ],
    components: tttRows(active.id, state.board)
  });
}

async function handleMathAccept(
  interaction: ButtonInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (!session || session.gameType !== "MATH") {
    throw new EconomyError("GAME_NOT_FOUND", "Матч не найден.");
  }

  if (
    session.opponentId &&
    session.opponentId !== interaction.user.id
  ) {
    throw new EconomyError(
      "GAME_RESERVED",
      "Этот вызов предназначен другому участнику."
    );
  }

  const active = await joinPvpGame({
    guildId: session.guildId,
    sessionId,
    userId: interaction.user.id
  });
  const state = parseMath(active.state);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("🧮 Математическая дуэль")
        .setDescription(
          "Кто первым введёт правильный ответ, тот выигрывает.\n\n**" +
            state.expression +
            " = ?**"
        )
        .addFields({
          name: "Ставка каждого",
          value: nec(active.stake)
        })
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("game:math-answer:" + active.id)
          .setLabel("Ответить")
          .setEmoji("✍️")
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
}

async function handleChallengeAccept(
  interaction: ButtonInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) {
    throw new EconomyError("GAME_NOT_FOUND", "Матч не найден.");
  }

  if (session.gameType === "DICE") {
    await handleDiceAccept(interaction, sessionId);
    return;
  }
  if (session.gameType === "TICTACTOE") {
    await handleTttAccept(interaction, sessionId);
    return;
  }
  if (session.gameType === "MATH") {
    await handleMathAccept(interaction, sessionId);
    return;
  }

  throw new EconomyError(
    "GAME_TYPE_UNSUPPORTED",
    "Этот тип вызова не поддерживает кнопку принятия."
  );
}

async function handleChallengeDecline(
  interaction: ButtonInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) {
    throw new EconomyError("GAME_NOT_FOUND", "Матч не найден.");
  }

  const allowed =
    interaction.user.id === session.hostId ||
    interaction.user.id === session.opponentId;

  if (!allowed) {
    throw new EconomyError(
      "GAME_FORBIDDEN",
      "Этот вызов создан не для тебя."
    );
  }

  await cancelGameSession({
    guildId: session.guildId,
    sessionId,
    actorId: interaction.user.id
  });

  await interaction.update({
    content: "Вызов отменён. Удержанные NEC возвращены.",
    embeds: [],
    components: []
  });
}

async function handleTttCell(
  interaction: ButtonInteraction,
  sessionId: string,
  cell: number
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (
    !session ||
    session.gameType !== "TICTACTOE" ||
    session.status !== "ACTIVE"
  ) {
    throw new EconomyError(
      "GAME_NOT_ACTIVE",
      "Этот матч уже завершён."
    );
  }

  if (
    interaction.user.id !== session.hostId &&
    interaction.user.id !== session.opponentId
  ) {
    throw new EconomyError(
      "GAME_FORBIDDEN",
      "Ты не участвуешь в этом матче."
    );
  }

  const state = parseTtt(session.state);

  if (state.turn !== interaction.user.id) {
    throw new EconomyError(
      "NOT_YOUR_TURN",
      "Сейчас ход другого игрока."
    );
  }

  if (cell < 0 || cell > 8 || state.board[cell]) {
    throw new EconomyError(
      "CELL_UNAVAILABLE",
      "Эта клетка уже занята."
    );
  }

  const symbol =
    interaction.user.id === session.hostId ? "X" : "O";
  state.board[cell] = symbol;

  const symbolWinner = tttWinner(state.board);
  const draw =
    !symbolWinner && state.board.every((value) => Boolean(value));

  if (!symbolWinner && !draw) {
    const next =
      interaction.user.id === session.hostId
        ? session.opponentId
        : session.hostId;

    if (!next) {
      throw new EconomyError(
        "GAME_STATE_INVALID",
        "У матча отсутствует второй участник."
      );
    }

    state.turn = next;

    const updated = await updateGameState({
      guildId: session.guildId,
      sessionId,
      actorId: interaction.user.id,
      expectedVersion: session.version,
      state
    });

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle("❎ Крестики-нолики")
          .setDescription("Ход: <@" + state.turn + ">.")
          .addFields({
            name: "Ставка каждого",
            value: nec(updated.stake)
          })
      ],
      components: tttRows(session.id, state.board)
    });
    return;
  }

  await updateGameState({
    guildId: session.guildId,
    sessionId,
    actorId: interaction.user.id,
    expectedVersion: session.version,
    state
  });

  const winnerId = symbolWinner
    ? symbolWinner === "X"
      ? session.hostId
      : session.opponentId
    : null;

  await settlePvpGame({
    guildId: session.guildId,
    sessionId,
    winnerId,
    reason: "tictactoe"
  });

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("❎ Крестики-нолики — результат")
        .setDescription(
          winnerId
            ? "Победитель: <@" + winnerId + ">."
            : "Ничья — ставки возвращены."
        )
    ],
    components: tttRows(session.id, state.board, true)
  });
}

async function openMathModal(
  interaction: ButtonInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (
    !session ||
    session.gameType !== "MATH" ||
    session.status !== "ACTIVE"
  ) {
    throw new EconomyError(
      "GAME_NOT_ACTIVE",
      "Эта дуэль уже завершена."
    );
  }

  if (
    interaction.user.id !== session.hostId &&
    interaction.user.id !== session.opponentId
  ) {
    throw new EconomyError(
      "GAME_FORBIDDEN",
      "Ты не участвуешь в этой дуэли."
    );
  }

  const state = parseMath(session.state);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId("game:math-modal:" + session.id)
      .setTitle("Реши: " + state.expression)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("answer")
            .setLabel("Ответ")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20)
        )
      )
  );
}

async function handleMathModal(
  interaction: ModalSubmitInteraction,
  sessionId: string
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (
    !session ||
    session.gameType !== "MATH" ||
    session.status !== "ACTIVE"
  ) {
    throw new EconomyError(
      "GAME_NOT_ACTIVE",
      "Эта дуэль уже завершена."
    );
  }

  if (
    interaction.user.id !== session.hostId &&
    interaction.user.id !== session.opponentId
  ) {
    throw new EconomyError(
      "GAME_FORBIDDEN",
      "Ты не участвуешь в этой дуэли."
    );
  }

  const state = parseMath(session.state);
  const answer = Number(
    interaction.fields.getTextInputValue("answer").trim()
  );

  if (!Number.isFinite(answer) || answer !== state.answer) {
    await interaction.reply({
      content: "❌ Неверно. Можно попробовать ещё раз.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await settlePvpGame({
    guildId: session.guildId,
    sessionId,
    winnerId: interaction.user.id,
    reason: "math"
  });

  await interaction.reply({
    content:
      "✅ Правильно. Ты выиграл математическую дуэль и банк матча.",
    flags: MessageFlags.Ephemeral
  });

  if (session.channelId && session.messageId) {
    const channel = await interaction.client.channels
      .fetch(session.channelId)
      .catch(() => null);

    if (channel?.isTextBased() && "messages" in channel) {
      const message = await channel.messages
        .fetch(session.messageId)
        .catch(() => null);

      await message
        ?.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(ACCENT)
              .setTitle("🧮 Математическая дуэль — результат")
              .setDescription(
                "**" +
                  state.expression +
                  " = " +
                  state.answer +
                  "**\n\nПобедитель: <@" +
                  interaction.user.id +
                  ">."
              )
          ],
          components: []
        })
        .catch(() => undefined);
    }
  }
}

function drawCard(state: BlackjackState) {
  const card = state.deck.pop();

  if (!card) {
    throw new EconomyError(
      "DECK_EMPTY",
      "Колода неожиданно закончилась."
    );
  }

  return card;
}

async function settleBlackjack(
  interaction: ButtonInteraction,
  session: Awaited<
    ReturnType<typeof prisma.economyGameSession.findUnique>
  >,
  state: BlackjackState,
  settings: Record<string, unknown>
) {
  if (!session) {
    throw new EconomyError("GAME_NOT_FOUND", "Игра не найдена.");
  }

  while (handValue(state.dealer) < 17) {
    state.dealer.push(drawCard(state));
  }

  const playerValue = handValue(state.player);
  const dealerValue = handValue(state.dealer);
  const playerNatural =
    state.player.length === 2 && playerValue === 21;

  let outcome: "WIN" | "LOSE" | "PUSH";
  let note: string;

  if (playerValue > 21) {
    outcome = "LOSE";
    note = "Перебор. Победил дилер.";
  } else if (dealerValue > 21) {
    outcome = "WIN";
    note = "У дилера перебор. Ты выиграл.";
  } else if (playerValue > dealerValue) {
    outcome = "WIN";
    note = "Ты выиграл.";
  } else if (playerValue < dealerValue) {
    outcome = "LOSE";
    note = "Победил дилер.";
  } else {
    outcome = "PUSH";
    note = "Ничья. Ставка возвращена.";
  }

  const winPercent = playerNatural
    ? numberSetting(
        settings,
        "blackjackNaturalPercent",
        250
      )
    : numberSetting(
        settings,
        "blackjackWinPercent",
        200
      );

  await settleHouseGame({
    guildId: session.guildId,
    sessionId: session.id,
    outcome,
    payoutMultiplierBps: toBps(winPercent),
    allowMintShortfall: booleanSetting(
      settings,
      "casinoMintFallback",
      true
    ),
    finalState: state
  });

  await interaction.update({
    embeds: [
      blackjackEmbed(
        state,
        session.stake,
        false,
        note +
          (outcome === "WIN"
            ? "\nВыплата: **" +
              nec(
                (session.stake * BigInt(toBps(winPercent))) /
                  10000n
              ) +
              "**."
            : "")
      )
    ],
    components: []
  });
}

async function handleBlackjackButton(
  interaction: ButtonInteraction,
  sessionId: string,
  action: "hit" | "stand"
) {
  const session = await prisma.economyGameSession.findUnique({
    where: { id: sessionId }
  });

  if (
    !session ||
    session.gameType !== "BLACKJACK" ||
    session.status !== "ACTIVE"
  ) {
    throw new EconomyError(
      "GAME_NOT_ACTIVE",
      "Эта партия уже завершена."
    );
  }

  if (interaction.user.id !== session.hostId) {
    throw new EconomyError(
      "GAME_FORBIDDEN",
      "Это не твоя партия."
    );
  }

  const config = await getGameSettings(session.guildId);
  const state = parseBlackjack(session.state);

  if (action === "hit") {
    state.player.push(drawCard(state));

    if (handValue(state.player) > 21) {
      await settleBlackjack(
        interaction,
        session,
        state,
        config.settings
      );
      return;
    }

    if (handValue(state.player) === 21) {
      await settleBlackjack(
        interaction,
        session,
        state,
        config.settings
      );
      return;
    }

    await updateGameState({
      guildId: session.guildId,
      sessionId: session.id,
      actorId: interaction.user.id,
      expectedVersion: session.version,
      state
    });

    await interaction.update({
      embeds: [blackjackEmbed(state, session.stake)],
      components: blackjackRows(session.id)
    });
    return;
  }

  await settleBlackjack(
    interaction,
    session,
    state,
    config.settings
  );
}

async function startBlackjack(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction,
  settings: Record<string, unknown>
) {
  if (!booleanSetting(settings, "blackjackEnabled", true)) {
    throw new EconomyError(
      "BLACKJACK_DISABLED",
      "Blackjack отключён в настройках."
    );
  }

  const stake = BigInt(
    interaction.options.getInteger("ставка", true)
  );
  assertBet(settings, stake, false);

  const deck = makeDeck();
  const state: BlackjackState = {
    deck,
    player: [],
    dealer: []
  };
  state.player.push(drawCard(state), drawCard(state));
  state.dealer.push(drawCard(state), drawCard(state));

  const session = await createSoloGame({
    guildId: runtime.guildId,
    requestId: interaction.id,
    gameType: "BLACKJACK",
    userId: interaction.user.id,
    channelId: interaction.channelId,
    stake,
    state,
    ttlSeconds: timeoutSeconds(settings)
  });

  const playerValue = handValue(state.player);
  const dealerValue = handValue(state.dealer);

  if (playerValue === 21 || dealerValue === 21) {
    let outcome: "WIN" | "LOSE" | "PUSH";
    let note: string;

    if (playerValue === 21 && dealerValue === 21) {
      outcome = "PUSH";
      note = "У обоих blackjack. Ставка возвращена.";
    } else if (playerValue === 21) {
      outcome = "WIN";
      note = "Natural blackjack!";
    } else {
      outcome = "LOSE";
      note = "У дилера blackjack.";
    }

    const naturalPercent = numberSetting(
      settings,
      "blackjackNaturalPercent",
      250
    );

    await settleHouseGame({
      guildId: runtime.guildId,
      sessionId: session.id,
      outcome,
      payoutMultiplierBps: toBps(naturalPercent),
      allowMintShortfall: booleanSetting(
        settings,
        "casinoMintFallback",
        true
      ),
      finalState: state
    });

    await interaction.reply({
      embeds: [
        blackjackEmbed(
          state,
          stake,
          false,
          note
        )
      ],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    embeds: [blackjackEmbed(state, stake)],
    components: blackjackRows(session.id),
    flags: MessageFlags.Ephemeral
  });
}

async function playGuess(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction,
  settings: Record<string, unknown>
) {
  if (!booleanSetting(settings, "guessEnabled", true)) {
    throw new EconomyError(
      "GUESS_DISABLED",
      "«Угадай число» отключено в настройках."
    );
  }

  const stake = BigInt(
    interaction.options.getInteger("ставка", true)
  );
  const guess = interaction.options.getInteger("число", true);
  assertBet(settings, stake, false);

  const number = randomInt(1, 21);
  const win = guess === number;
  const multiplier = Math.max(
    1,
    Math.trunc(numberSetting(settings, "guessMultiplier", 18))
  );

  await playInstantHouseGame({
    guildId: runtime.guildId,
    requestId: interaction.id,
    gameType: "GUESS",
    userId: interaction.user.id,
    stake,
    win,
    payoutMultiplierBps: multiplier * 10000,
    allowMintShortfall: booleanSetting(
      settings,
      "casinoMintFallback",
      true
    ),
    state: {
      guess,
      number,
      multiplier
    }
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("🔢 Угадай число")
        .setDescription(
          "Выпало: **" +
            number +
            "**.\n" +
            (win
              ? "Ты угадал. Выплата: **" +
                nec(stake * BigInt(multiplier)) +
                "**."
              : "Не угадал. Ставка уходит в серверную казну.")
        )
    ],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleGameCommand(
  runtime: TradeRuntime,
  interaction: ChatInputCommandInteraction
) {
  if (interaction.commandName !== "game") {
    return false;
  }

  const config = await getGameSettings(runtime.guildId);

  if (!config.enabled) {
    throw new EconomyError(
      "GAMES_DISABLED",
      "Мини-игры сейчас выключены."
    );
  }

  const action = interaction.options.getSubcommand();

  if (action === "guess") {
    await playGuess(runtime, interaction, config.settings);
    return true;
  }

  if (action === "blackjack") {
    await startBlackjack(runtime, interaction, config.settings);
    return true;
  }

  const opponent = interaction.options.getUser(
    "соперник",
    true
  );
  const stake = BigInt(
    interaction.options.getInteger("ставка", true)
  );

  if (opponent.bot) {
    throw new EconomyError(
      "BOT_OPPONENT",
      "Нельзя вызвать бота на PvP-игру."
    );
  }

  if (
    action === "dice" &&
    !booleanSetting(config.settings, "diceEnabled", true)
  ) {
    throw new EconomyError(
      "DICE_DISABLED",
      "Кости отключены в настройках."
    );
  }

  if (
    action === "tictactoe" &&
    !booleanSetting(
      config.settings,
      "ticTacToeEnabled",
      true
    )
  ) {
    throw new EconomyError(
      "TICTACTOE_DISABLED",
      "Крестики-нолики отключены в настройках."
    );
  }

  if (
    action === "math" &&
    !booleanSetting(
      config.settings,
      "mathDuelEnabled",
      true
    )
  ) {
    throw new EconomyError(
      "MATH_DISABLED",
      "Математические дуэли отключены."
    );
  }

  const type =
    action === "dice"
      ? "DICE"
      : action === "tictactoe"
        ? "TICTACTOE"
        : "MATH";

  await createChallenge(
    runtime,
    interaction,
    type,
    stake,
    opponent.id,
    config.settings
  );

  return true;
}

export async function handleGameButton(
  interaction: ButtonInteraction
) {
  if (interaction.customId.startsWith("game:accept:")) {
    await handleChallengeAccept(
      interaction,
      interaction.customId.slice("game:accept:".length)
    );
    return true;
  }

  if (interaction.customId.startsWith("game:decline:")) {
    await handleChallengeDecline(
      interaction,
      interaction.customId.slice("game:decline:".length)
    );
    return true;
  }

  if (interaction.customId.startsWith("game:ttt:")) {
    const rest = interaction.customId.slice("game:ttt:".length);
    const separator = rest.lastIndexOf(":");
    const sessionId = rest.slice(0, separator);
    const cell = Number(rest.slice(separator + 1));

    await handleTttCell(
      interaction,
      sessionId,
      cell
    );
    return true;
  }

  if (interaction.customId.startsWith("game:math-answer:")) {
    await openMathModal(
      interaction,
      interaction.customId.slice(
        "game:math-answer:".length
      )
    );
    return true;
  }

  if (
    interaction.customId.startsWith("game:blackjack-hit:")
  ) {
    await handleBlackjackButton(
      interaction,
      interaction.customId.slice(
        "game:blackjack-hit:".length
      ),
      "hit"
    );
    return true;
  }

  if (
    interaction.customId.startsWith("game:blackjack-stand:")
  ) {
    await handleBlackjackButton(
      interaction,
      interaction.customId.slice(
        "game:blackjack-stand:".length
      ),
      "stand"
    );
    return true;
  }

  return false;
}

export async function handleGameModal(
  interaction: ModalSubmitInteraction
) {
  if (!interaction.customId.startsWith("game:math-modal:")) {
    return false;
  }

  await handleMathModal(
    interaction,
    interaction.customId.slice(
      "game:math-modal:".length
    )
  );
  return true;
}
