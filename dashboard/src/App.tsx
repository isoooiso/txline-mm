import { useEffect, useState } from "react";
import { loadDashboard, type DashboardPayload } from "./data";
import { Header } from "./Header";
import { MatchTimeline } from "./MatchTimeline";
import { GoalAblation } from "./GoalAblation";
import { Distribution } from "./Distribution";
import { Methodology } from "./Methodology";
import { theme } from "./theme";

export function App() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard()
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  if (error) {
    return (
      <div style={{ padding: 32, color: theme.goal, fontFamily: theme.mono }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 32, color: theme.muted, fontFamily: theme.mono }}>
        Loading dashboard…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text }}>
      <Header data={data} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        <MatchTimeline data={data} />
        <GoalAblation data={data} />
        <Distribution data={data} />
        <Methodology data={data} />
      </main>
    </div>
  );
}
