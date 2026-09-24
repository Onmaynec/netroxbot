const sections = [
  "Модерация",
  "Автомодерация",
  "Экономика",
  "Музыка",
  "Уровни и профили",
  "Логи",
  "Тикеты",
  "Заявки",
  "Роли",
  "Голосовые комнаты",
  "События",
  "Интеграции",
  "AI",
  "Безопасность"
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Mothers Fantastic</p>
          <h1>NetroxBot</h1>
          <p className="lead">
            Центр управления сервером. Здесь будут собраны все настройки бота,
            права доступа, статистика и управление модулями.
          </p>
        </div>
        <div className="status">
          <span className="dot" />
          Разработка
        </div>
      </section>

      <section className="grid">
        {sections.map((section) => (
          <article className="card" key={section}>
            <span className="cardIcon">●</span>
            <div>
              <h2>{section}</h2>
              <p>Раздел подготовлен к подключению настроек.</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
