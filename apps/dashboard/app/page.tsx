import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default function Home() {
  const apiUrl = (process.env.PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

  return <DashboardClient apiUrl={apiUrl} />;
}
