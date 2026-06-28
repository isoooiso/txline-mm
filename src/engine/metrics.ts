import { spreadContribution } from "./execSim.js";
import { settleAll } from "./settlement.js";
import type { MakerRunResult } from "./runner.js";
import type {
  AggregateResult,
  DeltaAggregate,
  DistributionStats,
  Fill,
  GameSnapshot,
  LeftTailComparison,
  MarketResult,
  MarketState,
  MetricAggregate,
  Position,
  RunConfig,
  RunResult,
  SweepConfig,
  Tick,
  Totals,
} from "./types.js";

export interface MetricsInput {
  config: RunConfig;
  fixtureId: number;
  markets: Record<string, MarketState>;
  positions: Map<string, Position>;
  fills: Fill[];
  protectEvents: number;
  timeline: Tick[];
  finalGame: GameSnapshot;
}

export function buildRunResult(input: MetricsInput): RunResult {
  const settlements = settleAll(
    input.markets,
    input.positions,
    input.finalGame,
  );

  const fillsByMarket = groupFills(input.fills);
  const perMarket: Record<string, MarketResult> = {};
  let totals: Totals = {
    realizedPnl: 0,
    spreadCaptured: 0,
    inventoryPnl: 0,
    fills: input.fills.length,
    protectEvents: input.protectEvents,
    maxExposure: 0,
    worstAdverseTick: 0,
  };

  for (const [key, state] of Object.entries(input.markets)) {
    const pos = input.positions.get(key) ?? {
      shares: Object.fromEntries(state.outcomes.map((o) => [o, 0])),
      cash: 0,
    };
    const marketFills = fillsByMarket.get(key) ?? [];
    const spreadCaptured = marketFills.reduce(
      (s, f) => s + spreadContribution(f),
      0,
    );
    const settlement = settlements[key] ?? {
      winningOutcome: "",
      realizedPnl: pos.cash,
    };
    const realizedPnl = settlement.realizedPnl;
    const inventoryPnl = realizedPnl - spreadCaptured;
    const maxExposure = maxTimelineExposure(input.timeline, key);

    perMarket[key] = {
      marketKey: key,
      realizedPnl,
      spreadCaptured,
      inventoryPnl,
      fills: marketFills.length,
      protectEvents: 0,
      maxExposure,
      winningOutcome: settlement.winningOutcome,
      position: pos,
    };

    totals.realizedPnl += realizedPnl;
    totals.spreadCaptured += spreadCaptured;
    totals.inventoryPnl += inventoryPnl;
    totals.maxExposure = Math.max(totals.maxExposure, maxExposure);
  }

  totals.worstAdverseTick = worstAdversePnlDelta(input.timeline);

  return {
    config: input.config,
    fixtureId: input.fixtureId,
    perMarket,
    totals,
    timeline: input.timeline,
    finalGameState: input.finalGame,
  };
}

function groupFills(fills: Fill[]): Map<string, Fill[]> {
  const m = new Map<string, Fill[]>();
  for (const f of fills) {
    const arr = m.get(f.marketKey) ?? [];
    arr.push(f);
    m.set(f.marketKey, arr);
  }
  return m;
}

function maxTimelineExposure(timeline: Tick[], key: string): number {
  let max = 0;
  for (const t of timeline) {
    max = Math.max(max, t.cumExposure);
  }
  void key;
  return max;
}

function worstAdversePnlDelta(timeline: Tick[]): number {
  let worst = 0;
  let prev = 0;
  for (const t of timeline) {
    const delta = t.cumPnl - prev;
    if (delta < worst) worst = delta;
    prev = t.cumPnl;
  }
  return worst;
}

export function markToMarketPnl(
  positions: Map<string, Position>,
  markets: Record<string, MarketState>,
): number {
  let total = 0;
  for (const [key, state] of Object.entries(markets)) {
    const pos = positions.get(key);
    if (!pos) continue;
    for (const o of state.outcomes) {
      const fair = state.fairProb[o] ?? 0;
      total += pos.cash + (pos.shares[o] ?? 0) * fair;
    }
  }
  return total;
}

export interface SeedPairResult {
  seed: number;
  off: RunResult;
  on: RunResult;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function distributionStats(values: number[]): DistributionStats {
  if (values.length === 0) {
    return { mean: 0, std: 0, p5: 0, p50: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    mean,
    std: Math.sqrt(variance),
    p5: percentile(sorted, 5),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function metricAggregate(
  offValues: number[],
  onValues: number[],
): MetricAggregate {
  return {
    off: distributionStats(offValues),
    on: distributionStats(onValues),
  };
}

function buildHonestRead(
  meanDeltaPnl: number,
  meanDeltaInv: number,
  spreadDiff: number,
  leftTail: LeftTailComparison,
  fractionWins: number,
): string {
  const tailImproved = leftTail.worstRealizedPnlOn > leftTail.worstRealizedPnlOff;
  const exposureImproved = leftTail.maxExposureP95On < leftTail.maxExposureP95Off;
  const spreadNeutral = Math.abs(spreadDiff) < 0.05;

  if (Math.abs(meanDeltaPnl) > 0.5 && fractionWins > 0.6 && spreadNeutral) {
    return "Protection adds structural mean-PnL (spread-neutral) — inventory loss around jumps is reduced on average.";
  }
  if (tailImproved && exposureImproved && spreadNeutral) {
    return "Protection is primarily risk-control: left-tail realizedPnl and p95 maxExposure improve with ~equal spreadCaptured.";
  }
  if (Math.abs(meanDeltaInv) > Math.abs(meanDeltaPnl) * 0.5) {
    return "Protection value shows up in inventoryPnl (adverse-selection channel) more than headline spread.";
  }
  return "Mixed: protection shifts both mean and tail metrics — inspect paired deltas per seed.";
}

export function aggregateSeeds(
  pairs: SeedPairResult[],
  sweep: SweepConfig,
  fixtureId: number,
): AggregateResult {
  const pick = (side: "off" | "on", fn: (r: RunResult) => number) =>
    pairs.map((p) => fn(p[side]));

  const offPnl = pick("off", (r) => r.totals.realizedPnl);
  const onPnl = pick("on", (r) => r.totals.realizedPnl);
  const offSpread = pick("off", (r) => r.totals.spreadCaptured);
  const onSpread = pick("on", (r) => r.totals.spreadCaptured);
  const offInv = pick("off", (r) => r.totals.inventoryPnl);
  const onInv = pick("on", (r) => r.totals.inventoryPnl);
  const offExp = pick("off", (r) => r.totals.maxExposure);
  const onExp = pick("on", (r) => r.totals.maxExposure);
  const offProt = pick("off", (r) => r.totals.protectEvents);
  const onProt = pick("on", (r) => r.totals.protectEvents);
  const offFills = pick("off", (r) => r.totals.fills);
  const onFills = pick("on", (r) => r.totals.fills);

  const deltaPnl = pairs.map((p) => p.on.totals.realizedPnl - p.off.totals.realizedPnl);
  const deltaInv = pairs.map((p) => p.on.totals.inventoryPnl - p.off.totals.inventoryPnl);
  const deltaExp = pairs.map((p) => p.on.totals.maxExposure - p.off.totals.maxExposure);

  const spreadOffMean = distributionStats(offSpread).mean;
  const spreadOnMean = distributionStats(onSpread).mean;
  const spreadCapturedMeanDiff = spreadOnMean - spreadOffMean;

  const leftTail: LeftTailComparison = {
    worstRealizedPnlOff: Math.min(...offPnl),
    worstRealizedPnlOn: Math.min(...onPnl),
    maxExposureP95Off: distributionStats(offExp).p95,
    maxExposureP95On: distributionStats(onExp).p95,
  };

  const delta: DeltaAggregate = {
    realizedPnl: distributionStats(deltaPnl),
    inventoryPnl: distributionStats(deltaInv),
    maxExposure: distributionStats(deltaExp),
    meanDelta: {
      realizedPnl: deltaPnl.reduce((s, v) => s + v, 0) / deltaPnl.length,
      inventoryPnl: deltaInv.reduce((s, v) => s + v, 0) / deltaInv.length,
      maxExposure: deltaExp.reduce((s, v) => s + v, 0) / deltaExp.length,
    },
    fractionOnWinsRealizedPnl:
      deltaPnl.filter((d) => d > 0).length / deltaPnl.length,
  };

  const repSeed = sweep.seeds[0] ?? 42;
  const repPair = pairs.find((p) => p.seed === repSeed) ?? pairs[0]!;

  const honestRead = buildHonestRead(
    delta.meanDelta.realizedPnl,
    delta.meanDelta.inventoryPnl,
    spreadCapturedMeanDiff,
    leftTail,
    delta.fractionOnWinsRealizedPnl,
  );

  return {
    fixtureId,
    sweep,
    seedCount: pairs.length,
    metrics: {
      realizedPnl: metricAggregate(offPnl, onPnl),
      spreadCaptured: metricAggregate(offSpread, onSpread),
      inventoryPnl: metricAggregate(offInv, onInv),
      maxExposure: metricAggregate(offExp, onExp),
      protectEvents: metricAggregate(offProt, onProt),
      fills: metricAggregate(offFills, onFills),
    },
    delta,
    leftTail,
    spreadCapturedMeanDiff,
    representativeTimeline: repPair.on.timeline,
    representativeSeed: repPair.seed,
    honestRead,
  };
}

export function formatDist(d: DistributionStats): string {
  return `mean=${d.mean.toFixed(3)} [p5=${d.p5.toFixed(3)}, p50=${d.p50.toFixed(3)}, p95=${d.p95.toFixed(3)}]`;
}

export interface CrossMatchPair {
  fixtureId: number;
  seed: number;
  off: MakerRunResult;
  on: MakerRunResult;
}

export interface WindowDeltaStats extends DistributionStats {
  sem: number;
  ci95Low: number;
  ci95High: number;
}

export interface WindowAggregate {
  n: number;
  windowDelta: WindowDeltaStats;
  fractionPositive: number;
  offWindowPnl: DistributionStats;
  onWindowPnl: DistributionStats;
  leftTail: { offP5: number; onP5: number };
  wholeMatch: {
    label: string;
    offMean: number;
    onMean: number;
    deltaMean: number;
  };
  perFixture: Array<{
    fixtureId: number;
    score: string;
    repriceEventCount: number;
    wholeMatchDeltaPnl: number;
  }>;
  honestRead: string;
  seeds: number[];
  fixtureIds: number[];
}

function windowKey(w: { key: string; jumpTs: number }): string {
  return `${w.key}@${w.jumpTs}`;
}

function buildWindowHonestRead(
  ci95Low: number,
  ci95High: number,
  offP5: number,
  onP5: number,
): string {
  const ciExcludesZero = ci95Low > 0 || ci95High < 0;
  if (ciExcludesZero) {
    const sign = ci95Low > 0 ? "positive" : "negative";
    return `Structural (${sign}): 95% CI on mean windowDelta excludes 0 [${ci95Low.toFixed(3)}, ${ci95High.toFixed(3)}].`;
  }
  if (onP5 > offP5) {
    return "Tail/risk-control: no mean effect (CI includes 0), but protection lifts worst reprice windows (onWindowPnl p5 > offWindowPnl p5).";
  }
  return "No measurable effect: protection costs spread without compensating benefit in reprice windows (report honestly).";
}

export function aggregateWindows(pairs: CrossMatchPair[]): WindowAggregate {
  const windowDeltas: number[] = [];
  const offWindowPnls: number[] = [];
  const onWindowPnls: number[] = [];

  const fixtureMap = new Map<
    number,
    { events: Set<string>; offPnl: number[]; onPnl: number[]; score: string }
  >();

  for (const pair of pairs) {
    const offByKey = new Map(
      pair.off.windowPnls.map((w) => [windowKey(w), w.totalPnl]),
    );

    for (const wOn of pair.on.windowPnls) {
      const k = windowKey(wOn);
      const offPnl = offByKey.get(k);
      if (offPnl === undefined) continue;
      windowDeltas.push(wOn.totalPnl - offPnl);
      offWindowPnls.push(offPnl);
      onWindowPnls.push(wOn.totalPnl);
    }

    let fx = fixtureMap.get(pair.fixtureId);
    if (!fx) {
      const g = pair.off.finalGameState;
      fx = {
        events: new Set<string>(),
        offPnl: [],
        onPnl: [],
        score: `${g.g1}-${g.g2}`,
      };
      fixtureMap.set(pair.fixtureId, fx);
    }
    for (const ev of pair.off.repriceEvents) {
      fx.events.add(windowKey(ev));
    }
    fx.offPnl.push(pair.off.totals.realizedPnl);
    fx.onPnl.push(pair.on.totals.realizedPnl);
  }

  const n = windowDeltas.length;
  const dist = distributionStats(windowDeltas);
  const sem = n > 0 ? dist.std / Math.sqrt(n) : 0;
  const ci95Low = dist.mean - 1.96 * sem;
  const ci95High = dist.mean + 1.96 * sem;

  const offDist = distributionStats(offWindowPnls);
  const onDist = distributionStats(onWindowPnls);

  const wholeOff =
    pairs.reduce((s, p) => s + p.off.totals.realizedPnl, 0) / pairs.length;
  const wholeOn =
    pairs.reduce((s, p) => s + p.on.totals.realizedPnl, 0) / pairs.length;

  const perFixture = [...fixtureMap.entries()].map(([fixtureId, fx]) => ({
    fixtureId,
    score: fx.score,
    repriceEventCount: fx.events.size,
    wholeMatchDeltaPnl:
      fx.onPnl.reduce((s, v) => s + v, 0) / fx.onPnl.length -
      fx.offPnl.reduce((s, v) => s + v, 0) / fx.offPnl.length,
  }));

  const honestRead = buildWindowHonestRead(
    ci95Low,
    ci95High,
    offDist.p5,
    onDist.p5,
  );

  return {
    n,
    windowDelta: { ...dist, sem, ci95Low, ci95High },
    fractionPositive: n > 0 ? windowDeltas.filter((d) => d > 0).length / n : 0,
    offWindowPnl: offDist,
    onWindowPnl: onDist,
    leftTail: { offP5: offDist.p5, onP5: onDist.p5 },
    wholeMatch: {
      label: "noisy / context only",
      offMean: wholeOff,
      onMean: wholeOn,
      deltaMean: wholeOn - wholeOff,
    },
    perFixture,
    honestRead,
    seeds: [...new Set(pairs.map((p) => p.seed))].sort((a, b) => a - b),
    fixtureIds: [...new Set(pairs.map((p) => p.fixtureId))].sort(
      (a, b) => a - b,
    ),
  };
}

// --- Dashboard lean export (slice 3) ---

export interface DashboardTick {
  matchMin: number;
  fair: Record<string, Record<string, number>>;
  pulled: Record<string, boolean>;
  cumPnl: number;
  cumExposure: number;
  g1: number;
  g2: number;
}

export interface DashboardGoal {
  matchMin: number;
  g1: number;
  g2: number;
  jumpedMarkets: string[];
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
  summary: {
    realizedPnl: { off: DistributionStats; on: DistributionStats };
    spreadCaptured: {
      off: { mean: number; p50: number };
      on: { mean: number; p50: number };
      costOffMinusOn: number;
    };
    inventoryPnl: { off: DistributionStats; on: DistributionStats };
    maxExposure: {
      off: { mean: number; p50: number; p95: number };
      on: { mean: number; p50: number; p95: number };
    };
    protectEvents: { on: number };
    fills: { off: { mean: number }; on: { mean: number } };
  };
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
    realizedPnl: DistributionStats & { sem: number };
    maxExposure: DistributionStats;
    fractionOnWins: number;
  };
  leftTail: LeftTailComparison;
  goals: DashboardGoal[];
  timelines: { on: DashboardTick[]; off: DashboardTick[] };
  honestRead: string;
}

const MARKET_LABELS: Record<string, string> = {
  "1X2_PARTICIPANT_RESULT|FT|": "1X2",
  "OVERUNDER_PARTICIPANT_GOALS|FT|1.5": "O/U 1.5",
  "OVERUNDER_PARTICIPANT_GOALS|FT|2.5": "O/U 2.5",
};

function pickStats(d: DistributionStats): DistributionStats {
  return {
    mean: d.mean,
    std: d.std,
    p5: d.p5,
    p50: d.p50,
    p95: d.p95,
  };
}

function toDashboardTick(t: Tick, marketKeys: string[]): DashboardTick {
  const pulled: Record<string, boolean> = {};
  const fair: Record<string, Record<string, number>> = {};
  for (const key of marketKeys) {
    const qs = t.perMarketQuoteState[key];
    pulled[key] = qs
      ? Object.values(qs).some((o) => o.pulled)
      : true;
    fair[key] = t.perMarketFair[key] ?? {};
  }
  return {
    matchMin: t.matchMin,
    fair,
    pulled,
    cumPnl: t.cumPnl,
    cumExposure: t.cumExposure,
    g1: t.scoreG1,
    g2: t.scoreG2,
  };
}

function extractGoals(timeline: Tick[], marketKeys: string[]): DashboardGoal[] {
  const goals: DashboardGoal[] = [];
  let prevG1 = 0;
  let prevG2 = 0;
  let prevFair: Record<string, Record<string, number>> = {};

  for (const t of timeline) {
    if (t.scoreG1 > prevG1 || t.scoreG2 > prevG2) {
      const jumped: string[] = [];
      for (const key of marketKeys) {
        const cur = t.perMarketFair[key];
        const prev = prevFair[key];
        if (!cur) continue;
        if (!prev) {
          jumped.push(key);
          continue;
        }
        for (const o of Object.keys(cur)) {
          if (Math.abs((cur[o] ?? 0) - (prev[o] ?? 0)) > 0.01) {
            jumped.push(key);
            break;
          }
        }
      }
      goals.push({
        matchMin: t.matchMin,
        g1: t.scoreG1,
        g2: t.scoreG2,
        jumpedMarkets: jumped,
      });
    }
    prevG1 = t.scoreG1;
    prevG2 = t.scoreG2;
    prevFair = t.perMarketFair;
  }
  return goals;
}

export function downsampleTimeline(
  ticks: DashboardTick[],
  goals: DashboardGoal[],
  cooldownMs: number,
  target = 400,
): DashboardTick[] {
  if (ticks.length <= target) return ticks;

  const cooldownMin = cooldownMs / 60_000;
  const forcedIndices = new Set<number>();
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!;
    for (const g of goals) {
      if (t.matchMin >= g.matchMin && t.matchMin <= g.matchMin + cooldownMin) {
        forcedIndices.add(i);
        break;
      }
    }
  }

  const remaining = ticks
    .map((_, i) => i)
    .filter((i) => !forcedIndices.has(i));
  const budget = Math.max(1, target - forcedIndices.size);
  const step = remaining.length / budget;
  const sampled = new Set<number>(forcedIndices);
  for (let j = 0; j < budget; j++) {
    const idx = remaining[Math.min(remaining.length - 1, Math.floor(j * step))];
    if (idx !== undefined) sampled.add(idx);
  }

  return [...sampled]
    .sort((a, b) => a - b)
    .map((i) => ticks[i]!);
}

function buildDashboardHonestRead(
  deltaMean: number,
  deltaStd: number,
  seedCount: number,
  fractionOnWins: number,
  leftTail: LeftTailComparison,
  costOffMinusOn: number,
): string {
  const sem = deltaStd / Math.sqrt(seedCount);
  const pnl =
    Math.abs(deltaMean) <= 1.96 * sem
      ? "no significant change in return"
      : deltaMean > 0
        ? "improves return"
        : "reduces return";
  const expPct = Math.round(
    100 * (1 - leftTail.maxExposureP95On / leftTail.maxExposureP95Off),
  );
  const tail =
    leftTail.maxExposureP95On < leftTail.maxExposureP95Off
      ? `cuts p95 exposure by ${expPct}%`
      : "no exposure benefit";
  return `Protection ${tail}; ${pnl} (Δ=${deltaMean.toFixed(2)} ± ${(1.96 * sem).toFixed(2)}, wins ${Math.round(100 * fractionOnWins)}% of seeds); costs ${costOffMinusOn.toFixed(2)} spread. Single match = one reprice sequence, not cross-match significance.`;
}

export function buildDashboardPayload(input: {
  aggregate: AggregateResult;
  pairs: SeedPairResult[];
  fixtureId: number;
  participant1: string;
  participant2: string;
  oddsCount: number;
  network: string;
  marketKeys: string[];
}): DashboardPayload {
  const { aggregate, pairs, fixtureId } = input;
  const marketKeys = input.marketKeys;
  const marketLabels = Object.fromEntries(
    marketKeys.map((k) => [k, MARKET_LABELS[k] ?? k]),
  );

  const repSeed = aggregate.representativeSeed;
  const repPair = pairs.find((p) => p.seed === repSeed) ?? pairs[0]!;

  const offTicks = repPair.off.timeline.map((t) => toDashboardTick(t, marketKeys));
  const onTicks = repPair.on.timeline.map((t) => toDashboardTick(t, marketKeys));
  const goals = extractGoals(repPair.on.timeline, marketKeys);
  const cooldownMs = aggregate.sweep.protectCooldownMs;

  const timelines = {
    off: downsampleTimeline(offTicks, goals, cooldownMs),
    on: downsampleTimeline(onTicks, goals, cooldownMs),
  };

  const m = aggregate.metrics;
  const spreadOffMean = m.spreadCaptured.off.mean;
  const spreadOnMean = m.spreadCaptured.on.mean;
  const costOffMinusOn = spreadOffMean - spreadOnMean;

  const deltaPnl = pairs.map(
    (p) => p.on.totals.realizedPnl - p.off.totals.realizedPnl,
  );
  const deltaExp = pairs.map(
    (p) => p.on.totals.maxExposure - p.off.totals.maxExposure,
  );

  const g = repPair.off.finalGameState;
  const seedCount = pairs.length;
  const honestRead = buildDashboardHonestRead(
    aggregate.delta.realizedPnl.mean,
    aggregate.delta.realizedPnl.std,
    seedCount,
    aggregate.delta.fractionOnWinsRealizedPnl,
    aggregate.leftTail,
    costOffMinusOn,
  );

  return {
    meta: {
      fixtureId,
      participant1: input.participant1,
      participant2: input.participant2,
      finalG1: g.g1,
      finalG2: g.g2,
      network: input.network,
      bookmaker: "TXLineStablePriceDemargined",
      oddsCount: input.oddsCount,
      marketKeys,
      marketLabels,
      config: {
        halfSpread: aggregate.sweep.halfSpread,
        quoteLatencyMs: aggregate.sweep.quoteLatencyMs,
        maxOutcomePos: aggregate.sweep.maxOutcomePos,
        protectCooldownMs: aggregate.sweep.protectCooldownMs,
        repriceJumpThreshold: aggregate.sweep.repriceJumpThreshold,
        takerLambdaPerMin: aggregate.sweep.takerLambdaPerMin,
        takerNoiseSd: aggregate.sweep.takerNoiseSd,
        seedCount,
      },
    },
    summary: {
      realizedPnl: {
        off: pickStats(m.realizedPnl.off),
        on: pickStats(m.realizedPnl.on),
      },
      spreadCaptured: {
        off: { mean: spreadOffMean, p50: m.spreadCaptured.off.p50 },
        on: { mean: spreadOnMean, p50: m.spreadCaptured.on.p50 },
        costOffMinusOn,
      },
      inventoryPnl: {
        off: pickStats(m.inventoryPnl.off),
        on: pickStats(m.inventoryPnl.on),
      },
      maxExposure: {
        off: {
          mean: m.maxExposure.off.mean,
          p50: m.maxExposure.off.p50,
          p95: m.maxExposure.off.p95,
        },
        on: {
          mean: m.maxExposure.on.mean,
          p50: m.maxExposure.on.p50,
          p95: m.maxExposure.on.p95,
        },
      },
      protectEvents: { on: m.protectEvents.on.mean },
      fills: {
        off: { mean: m.fills.off.mean },
        on: { mean: m.fills.on.mean },
      },
    },
    perSeed: {
      seeds: pairs.map((p) => p.seed),
      realizedPnlOff: pairs.map((p) => p.off.totals.realizedPnl),
      realizedPnlOn: pairs.map((p) => p.on.totals.realizedPnl),
      inventoryPnlOff: pairs.map((p) => p.off.totals.inventoryPnl),
      inventoryPnlOn: pairs.map((p) => p.on.totals.inventoryPnl),
      maxExposureOff: pairs.map((p) => p.off.totals.maxExposure),
      maxExposureOn: pairs.map((p) => p.on.totals.maxExposure),
      deltaRealizedPnl: deltaPnl,
    },
    delta: {
      realizedPnl: {
        ...pickStats(aggregate.delta.realizedPnl),
        sem: aggregate.delta.realizedPnl.std / Math.sqrt(seedCount),
      },
      maxExposure: pickStats(distributionStats(deltaExp)),
      fractionOnWins: aggregate.delta.fractionOnWinsRealizedPnl,
    },
    leftTail: aggregate.leftTail,
    goals,
    timelines,
    honestRead,
  };
}
