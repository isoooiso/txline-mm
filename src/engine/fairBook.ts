import { EventEmitter } from "node:events";
import type { FeedEvent, OddsPayload, ScorePayload } from "../types.js";
import { deriveFairLines } from "../util/fairValue.js";
import type { FeedSource } from "../feed/feedSource.js";
import {
  type GameSnapshot,
  type MarketState,
  type Outcome,
  emptyFairProb,
  isQuotedPayload,
  marketKeyFromPayload,
  maxProbJump,
  parseLine,
  parsePeriod,
  quotedMarketKeys,
} from "./types.js";

export interface FairBookSnapshot {
  markets: Record<string, MarketState>;
  game: GameSnapshot;
  scoreChanged: boolean;
}

interface FairHistoryEntry {
  matchMs: number;
  fairProb: Record<Outcome, number>;
}

const HISTORY_MAX = 600;

export class FairBook extends EventEmitter {
  private readonly markets = new Map<string, MarketState>();
  private readonly history = new Map<string, FairHistoryEntry[]>();
  private startMs = 0;
  private game: GameSnapshot = {
    g1: 0,
    g2: 0,
    h1g1: 0,
    h1g2: 0,
    redP1: 0,
    redP2: 0,
  };
  private lastScoreChanged = false;
  private readonly jumps = new Map<string, number>();

  constructor(feed?: FeedSource) {
    super();
    if (feed) {
      feed.on("event", (e) => this.onEvent(e));
    }
    for (const key of quotedMarketKeys()) {
      this.jumps.set(key, 0);
    }
  }

  setStartMs(startMs: number): void {
    this.startMs = startMs;
  }

  onEvent(e: FeedEvent): void {
    this.lastScoreChanged = false;
    const matchMs = Math.max(0, e.ts - this.startMs);
    if (e.type === "odds") this.onOdds(e.data, matchMs);
    else this.onScore(e.data);
  }

  /** Most recent fairProb with matchMs <= asOfMatchMs; oldest entry if none qualify. */
  fairAsOf(key: string, asOfMatchMs: number): Record<Outcome, number> | null {
    const buf = this.history.get(key);
    if (!buf || buf.length === 0) return null;

    let best: FairHistoryEntry | null = null;
    for (const entry of buf) {
      if (entry.matchMs <= asOfMatchMs) {
        if (!best || entry.matchMs >= best.matchMs) best = entry;
      }
    }

    if (best) return { ...best.fairProb };
    return { ...buf[0]!.fairProb };
  }

  private pushHistory(
    key: string,
    matchMs: number,
    fairProb: Record<Outcome, number>,
  ): void {
    let buf = this.history.get(key);
    if (!buf) {
      buf = [];
      this.history.set(key, buf);
    }
    buf.push({ matchMs, fairProb: { ...fairProb } });
    while (buf.length > HISTORY_MAX) buf.shift();
  }

  private onOdds(data: OddsPayload, matchMs: number): void {
    if (!isQuotedPayload(data)) return;

    const key = marketKeyFromPayload(data);
    const line = deriveFairLines(data);
    const outcomes = line.outcomes.map((o) => o.name);
    if (outcomes.length === 0) return;

    const fairProb = Object.fromEntries(
      line.outcomes.map((o) => [o.name, o.fairProb]),
    ) as Record<string, number>;

    this.pushHistory(key, matchMs, fairProb);

    const existing = this.markets.get(key);
    const prevFairProb = existing
      ? { ...existing.fairProb }
      : emptyFairProb(outcomes);

    const jump = maxProbJump(prevFairProb, fairProb, outcomes);
    this.jumps.set(key, jump);

    const state: MarketState = {
      key,
      superType: data.SuperOddsType,
      period: parsePeriod(data.MarketPeriod),
      line: parseLine(data.MarketParameters),
      outcomes,
      fairProb,
      prevFairProb,
      lastTs: data.Ts,
      lastMessageId: data.MessageId,
      warm: true,
      inRunning: data.InRunning,
    };
    this.markets.set(key, state);

    if (jump > 0) {
      this.emit("jump", key, jump);
    }
  }

  private onScore(data: ScorePayload): void {
    const stats = data.Stats as Record<string, number> | undefined;
    const prev = { ...this.game };
    const next = parseStatsSnapshot(stats, data);
    this.game = { ...this.game, ...next };
    if (typeof data.StatusId === "number") {
      this.game.phaseId = data.StatusId;
    }

    const changed =
      next.g1 > prev.g1 ||
      next.g2 > prev.g2 ||
      next.redP1 > prev.redP1 ||
      next.redP2 > prev.redP2;
    if (changed) {
      this.lastScoreChanged = true;
      this.emit("scoreChanged", this.game);
    }
  }

  getJump(key: string): number {
    return this.jumps.get(key) ?? 0;
  }

  get scoreChanged(): boolean {
    return this.lastScoreChanged;
  }

  getMarket(key: string): MarketState | undefined {
    return this.markets.get(key);
  }

  snapshot(): FairBookSnapshot {
    return {
      markets: Object.fromEntries(this.markets.entries()),
      game: { ...this.game },
      scoreChanged: this.lastScoreChanged,
    };
  }
}

function parseStatsSnapshot(
  stats: Record<string, number> | undefined,
  data: ScorePayload,
): GameSnapshot {
  const get = (k: number): number => {
    if (!stats) return 0;
    const v = stats[String(k)] ?? stats[k];
    return typeof v === "number" ? v : 0;
  };
  return {
    g1: get(1),
    g2: get(2),
    h1g1: get(1001),
    h1g2: get(1002),
    redP1: get(5),
    redP2: get(6),
    phaseId:
      typeof data.StatusId === "number" ? data.StatusId : undefined,
  };
}
