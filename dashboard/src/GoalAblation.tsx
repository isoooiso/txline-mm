import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CSSProperties } from "react";
import { theme } from "./theme";
import type { DashboardPayload, DashboardTick } from "./data";
import { fmtMatchMin } from "./data";

interface Props {
  data: DashboardPayload;
}

type Goal = DashboardPayload["goals"][number];

function avgExposureGapInCooldown(
  goal: Goal,
  offTicks: DashboardTick[],
  onTicks: DashboardTick[],
  cooldownMin: number,
): number {
  const lo = goal.matchMin;
  const hi = goal.matchMin + cooldownMin;
  const offIn = offTicks.filter((t) => t.matchMin >= lo && t.matchMin <= hi);
  if (offIn.length === 0) return Number.NEGATIVE_INFINITY;

  let sumOff = 0;
  let sumOn = 0;
  let n = 0;
  for (const o of offIn) {
    const match = onTicks.find((x) => Math.abs(x.matchMin - o.matchMin) < 0.05);
    if (match) {
      sumOff += o.cumExposure;
      sumOn += match.cumExposure;
      n += 1;
    }
  }
  if (n === 0) return Number.NEGATIVE_INFINITY;
  return sumOff / n - sumOn / n;
}

function pickRepresentativeGoal(
  goals: Goal[],
  offTicks: DashboardTick[],
  onTicks: DashboardTick[],
  cooldownMin: number,
): { goal: Goal; avgGap: number; anyPositive: boolean } {
  const scored = goals.map((goal) => ({
    goal,
    avgGap: avgExposureGapInCooldown(goal, offTicks, onTicks, cooldownMin),
  }));
  const positive = scored.filter((s) => s.avgGap > 0);
  const anyPositive = positive.length > 0;
  const pool = anyPositive ? positive : scored;
  const best = pool.reduce((a, b) => (b.avgGap > a.avgGap ? b : a));
  return { goal: best.goal, avgGap: best.avgGap, anyPositive };
}

function mergeTimelines(
  off: DashboardTick[],
  on: DashboardTick[],
): Array<{
  matchMin: number;
  cumPnlOff: number;
  cumPnlOn: number;
  cumExpOff: number;
  cumExpOn: number;
}> {
  return off.map((o) => {
    const match = on.find((x) => Math.abs(x.matchMin - o.matchMin) < 0.05);
    return {
      matchMin: o.matchMin,
      cumPnlOff: o.cumPnl,
      cumPnlOn: match?.cumPnl ?? o.cumPnl,
      cumExpOff: o.cumExposure,
      cumExpOn: match?.cumExposure ?? o.cumExposure,
    };
  });
}

const matchMinTick = { fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 12 };

export function GoalAblation({ data }: Props) {
  const goals = data.goals;
  if (goals.length === 0) {
    return (
      <section style={panelStyle}>
        <h2 style={titleStyle}>Goal ablation</h2>
        <p style={subStyle}>No goals detected in timeline.</p>
      </section>
    );
  }

  const cooldownMin = data.meta.config.protectCooldownMs / 60_000;
  const { goal: selected, avgGap, anyPositive } = pickRepresentativeGoal(
    goals,
    data.timelines.off,
    data.timelines.on,
    cooldownMin,
  );
  const center = selected.matchMin;
  const windowMin = 5;
  const lo = center - windowMin;
  const hi = center + windowMin;

  const off = data.timelines.off.filter((t) => t.matchMin >= lo && t.matchMin <= hi);
  const on = data.timelines.on.filter((t) => t.matchMin >= lo && t.matchMin <= hi);
  const merged = mergeTimelines(off, on);

  const maxExpGap = merged.reduce(
    (best, r) => {
      const gap = r.cumExpOff - r.cumExpOn;
      return gap > best.gap ? { gap, matchMin: r.matchMin } : best;
    },
    { gap: Number.NEGATIVE_INFINITY, matchMin: center },
  );

  const benefitNote = anyPositive
    ? `Cooldown-window avg exposure gap (OFF−ON): ${avgGap.toFixed(2)} — ranked highest among goals.`
    : `No goal showed positive exposure benefit during the protect cooldown (best avg OFF−ON: ${avgGap.toFixed(2)}).`;

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>
        Goal ablation — representative reprice ({selected.g1}-{selected.g2} @ {fmtMatchMin(center)})
      </h2>
      <p style={subStyle}>
        {benefitNote} One representative reprice from the representative seed; per-event effects vary — see
        Distribution for the full {data.meta.config.seedCount}-seed picture. OFF stays quoted and is
        adversely selected; ON pulls quotes for the cooldown. Max exposure gap (OFF−ON) in ±{windowMin}′
        window: {maxExpGap.gap.toFixed(2)} at {fmtMatchMin(maxExpGap.matchMin)}.
      </p>

      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="matchMin"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={matchMinTick}
              tickFormatter={fmtMatchMin}
              label={{ value: "match min", position: "insideBottom", fill: theme.muted }}
            />
            <YAxis tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 12 }} />
            <ReferenceLine
              x={center}
              stroke={theme.goal}
              strokeWidth={2}
              label={{ value: "GOAL", fill: theme.goal }}
            />
            <Tooltip contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }} />
            <Line type="monotone" dataKey="cumExpOff" name="exposure OFF" stroke={theme.off} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="cumExpOn" name="exposure ON" stroke={theme.on} strokeWidth={2.5} dot={false} />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 240, marginTop: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="matchMin"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={matchMinTick}
              tickFormatter={fmtMatchMin}
            />
            <YAxis domain={["auto", "auto"]} tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 12 }} />
            <ReferenceLine x={center} stroke={theme.goal} strokeWidth={2} />
            <Tooltip contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }} />
            <Line type="monotone" dataKey="cumPnlOff" name="P&L OFF" stroke={theme.off} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="cumPnlOn" name="P&L ON" stroke={theme.on} strokeWidth={2.5} dot={false} />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const panelStyle: CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  padding: "24px 28px",
  marginBottom: 24,
};

const titleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontFamily: theme.sans,
  fontSize: 18,
  fontWeight: 600,
  color: theme.text,
};

const subStyle: CSSProperties = {
  margin: "0 0 16px",
  color: theme.muted,
  fontSize: 13,
  lineHeight: 1.5,
};
