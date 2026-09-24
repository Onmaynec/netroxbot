import type { ModuleKey } from "./modules.js";

export type SettingFieldKind =
  | "boolean"
  | "number"
  | "text"
  | "channel"
  | "role"
  | "select";

export type SettingOption = {
  label: string;
  value: string;
};

export type SettingFieldDefinition = {
  key: string;
  label: string;
  description: string;
  kind: SettingFieldKind;
  defaultValue?: string | number | boolean | null;
  min?: number;
  max?: number;
  options?: readonly SettingOption[];
};

export const MODULE_SETTING_FIELDS: Partial<
  Record<ModuleKey, readonly SettingFieldDefinition[]>
> = {
  moderation: [
    {
      key: "moderatorRoleId",
      label: "Роль модератора",
      description: "Роль, которой доступны основные команды модерации.",
      kind: "role"
    },
    {
      key: "logChannelId",
      label: "Канал наказаний",
      description: "Куда отправлять кейсы и действия модераторов.",
      kind: "channel"
    },
    {
      key: "muteRoleId",
      label: "Mute-роль",
      description: "Роль для отдельной команды /mute.",
      kind: "role"
    },
    {
      key: "dmOnAction",
      label: "ЛС при наказании",
      description: "Отправлять пользователю причину и данные наказания.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "warnLimit",
      label: "Лимит предупреждений",
      description: "Количество активных предупреждений до автоматического наказания.",
      kind: "number",
      defaultValue: 3,
      min: 1,
      max: 20
    },
    {
      key: "warnAction",
      label: "Наказание за лимит warn",
      description: "Что сделать после достижения лимита предупреждений.",
      kind: "select",
      defaultValue: "timeout",
      options: [
        { label: "Таймаут", value: "timeout" },
        { label: "Кик", value: "kick" },
        { label: "Бан", value: "ban" }
      ]
    },
    {
      key: "warnTimeoutMinutes",
      label: "Таймаут за лимит warn",
      description: "Длительность автоматического таймаута после лимита предупреждений.",
      kind: "number",
      defaultValue: 60,
      min: 1,
      max: 40320
    }
  ],
  automod: [
    {
      key: "logChannelId",
      label: "Канал автомодерации",
      description: "Куда отправлять срабатывания автомода.",
      kind: "channel"
    },
    {
      key: "exemptRoleId",
      label: "Роль-исключение 1",
      description: "Роль, на которую автомодерация не действует.",
      kind: "role"
    },
    {
      key: "exemptRoleId2",
      label: "Роль-исключение 2",
      description: "Дополнительная роль-исключение.",
      kind: "role"
    },
    {
      key: "exemptRoleId3",
      label: "Роль-исключение 3",
      description: "Дополнительная роль-исключение.",
      kind: "role"
    },
    {
      key: "exemptChannelId",
      label: "Канал-исключение 1",
      description: "Канал, в котором автомодерация не действует.",
      kind: "channel"
    },
    {
      key: "exemptChannelId2",
      label: "Канал-исключение 2",
      description: "Дополнительный канал-исключение.",
      kind: "channel"
    },
    {
      key: "exemptChannelId3",
      label: "Канал-исключение 3",
      description: "Дополнительный канал-исключение.",
      kind: "channel"
    },
    {
      key: "antiSpam",
      label: "Антиспам",
      description: "Ограничивать слишком частые сообщения.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "antiFlood",
      label: "Антифлуд",
      description: "Ограничивать повторяющиеся сообщения и символы.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "antiCaps",
      label: "Антикапс",
      description: "Фильтровать чрезмерное использование заглавных букв.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "antiProfanity",
      label: "Антимат",
      description: "Фильтровать запрещённую лексику по встроенному и пользовательскому словарю.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "customBlockedWords",
      label: "Дополнительные запрещённые слова",
      description: "Слова или фразы через запятую.",
      kind: "text",
      defaultValue: ""
    },
    {
      key: "antiLinks",
      label: "Ссылки",
      description: "Фильтровать запрещённые внешние ссылки.",
      kind: "boolean",
      defaultValue: false
    },
    {
      key: "antiInvites",
      label: "Discord-приглашения",
      description: "Фильтровать приглашения на другие Discord-серверы.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "antiMassMentions",
      label: "Массовые упоминания",
      description: "Останавливать сообщения с чрезмерным количеством упоминаний.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "maxMentions",
      label: "Лимит упоминаний",
      description: "Сколько упоминаний допускается в одном сообщении.",
      kind: "number",
      defaultValue: 6,
      min: 1,
      max: 50
    },
    {
      key: "spamWindowSeconds",
      label: "Окно антиспама",
      description: "Период, за который считается количество сообщений.",
      kind: "number",
      defaultValue: 8,
      min: 2,
      max: 60
    },
    {
      key: "spamMessageLimit",
      label: "Лимит сообщений",
      description: "Сколько сообщений можно отправить в окно антиспама.",
      kind: "number",
      defaultValue: 6,
      min: 2,
      max: 30
    },
    {
      key: "capsPercent",
      label: "Порог капса",
      description: "Процент заглавных букв, после которого срабатывает антикапс.",
      kind: "number",
      defaultValue: 75,
      min: 50,
      max: 100
    },
    {
      key: "action",
      label: "Действие автомода",
      description: "Что делать после срабатывания правила.",
      kind: "select",
      defaultValue: "warn",
      options: [
        { label: "Только удалить сообщение", value: "delete" },
        { label: "Удалить и выдать warn", value: "warn" },
        { label: "Удалить и выдать timeout", value: "timeout" }
      ]
    },
    {
      key: "timeoutMinutes",
      label: "Timeout автомода",
      description: "Длительность timeout при соответствующем действии.",
      kind: "number",
      defaultValue: 10,
      min: 1,
      max: 40320
    },
    {
      key: "deleteMessage",
      label: "Удалять нарушение",
      description: "Удалять сообщение, которое вызвало срабатывание автомода.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  logs: [
    {
      key: "channelId",
      label: "Основной канал логов",
      description: "Fallback-канал, если для категории не выбран отдельный канал.",
      kind: "channel"
    },
    {
      key: "messageChannelId",
      label: "Логи сообщений",
      description: "Удаление и изменение сообщений.",
      kind: "channel"
    },
    {
      key: "memberChannelId",
      label: "Логи участников",
      description: "Входы, выходы, ники и роли участников.",
      kind: "channel"
    },
    {
      key: "voiceChannelId",
      label: "Логи голосовых каналов",
      description: "Входы, выходы и перемещения между войсами.",
      kind: "channel"
    },
    {
      key: "serverChannelId",
      label: "Логи сервера",
      description: "Каналы, роли, приглашения и webhook.",
      kind: "channel"
    },
    {
      key: "moderationChannelId",
      label: "Логи модерации",
      description: "Moderation-кейсы и автомодерация.",
      kind: "channel"
    },
    {
      key: "settingsChannelId",
      label: "Логи настроек",
      description: "Изменения настроек NetroxBot и административного доступа.",
      kind: "channel"
    },
    {
      key: "messageLogs",
      label: "Сообщения",
      description: "Логировать удаление и изменение сообщений.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "memberLogs",
      label: "Участники",
      description: "Логировать входы, выходы, ники и роли.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "voiceLogs",
      label: "Голосовые каналы",
      description: "Логировать входы, выходы и перемещения в голосовых каналах.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "serverLogs",
      label: "Структура сервера",
      description: "Логировать изменения каналов, ролей, приглашений и webhook.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "storeMessageContent",
      label: "Хранить текст сообщений",
      description: "Сохранять старое/удалённое содержимое сообщений в ServerEvent.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  protection: [
    {
      key: "trustedRoleId",
      label: "Доверенная роль",
      description: "Роль, которой разрешены опасные административные действия.",
      kind: "role"
    },
    {
      key: "antiRaid",
      label: "Anti-Raid",
      description: "Включить автоматическую реакцию на массовые входы.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "antiNuke",
      label: "Anti-Nuke",
      description: "Останавливать массовые удаления и опасные изменения.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "newAccountHours",
      label: "Минимальный возраст аккаунта",
      description: "Сколько часов должен существовать Discord-аккаунт.",
      kind: "number",
      defaultValue: 24,
      min: 0,
      max: 8760
    }
  ],
  welcome: [
    {
      key: "welcomeChannelId",
      label: "Канал приветствия",
      description: "Куда отправлять карточку нового участника.",
      kind: "channel"
    },
    {
      key: "goodbyeChannelId",
      label: "Канал прощания",
      description: "Куда отправлять сообщение об уходе.",
      kind: "channel"
    },
    {
      key: "starterRoleId",
      label: "Стартовая роль",
      description: "Роль, выдаваемая после входа или верификации.",
      kind: "role"
    }
  ],
  verification: [
    {
      key: "channelId",
      label: "Канал верификации",
      description: "Канал, где участник проходит проверку.",
      kind: "channel"
    },
    {
      key: "verifiedRoleId",
      label: "Роль после проверки",
      description: "Роль, выдаваемая после успешной верификации.",
      kind: "role"
    },
    {
      key: "captcha",
      label: "Captcha",
      description: "Использовать captcha во время проверки.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  tickets: [
    {
      key: "categoryId",
      label: "Категория тикетов",
      description: "Категория Discord, где создаются тикеты.",
      kind: "channel"
    },
    {
      key: "supportRoleId",
      label: "Роль поддержки",
      description: "Сотрудники, которым видны тикеты.",
      kind: "role"
    },
    {
      key: "transcriptChannelId",
      label: "Архив транскриптов",
      description: "Канал для сохранения закрытых обращений.",
      kind: "channel"
    }
  ],
  applications: [
    {
      key: "reviewChannelId",
      label: "Канал заявок",
      description: "Куда поступают анкеты на рассмотрение.",
      kind: "channel"
    },
    {
      key: "reviewerRoleId",
      label: "Роль проверяющих",
      description: "Кто может принимать и отклонять заявки.",
      kind: "role"
    }
  ],
  role_menu: [
    {
      key: "panelChannelId",
      label: "Канал Role Menu",
      description: "Канал для панелей самостоятельной выдачи ролей.",
      kind: "channel"
    }
  ],
  temp_voice: [
    {
      key: "creatorChannelId",
      label: "Канал создания",
      description: "При входе сюда создаётся личная голосовая комната.",
      kind: "channel"
    },
    {
      key: "categoryId",
      label: "Категория комнат",
      description: "Где создаются временные голосовые комнаты.",
      kind: "channel"
    },
    {
      key: "defaultLimit",
      label: "Лимит по умолчанию",
      description: "Стартовый лимит участников личной комнаты.",
      kind: "number",
      defaultValue: 0,
      min: 0,
      max: 99
    }
  ],
  economy: [
    {
      key: "dailyReward",
      label: "Ежедневная награда",
      description: "Сколько NEC выдавать за /daily.",
      kind: "number",
      defaultValue: 150,
      min: 0,
      max: 10000000
    },
    {
      key: "dailyCooldownHours",
      label: "Кулдаун /daily",
      description: "Через сколько часов можно снова получить ежедневную награду.",
      kind: "number",
      defaultValue: 24,
      min: 1,
      max: 168
    },
    {
      key: "workRewardMin",
      label: "Минимум за работу",
      description: "Минимальная награда команды /work.",
      kind: "number",
      defaultValue: 25,
      min: 0,
      max: 10000000
    },
    {
      key: "workRewardMax",
      label: "Максимум за работу",
      description: "Максимальная награда команды /work.",
      kind: "number",
      defaultValue: 80,
      min: 0,
      max: 10000000
    },
    {
      key: "workCooldownMinutes",
      label: "Кулдаун /work",
      description: "Интервал между работами в минутах.",
      kind: "number",
      defaultValue: 60,
      min: 1,
      max: 10080
    },
    {
      key: "chatReward",
      label: "NEC за активность в чате",
      description: "Награда за сообщение, прошедшее антифарм-проверку.",
      kind: "number",
      defaultValue: 1,
      min: 0,
      max: 10000
    },
    {
      key: "chatRewardCooldownSeconds",
      label: "Антифарм чата",
      description: "Минимальный интервал между начислениями NEC за сообщения.",
      kind: "number",
      defaultValue: 60,
      min: 5,
      max: 3600
    },
    {
      key: "voiceRewardPerMinute",
      label: "NEC за активность в войсе",
      description: "Награда за учитываемый интервал голосовой активности.",
      kind: "number",
      defaultValue: 1,
      min: 0,
      max: 10000
    },
    {
      key: "voiceRewardCooldownSeconds",
      label: "Интервал награды в войсе",
      description: "Как часто начислять NEC активному участнику голосового канала.",
      kind: "number",
      defaultValue: 60,
      min: 30,
      max: 3600
    },
    {
      key: "minimumVoiceMembers",
      label: "Минимум людей в войсе",
      description: "Сколько не-ботов должно быть в канале, чтобы начислялась награда.",
      kind: "number",
      defaultValue: 2,
      min: 1,
      max: 25
    },
    {
      key: "transferFeePercent",
      label: "Комиссия переводов",
      description: "Процент комиссии при переводе NEC другому участнику.",
      kind: "number",
      defaultValue: 2,
      min: 0,
      max: 100
    },
    {
      key: "loansEnabled",
      label: "Кредиты",
      description: "Разрешить банковские кредиты.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "maxLoanAmount",
      label: "Максимальный кредит",
      description: "Максимальная сумма одного кредита в NEC.",
      kind: "number",
      defaultValue: 5000,
      min: 0,
      max: 1000000000
    },
    {
      key: "loanInterestPercent",
      label: "Процент кредита",
      description: "Фиксированный процент, добавляемый к долгу при выдаче кредита.",
      kind: "number",
      defaultValue: 10,
      min: 0,
      max: 100
    },
    {
      key: "loanDueDays",
      label: "Срок кредита",
      description: "Через сколько дней кредит считается просроченным.",
      kind: "number",
      defaultValue: 14,
      min: 1,
      max: 365
    },
    {
      key: "roleSalaryEnabled",
      label: "Зарплаты за роли",
      description: "Разрешить периодические выплаты по настроенным ролям.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "seasonResetBalances",
      label: "Сброс балансов в новом сезоне",
      description: "Сбрасывать кошелёк и банк при активации нового сезона.",
      kind: "boolean",
      defaultValue: false
    }
  ],
  market: [
    {
      key: "channelId",
      label: "Канал рынка",
      description: "Канал торговой площадки и аукционов.",
      kind: "channel"
    },
    {
      key: "autoAuction",
      label: "Серверные аукционы",
      description: "Автоматически запускать серверные аукционы.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "auctionIntervalHours",
      label: "Интервал аукционов",
      description: "Период между автоматическими аукционами в часах.",
      kind: "number",
      defaultValue: 48,
      min: 1,
      max: 720
    }
  ],
  levels: [
    {
      key: "messageXp",
      label: "XP за сообщение",
      description: "Базовый опыт за учитываемое сообщение.",
      kind: "number",
      defaultValue: 10,
      min: 0,
      max: 10000
    },
    {
      key: "voiceXpPerMinute",
      label: "XP за минуту в войсе",
      description: "Опыт за активную минуту в голосовом канале.",
      kind: "number",
      defaultValue: 2,
      min: 0,
      max: 10000
    },
    {
      key: "messageCooldownSeconds",
      label: "Антифарм-кулдаун",
      description: "Минимальный интервал между сообщениями, за которые начисляется XP.",
      kind: "number",
      defaultValue: 45,
      min: 5,
      max: 3600
    }
  ],
  profiles: [
    {
      key: "reputation",
      label: "Репутация",
      description: "Разрешить участникам получать репутацию.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "cosmetics",
      label: "Косметика",
      description: "Фоны, рамки и другие элементы профиля.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  achievements: [
    {
      key: "hiddenAchievements",
      label: "Скрытые достижения",
      description: "Использовать достижения без заранее видимых условий.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "rewards",
      label: "Награды",
      description: "Выдавать NEC или предметы за достижения.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  statistics: [
    {
      key: "channelId",
      label: "Канал статистики",
      description: "Основной канал для серверной статистики.",
      kind: "channel"
    },
    {
      key: "counterChannels",
      label: "Каналы-счётчики",
      description: "Автоматически обновлять каналы «Участники: 1532» и похожие.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  music: [
    {
      key: "djRoleId",
      label: "DJ-роль",
      description: "Роль с расширенным управлением музыкой и принудительным skip.",
      kind: "role"
    },
    {
      key: "defaultVolume",
      label: "Громкость по умолчанию",
      description: "Стартовая громкость нового плеера.",
      kind: "number",
      defaultValue: 50,
      min: 1,
      max: 100
    },
    {
      key: "defaultSearchSource",
      label: "Источник поиска",
      description: "Где искать трек, если пользователь указал название, а не ссылку.",
      kind: "select",
      defaultValue: "youtube_music",
      options: [
        { label: "YouTube Music", value: "youtube_music" },
        { label: "YouTube", value: "youtube" },
        { label: "SoundCloud", value: "soundcloud" },
        { label: "Spotify", value: "spotify" },
        { label: "Яндекс Музыка", value: "yandex_music" }
      ]
    },
    {
      key: "autoplay",
      label: "Autoplay",
      description: "Продолжать подбор похожей музыки после окончания очереди.",
      kind: "boolean",
      defaultValue: false
    },
    {
      key: "voteSkipEnabled",
      label: "Vote Skip",
      description: "Для обычных участников использовать голосование вместо мгновенного skip.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "voteSkipPercent",
      label: "Процент голосов для skip",
      description: "Какая доля слушателей должна проголосовать за пропуск трека.",
      kind: "number",
      defaultValue: 50,
      min: 10,
      max: 100
    },
    {
      key: "leaveWhenEmpty",
      label: "Выход из пустого войса",
      description: "Отключаться, когда в голосовом канале никого не осталось.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "emptyTimeoutSeconds",
      label: "Таймер пустого войса",
      description: "Через сколько секунд покинуть пустой голосовой канал.",
      kind: "number",
      defaultValue: 120,
      min: 15,
      max: 3600
    },
    {
      key: "allow247",
      label: "Режим 24/7",
      description: "Разрешить закреплять плеер в голосовом канале после окончания очереди.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "maxQueueSize",
      label: "Максимальная очередь",
      description: "Максимум треков в очереди одного плеера.",
      kind: "number",
      defaultValue: 500,
      min: 10,
      max: 5000
    },
    {
      key: "userPlaylists",
      label: "Плейлисты пользователей",
      description: "Разрешить сохранять собственные плейлисты.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "favorites",
      label: "Избранное",
      description: "Разрешить сохранять треки в избранное.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "history",
      label: "История прослушивания",
      description: "Хранить историю прослушанных пользователем треков.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  games: [
    {
      key: "wagers",
      label: "Ставки NEC",
      description: "Разрешить ставки между игроками в мини-играх.",
      kind: "boolean",
      defaultValue: true
    },
    {
      key: "maxBet",
      label: "Максимальная ставка",
      description: "Максимальная ставка NEC в одной игре.",
      kind: "number",
      defaultValue: 10000,
      min: 0,
      max: 1000000000
    }
  ],
  giveaways: [
    {
      key: "channelId",
      label: "Канал розыгрышей",
      description: "Канал для серверных розыгрышей.",
      kind: "channel"
    },
    {
      key: "minimumLevel",
      label: "Минимальный уровень",
      description: "Базовое ограничение уровня для участия.",
      kind: "number",
      defaultValue: 0,
      min: 0,
      max: 10000
    }
  ],
  events: [
    {
      key: "announcementChannelId",
      label: "Канал событий",
      description: "Куда отправлять анонсы и напоминания.",
      kind: "channel"
    },
    {
      key: "reminderMinutes",
      label: "Напоминание до события",
      description: "За сколько минут отправлять стандартное напоминание.",
      kind: "number",
      defaultValue: 30,
      min: 0,
      max: 10080
    }
  ],
  polls: [
    {
      key: "channelId",
      label: "Канал голосований",
      description: "Основной канал опросов.",
      kind: "channel"
    },
    {
      key: "anonymousAllowed",
      label: "Анонимные голосования",
      description: "Разрешить создание анонимных опросов.",
      kind: "boolean",
      defaultValue: true
    }
  ],
  suggestions: [
    {
      key: "suggestionChannelId",
      label: "Канал предложений",
      description: "Куда участники отправляют предложения.",
      kind: "channel"
    },
    {
      key: "bugChannelId",
      label: "Канал баг-репортов",
      description: "Канал для сообщений об ошибках.",
      kind: "channel"
    },
    {
      key: "reviewRoleId",
      label: "Роль проверяющих",
      description: "Кто может менять статус предложений и баг-репортов.",
      kind: "role"
    }
  ],
  integrations: [
    {
      key: "notificationChannelId",
      label: "Канал уведомлений",
      description: "Канал по умолчанию для внешних уведомлений.",
      kind: "channel"
    }
  ],
  ai: [
    {
      key: "channelId",
      label: "Канал AI",
      description: "Основной канал для общения с локальным ассистентом.",
      kind: "channel"
    },
    {
      key: "model",
      label: "Локальная модель",
      description: "Название модели Ollama.",
      kind: "text"
    },
    {
      key: "moderationAssist",
      label: "Помощь модерации",
      description: "Разрешить AI помогать с разбором спорных сообщений.",
      kind: "boolean",
      defaultValue: false
    },
    {
      key: "summaries",
      label: "Пересказы обсуждений",
      description: "Разрешить краткие пересказы длинных обсуждений.",
      kind: "boolean",
      defaultValue: true
    }
  ]
};

export function getModuleSettingFields(moduleKey: string) {
  return MODULE_SETTING_FIELDS[moduleKey as ModuleKey] ?? [];
}
