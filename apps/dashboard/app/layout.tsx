import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "NetroxBot — управление",
  description: "Панель управления NetroxBot для Mothers Fantastic"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
