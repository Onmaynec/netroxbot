export const SETTINGS_CATEGORIES = [
  {
    key: "security",
    title: "Безопасность и модерация",
    description: "Модерация, автомодерация, логи и защита сервера.",
    emoji: "🛡️"
  },
  {
    key: "community",
    title: "Сервер и поддержка",
    description: "Приветствия, тикеты, заявки, роли и голосовые комнаты.",
    emoji: "🏠"
  },
  {
    key: "activity",
    title: "Экономика и активность",
    description: "NetCoin, уровни, профили, достижения и статистика.",
    emoji: "🪙"
  },
  {
    key: "events",
    title: "События и развлечения",
    description: "Музыка, розыгрыши, голосования, события и игры.",
    emoji: "🎉"
  },
  {
    key: "services",
    title: "Интеграции и сервисы",
    description: "Уведомления, внешние сервисы и локальный AI.",
    emoji: "🔌"
  }
] as const;

export type SettingsCategoryKey = (typeof SETTINGS_CATEGORIES)[number]["key"];

export type ModuleDefinition = {
  key: string;
  category: SettingsCategoryKey;
  title: string;
  description: string;
  emoji: string;
  defaultEnabled: boolean;
};

export const MODULES = [
  {
    key: "moderation",
    category: "security",
    title: "Модерация",
    description: "Баны, кики, таймауты, предупреждения, кейсы и апелляции.",
    emoji: "🔨",
    defaultEnabled: true
  },
  {
    key: "automod",
    category: "security",
    title: "Автомодерация",
    description: "Спам, флуд, капс, ссылки, приглашения и другие автоматические проверки.",
    emoji: "🤖",
    defaultEnabled: true
  },
  {
    key: "logs",
    category: "security",
    title: "Логи и аудит",
    description: "События сервера, действия администрации и внутренний журнал.",
    emoji: "📋",
    defaultEnabled: true
  },
  {
    key: "protection",
    category: "security",
    title: "Защита сервера",
    description: "Anti-raid, Anti-Nuke, лимиты опасных действий и белые списки.",
    emoji: "🚨",
    defaultEnabled: true
  },
  {
    key: "welcome",
    category: "community",
    title: "Welcome / Goodbye",
    description: "Приветствия, прощания, стартовые роли и оформление.",
    emoji: "👋",
    defaultEnabled: true
  },
  {
    key: "verification",
    category: "community",
    title: "Верификация",
    description: "Доступ после правил, captcha и проверка новых участников.",
    emoji: "✅",
    defaultEnabled: false
  },
  {
    key: "tickets",
    category: "community",
    title: "Тикеты",
    description: "Жалобы, техподдержка, партнёрство, транскрипты и оценки.",
    emoji: "🎫",
    defaultEnabled: true
  },
  {
    key: "applications",
    category: "community",
    title: "Заявки",
    description: "Анкеты на роли персонала, вопросы, решения и архив.",
    emoji: "📝",
    defaultEnabled: true
  },
  {
    key: "role_menu",
    category: "community",
    title: "Role Menu",
    description: "Самостоятельная выдача ролей через кнопки и списки.",
    emoji: "🏷️",
    defaultEnabled: true
  },
  {
    key: "temp_voice",
    category: "community",
    title: "Временные войсы",
    description: "Личные голосовые комнаты и панель их владельца.",
    emoji: "🎙️",
    defaultEnabled: true
  },
  {
    key: "economy",
    category: "activity",
    title: "Экономика NetCoin",
    description: "🪙 NEC, кошелёк, банк, комиссии, кредиты и сезонная экономика.",
    emoji: "💰",
    defaultEnabled: true
  },
  {
    key: "market",
    category: "activity",
    title: "Предметы и рынок",
    description: "Магазин, инвентарь, редкости, торговая площадка и аукционы.",
    emoji: "💎",
    defaultEnabled: true
  },
  {
    key: "levels",
    category: "activity",
    title: "Уровни",
    description: "XP за чат и голос, роли за уровни, streak и защита от фарма.",
    emoji: "📈",
    defaultEnabled: true
  },
  {
    key: "profiles",
    category: "activity",
    title: "Профили",
    description: "Карточка участника, репутация, ссылки, косметика и статистика.",
    emoji: "👤",
    defaultEnabled: true
  },
  {
    key: "achievements",
    category: "activity",
    title: "Достижения",
    description: "Обычные и скрытые достижения с наградами.",
    emoji: "🏆",
    defaultEnabled: true
  },
  {
    key: "statistics",
    category: "activity",
    title: "Статистика",
    description: "Активность сервера, каналов, участников и администрации.",
    emoji: "📊",
    defaultEnabled: true
  },
  {
    key: "music",
    category: "events",
    title: "Музыка",
    description: "Очередь, плейлисты, любимое, DJ, autoplay и 24/7.",
    emoji: "🎵",
    defaultEnabled: true
  },
  {
    key: "games",
    category: "events",
    title: "Мини-игры",
    description: "Крестики-нолики, кости, блэкджек, дуэли, лотереи и другое.",
    emoji: "🎮",
    defaultEnabled: true
  },
  {
    key: "giveaways",
    category: "events",
    title: "Розыгрыши",
    description: "Условия участия, несколько победителей и отложенный запуск.",
    emoji: "🎁",
    defaultEnabled: true
  },
  {
    key: "events",
    category: "events",
    title: "События и расписание",
    description: "Ивенты, турниры, дни рождения, повторяющиеся объявления и пинги.",
    emoji: "📅",
    defaultEnabled: true
  },
  {
    key: "polls",
    category: "events",
    title: "Голосования",
    description: "Обычные и анонимные опросы, ограничения и авто-завершение.",
    emoji: "🗳️",
    defaultEnabled: true
  },
  {
    key: "suggestions",
    category: "events",
    title: "Предложения и баг-репорты",
    description: "Предложения участников, статусы, ответы администрации и отчёты об ошибках.",
    emoji: "💡",
    defaultEnabled: true
  },
  {
    key: "integrations",
    category: "services",
    title: "Интеграции",
    description: "GitHub, YouTube, Twitch, Steam, Minecraft, TikTok, Reddit и RSS.",
    emoji: "🌐",
    defaultEnabled: false
  },
  {
    key: "ai",
    category: "services",
    title: "Локальный AI",
    description: "Ассистент, FAQ, помощь модерации, пересказы и генерация объявлений.",
    emoji: "🧠",
    defaultEnabled: false
  }
] as const satisfies readonly ModuleDefinition[];

export type ModuleKey = (typeof MODULES)[number]["key"];

export function getCategory(key: string) {
  return SETTINGS_CATEGORIES.find((category) => category.key === key);
}

export function getModule(key: string) {
  return MODULES.find((module) => module.key === key);
}

export function getModulesByCategory(category: SettingsCategoryKey) {
  return MODULES.filter((module) => module.category === category);
}
