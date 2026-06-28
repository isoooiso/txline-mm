import type { OddsPayload } from "../types.js";

export type Outcome = string;
export type MarketPeriod = "FT" | "H1";

export interface MarketState {
  key: string;
  superType: string;
  period: MarketPeriod;
  line: number | null;
  outcomes: string[];
  fairProb: Record<Outcome, number>;
  prevFairProb: Record<Outcome, number>;
  lastTs: number;
  lastMessageId: string;
  warm: boolean;
  inRunning: boolean;
}

export interface Quote {
  outcome: string;
  bid: number;
  ask: number;
  bidOdds: number;
  askOdds: number;
  pulled: boolean;
  bidPulled: boolean;
  askPulled: boolean;
}

export interface Fill {
  ts: number;
  matchMs: number;
  marketKey: string;
  outcome: string;
  side: "takerBuy" | "takerSell";
  price: number;
  size: number;
  fairAtFill: number;
}

export interface Position {
  shares: Record<Outcome, number>;
  cash: number;
}

export interface GameSnapshot {
  phaseId?: number;
  g1: number;
  g2: number;
  h1g1: number;
  h1g2: number;
  redP1: number;
  redP2: number;
}

export interface RunConfig {
  seed: number;
  speed: number;
  halfSpread: number;
  maxOutcomePos: number;
  maxMarketLoss: number;
  inventorySkewK: number;
  protectionEnabled: boolean;
  repriceJumpThreshold: number;
  protectCooldownMs: number;
  takerLambdaPerMin: number;
  takerNoiseSd: number;
  takerSize: number;
  /** Match-time ms the maker's quotes lag fair (0 = no lag). */
  quoteLatencyMs: number;
}

/** Sweep config: RunConfig fields except seed, plus explicit seed list. */
export type SweepConfig = Omit<RunConfig, "seed"> & { seeds: number[] };

export interface DistributionStats {
  mean: number;
  std: number;
  p5: number;
  p50: number;
  p95: number;
}

export interface MetricAggregate {
  off: DistributionStats;
  on: DistributionStats;
}

export interface DeltaAggregate {
  realizedPnl: DistributionStats;
  inventoryPnl: DistributionStats;
  maxExposure: DistributionStats;
  meanDelta: {
    realizedPnl: number;
    inventoryPnl: number;
    maxExposure: number;
  };
  fractionOnWinsRealizedPnl: number;
}

export interface LeftTailComparison {
  worstRealizedPnlOff: number;
  worstRealizedPnlOn: number;
  maxExposureP95Off: number;
  maxExposureP95On: number;
}

export interface AggregateResult {
  fixtureId: number;
  sweep: SweepConfig;
  seedCount: number;
  metrics: {
    realizedPnl: MetricAggregate;
    spreadCaptured: MetricAggregate;
    inventoryPnl: MetricAggregate;
    maxExposure: MetricAggregate;
    protectEvents: MetricAggregate;
    fills: MetricAggregate;
  };
  delta: DeltaAggregate;
  leftTail: LeftTailComparison;
  spreadCapturedMeanDiff: number;
  representativeTimeline: Tick[];
  representativeSeed: number;
  honestRead: string;
}

export interface Tick {
  matchMin: number;
  matchMs: number;
  perMarketFair: Record<string, Record<Outcome, number>>;
  perMarketQuoteState: Record<string, Record<Outcome, { bid: number; ask: number; pulled: boolean }>>;
  cumPnl: number;
  cumExposure: number;
  scoreG1: number;
  scoreG2: number;
  scoreChanged: boolean;
}

export interface MarketResult {
  marketKey: string;
  realizedPnl: number;
  spreadCaptured: number;
  inventoryPnl: number;
  fills: number;
  protectEvents: number;
  maxExposure: number;
  winningOutcome: string;
  position: Position;
}

export interface Totals {
  realizedPnl: number;
  spreadCaptured: number;
  inventoryPnl: number;
  fills: number;
  protectEvents: number;
  maxExposure: number;
  worstAdverseTick: number;
}

export interface RunResult {
  config: RunConfig;
  fixtureId: number;
  perMarket: Record<string, MarketResult>;
  totals: Totals;
  timeline: Tick[];
  finalGameState: GameSnapshot;
}

export interface FixtureMeta {
  fixtureId: number;
  startMs: number;
  participants: [string, string];
}

export interface QuotedMarketSpec {
  superType: string;
  period: MarketPeriod;
  line: number | null;
}

export const DEFAULT_QUOTED_MARKETS: QuotedMarketSpec[] = [
  { superType: "1X2_PARTICIPANT_RESULT", period: "FT", line: null },
  { superType: "OVERUNDER_PARTICIPANT_GOALS", period: "FT", line: 1.5 },
  { superType: "OVERUNDER_PARTICIPANT_GOALS", period: "FT", line: 2.5 },
];

export const DEFAULT_RUN_CONFIG: RunConfig = {
  seed: 42,
  speed: 0,
  halfSpread: 0.02,
  maxOutcomePos: 10,
  maxMarketLoss: 50,
  inventorySkewK: 0.001,
  protectionEnabled: true,
  repriceJumpThreshold: 0.04,
  protectCooldownMs: 120_000,
  takerLambdaPerMin: 2,
  takerNoiseSd: 0.03,
  takerSize: 1,
  quoteLatencyMs: 1000,
};

export function parseLine(params: string | null | undefined): number | null {
  if (!params) return null;
  const m = params.match(/line=([\d.]+)/);
  return m ? Number(m[1]) : null;
}

export function parsePeriod(period: string | null | undefined): MarketPeriod {
  if (period === "half=1") return "H1";
  return "FT";
}

export function isCleanHalfLine(line: number | null): boolean {
  if (line === null) return true;
  return Math.abs(line * 2 - Math.round(line * 2)) < 1e-9 && Math.abs((line % 1) - 0.5) < 1e-9;
}

export function marketKeyFromParts(
  superType: string,
  period: MarketPeriod,
  line: number | null,
): string {
  return `${superType}|${period}|${line ?? ""}`;
}

export function marketKeyFromPayload(payload: OddsPayload): string {
  return marketKeyFromParts(
    payload.SuperOddsType,
    parsePeriod(payload.MarketPeriod),
    parseLine(payload.MarketParameters),
  );
}

export function isQuotedPayload(payload: OddsPayload): boolean {
  const period = parsePeriod(payload.MarketPeriod);
  const line = parseLine(payload.MarketParameters);
  if (payload.SuperOddsType === "ASIANHANDICAP_PARTICIPANT_GOALS") return false;
  if (!isCleanHalfLine(line)) return false;
  return DEFAULT_QUOTED_MARKETS.some(
    (m) =>
      m.superType === payload.SuperOddsType &&
      m.period === period &&
      m.line === line,
  );
}

export function quotedMarketKeys(): string[] {
  return DEFAULT_QUOTED_MARKETS.map((m) =>
    marketKeyFromParts(m.superType, m.period, m.line),
  );
}

export function emptyFairProb(outcomes: string[]): Record<Outcome, number> {
  return Object.fromEntries(outcomes.map((o) => [o, 0]));
}

export function maxProbJump(
  prev: Record<Outcome, number>,
  next: Record<Outcome, number>,
  outcomes: string[],
): number {
  let max = 0;
  for (const o of outcomes) {
    max = Math.max(max, Math.abs((next[o] ?? 0) - (prev[o] ?? 0)));
  }
  return max;
}
