import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CSSProperties } from "react";
import { theme } from "./theme";
import type { DashboardPayload } from "./data";
import { binValues, fmt } from "./data";

interface Props {
  data: DashboardPayload;
}

function overlayHistogram(
  off: number[],
  on: number[],
  binCount = 20,
): { x: number; off: number; on: number }[] {
  const all = [...off, ...on];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const width = (max - min) / binCount || 1;
  const offCounts = Array(binCount).fill(0);
  const onCounts = Array(binCount).fill(0);
  for (const v of off) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    offCounts[idx]! += 1;
  }
  for (const v of on) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    onCounts[idx]! += 1;
  }
  return offCounts.map((c, i) => ({
    x: min + (i + 0.5) * width,
    off: c,
    on: onCounts[i]!,
  }));
}

export function Distribution({ data }: Props) {
  const ps = data.perSeed;
  const hist = overlayHistogram(ps.realizedPnlOff, ps.realizedPnlOn);
  const deltaHist = binValues(ps.deltaRealizedPnl, 18);
  const offMean =
    ps.realizedPnlOff.reduce((s, v) => s + v, 0) / ps.realizedPnlOff.length;
  const onMean =
    ps.realizedPnlOn.reduce((s, v) => s + v, 0) / ps.realizedPnlOn.length;

  const expBar = [
    { name: "OFF p95", value: data.leftTail.maxExposureP95Off, fill: theme.off },
    { name: "ON p95", value: data.leftTail.maxExposureP95On, fill: theme.on },
  ];

  const d = data.delta.realizedPnl;
  const ci = `${fmt(d.mean)} ± ${fmt(1.96 * d.sem)}`;

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>Distribution — protection ablation ({ps.seeds.length} seeds)</h2>
      <p style={captionStyle}>{data.honestRead}</p>

      <div style={{ height: 280 }}>
        <h3 style={subStyle}>Realized P&L OFF (amber) vs ON (teal)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hist} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }}
              tickFormatter={(v) => fmt(v, 1)}
            />
            <YAxis tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }} />
            <Bar dataKey="off" fill={theme.off} opacity={0.85} name="OFF" />
            <Bar dataKey="on" fill={theme.on} opacity={0.75} name="ON" />
            <ReferenceLine x={offMean} stroke={theme.off} strokeDasharray="6 4" label={{ value: "μ OFF", fill: theme.off, fontSize: 11 }} />
            <ReferenceLine x={onMean} stroke={theme.on} strokeDasharray="6 4" label={{ value: "μ ON", fill: theme.on, fontSize: 11 }} />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 200, marginTop: 24 }}>
        <h3 style={subStyle}>Paired ΔrealizedPnl (ON − OFF) — centered near 0</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={deltaHist} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis dataKey="x" tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }} tickFormatter={(v) => fmt(v, 1)} />
            <YAxis tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 11 }} />
            <ReferenceLine x={0} stroke={theme.muted} />
            <Bar dataKey="count" fill={theme.on} opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 180, marginTop: 24, maxWidth: 420 }}>
        <h3 style={subStyle}>Max exposure p95 — what protection improves</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={expBar} layout="vertical" margin={{ top: 4, right: 24, left: 60, bottom: 4 }}>
            <CartesianGrid stroke={theme.chart.grid} strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fill: theme.chart.axis, fontFamily: theme.mono, fontSize: 12 }} />
            <YAxis type="category" dataKey="name" tick={{ fill: theme.text, fontFamily: theme.mono, fontSize: 12 }} />
            <Tooltip contentStyle={{ background: theme.panel, border: `1px solid ${theme.border}`, fontFamily: theme.mono }} />
            <Bar dataKey="value" name="p95 exposure">
              {expBar.map((e, i) => (
                <Cell key={i} fill={e.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p style={{ fontFamily: theme.mono, fontSize: 12, color: theme.muted, marginTop: 8 }}>
          Δ mean CI: {ci} · wins {(data.delta.fractionOnWins * 100).toFixed(0)}% of seeds
        </p>
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
  margin: "0 0 12px",
  fontFamily: theme.sans,
  fontSize: 18,
  fontWeight: 600,
  color: theme.text,
};

const subStyle: CSSProperties = {
  margin: "0 0 8px",
  color: theme.muted,
  fontSize: 13,
};

const captionStyle: CSSProperties = {
  fontFamily: theme.mono,
  fontSize: 14,
  lineHeight: 1.6,
  color: theme.on,
  borderLeft: `3px solid ${theme.on}`,
  paddingLeft: 14,
  margin: "0 0 24px",
};
