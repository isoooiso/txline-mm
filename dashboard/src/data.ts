export interface DashboardTick {
  matchMin: number;
  fair: Record<string, Record<string, number>>;
  pulled: Record<string, boolean>;
  cumPnl: number;
  cumExposure: number;
  g1: number;
  g2: number;
}

export interface DashboardPayload {
  meta: {
    fixtureId: number;
    participant1: string;
    participant2: string;
    finalG1: number;
    finalG2: number;
    network: string;
    bookmaker: string;
    oddsCount: number;
    marketKeys: string[];
    marketLabels: Record<string, string>;
    config: {
      halfSpread: number;
      quoteLatencyMs: number;
      maxOutcomePos: number;
      protectCooldownMs: number;
      repriceJumpThreshold: number;
      takerLambdaPerMin: number;
      takerNoiseSd: number;
      seedCount: number;
    };
  };
  summary: Record<string, unknown>;
  perSeed: {
    seeds: number[];
    realizedPnlOff: number[];
    realizedPnlOn: number[];
    inventoryPnlOff: number[];
    inventoryPnlOn: number[];
    maxExposureOff: number[];
    maxExposureOn: number[];
    deltaRealizedPnl: number[];
  };
  delta: {
    realizedPnl: { mean: number; std: number; sem: number; p5: number; p50: number; p95: number };
    maxExposure: { mean: number; p5: number; p50: number; p95: number };
    fractionOnWins: number;
  };
  leftTail: {
    worstRealizedPnlOff: number;
    worstRealizedPnlOn: number;
    maxExposureP95Off: number;
    maxExposureP95On: number;
  };
  goals: Array<{ matchMin: number; g1: number; g2: number; jumpedMarkets: string[] }>;
  timelines: { on: DashboardTick[]; off: DashboardTick[] };
  honestRead: string;
}

function fixtureIdFromUrl(): string {
  const q = new URLSearchParams(window.location.search).get("id");
  return q ?? "17588325";
}

export async function loadDashboard(): Promise<DashboardPayload> {
  const id = fixtureIdFromUrl();
  const res = await fetch(`/dashboard-${id}.json`);
  if (!res.ok) throw new Error(`Failed to load dashboard-${id}.json`);
  return res.json() as Promise<DashboardPayload>;
}

export function fmt(n: number, d = 2): string {
  return n.toFixed(d);
}

export function fmtMatchMin(v: number): string {
  return `${v.toFixed(1)}′`;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function marketLabel(data: DashboardPayload, key: string): string {
  return data.meta.marketLabels[key] ?? key;
}

export function key1x2(data: DashboardPayload): string {
  return data.meta.marketKeys.find((k) => k.startsWith("1X2")) ?? data.meta.marketKeys[0]!;
}

export function binValues(
  values: number[],
  binCount: number,
): { x: number; count: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / binCount || 1;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    counts[idx]! += 1;
  }
  return counts.map((count, i) => ({
    x: min + (i + 0.5) * width,
    count,
  }));
}
