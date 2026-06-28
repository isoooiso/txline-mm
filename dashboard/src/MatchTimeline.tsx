import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CSSProperties } from "react";
import { theme } from "./theme";
import type { DashboardPayload } from "./data";
import { key1x2, marketLabel, fmtMatchMin } from "./data";

interface Props {
  data: DashboardPayload;
}

function fairSeries(
  ticks: DashboardPayload["timelines"]["on"],
  marketKey: string,
  outcomes: string[],
) {
  return ticks.map((t) => {
    const row: Record<string, number> = { matchMin: t.matchMin };
    for (const o of outcomes) {
      row[o] = (t.fair[marketKey]?.[o] ?? 0) * 100;
    }
    row.pulled = t.pulled[marketKey] ? 1 : 0;
    row.cumPnl = t.cumPnl;
    row.cumExposure = t.cumExposure;
    return row;
  });
}

function pulledBands(
  ticks: DashboardPayload["timelines"]["on"],
  marketKey: string,
): { x1: number; x2: number }[] {
  const bands: { x1: number; x2: number }[] = [];
  let start: number | null = null;
  for (const t of ticks) {
    if (t.pulled[marketKey]) {
      if (start === null) start = t.matchMin;
    } else if (start !== null) {
      bands.push({ x1: start, x2: t.matchMin });
      start = null;
    }
  }
  if (start !== null && ticks.length > 0) {
    bands.push({ x1: start, x2: ticks[ticks.length - 1]!.matchMin });
  }
  return bands;
}

export function MatchTimeline({ data }: Props) {
  const ticks = data.timelines.on;
  const k1 = key1x2(data);
  const ouKeys = data.meta.marketKeys.filter((k) => k.includes("OVERUNDER"));
  const goals = data.goals;

  const chart1 = fairSeries(ticks, k1, ["part1", "draw", "part2"]);
  const bands = pulledBands(ticks, k1);

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>Match timeline — fair value & risk (protection ON)</h2>
      <p style={subStyle}>Red lines = goals. Gray bands = quotes pulled.</p>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart1} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="matchMin"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 12 }}
              tickFormatter={fmtMatchMin}
              label={{ value: "match min", position: "insideBottom", offset: -4, fill: theme.muted }}
            />
            <YAxis
              yAxisId="fair"
              tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 12 }}
              label={{ value: "fair %", angle: -90, position: "insideLeft", fill: theme.muted }}
            />
            <Tooltip
              contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }}
            />
            {bands.map((b, i) => (
              <ReferenceArea
                key={`band-${i}-${b.x1}`}
                yAxisId="fair"
                x1={b.x1}
                x2={b.x2}
                fill={theme.pulled}
                strokeOpacity={0}
              />
            ))}
            {goals.map((g, i) => (
              <ReferenceLine
                key={`goal-${i}-${g.matchMin}`}
                yAxisId="fair"
                x={g.matchMin}
                stroke={theme.goal}
                strokeWidth={2}
                label={{ value: `G ${g.g1}-${g.g2}`, fill: theme.goal, fontSize: 11 }}
              />
            ))}
            <Line yAxisId="fair" type="monotone" dataKey="part1" stroke="#94a3b8" dot={false} strokeWidth={2} />
            <Line yAxisId="fair" type="monotone" dataKey="draw" stroke="#a78bfa" dot={false} strokeWidth={2} />
            <Line yAxisId="fair" type="monotone" dataKey="part2" stroke={theme.on} dot={false} strokeWidth={2.5} />
            <Legend />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {ouKeys.map((k) => {
        const ouData = fairSeries(ticks, k, ["over", "under"]);
        return (
          <div key={k} style={{ height: 180, marginTop: 24 }}>
            <h3 style={{ ...subStyle, marginBottom: 8 }}>{marketLabel(data, k)}</h3>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ouData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
                <XAxis dataKey="matchMin" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }} tickFormatter={fmtMatchMin} />
                <YAxis yAxisId="fair" tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }} />
                {goals.map((g, i) => (
                  <ReferenceLine
                    key={`goal-${i}-${g.matchMin}`}
                    yAxisId="fair"
                    x={g.matchMin}
                    stroke={theme.goal}
                    strokeWidth={1.5}
                  />
                ))}
                <Line yAxisId="fair" type="monotone" dataKey="over" stroke={theme.on} dot={false} strokeWidth={2} />
                <Line yAxisId="fair" type="monotone" dataKey="under" stroke={theme.off} dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );
      })}

      <div style={{ height: 220, marginTop: 32 }}>
        <h3 style={subStyle}>Cumulative P&L & exposure</h3>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart1} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis dataKey="matchMin" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }} tickFormatter={fmtMatchMin} />
            <YAxis yAxisId="pnl" tick={{ fill: theme.on, fontFamily: theme.mono, fontSize: 11 }} />
            <YAxis yAxisId="exp" orientation="right" tick={{ fill: theme.off, fontFamily: theme.mono, fontSize: 11 }} />
            {goals.map((g, i) => (
              <ReferenceLine
                key={`goal-${i}-${g.matchMin}`}
                yAxisId="pnl"
                x={g.matchMin}
                stroke={theme.goal}
                strokeWidth={1.5}
              />
            ))}
            <Area yAxisId="pnl" type="monotone" dataKey="cumPnl" fill="rgba(45,212,191,0.15)" stroke={theme.on} strokeWidth={2} />
            <Line yAxisId="exp" type="monotone" dataKey="cumExposure" stroke={theme.off} dot={false} strokeWidth={2} strokeDasharray="4 4" />
            <Tooltip contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }} />
            <Legend />
          </ComposedChart>
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
};
