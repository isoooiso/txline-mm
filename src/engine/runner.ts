import { mkdirSync, writeFileSync } from "node:fs";
import type { FeedSource } from "../feed/feedSource.js";
import { makeRng } from "../util/rng.js";
import { FairBook } from "./fairBook.js";
import {
  type MarketQuoteContext,
  fillMakerCash,
  simulateTakerFills,
} from "./execSim.js";
import { buildRunResult } from "./metrics.js";
import { RiskEngine } from "./riskEngine.js";
import {
  DEFAULT_QUOTED_MARKETS,
  type Fill,
  type FixtureMeta,
  type RunConfig,
  type RunResult,
  type Tick,
  isQuotedPayload,
  marketKeyFromPayload,
  marketKeyFromParts,
  quotedMarketKeys,
} from "./types.js";

export interface RepriceEvent {
  key: string;
  jumpTs: number;
  jumpMagnitude: number;
}

export interface WindowPnlEntry {
  key: string;
  jumpTs: number;
  jumpMagnitude: number;
  windowEndTs: number;
  perMarket: Record<string, number>;
  totalPnl: number;
}

/** RunResult plus reprice-window diagnostics for cross-match measurement. */
export interface MakerRunResult extends RunResult {
  repriceEvents: RepriceEvent[];
  windowPnls: WindowPnlEntry[];
}

function defaultOutcomes(key: string): string[] {
  if (key.startsWith("1X2")) return ["part1", "draw", "part2"];
  return ["over", "under"];
}

function markToMarket(
  risk: RiskEngine,
  markets: ReturnType<FairBook["snapshot"]>["markets"],
): number {
  let total = 0;
  for (const [key, state] of Object.entries(markets)) {
    const pos = risk.getPosition(key);
    if (!pos) continue;
    total += pos.cash;
    for (const o of state.outcomes) {
      total += (pos.shares[o] ?? 0) * (state.fairProb[o] ?? 0);
    }
  }
  return total;
}

function totalExposure(
  risk: RiskEngine,
  markets: ReturnType<FairBook["snapshot"]>["markets"],
): number {
  let total = 0;
  for (const [key, state] of Object.entries(markets)) {
    total += risk.worstCaseLoss(key, state.outcomes);
  }
  return total;
}

function buildQuoteContexts(
  snap: ReturnType<FairBook["snapshot"]>,
  risk: RiskEngine,
  fairBook: FairBook,
  matchMs: number,
): MarketQuoteContext[] {
  const contexts: MarketQuoteContext[] = [];
  for (const [key, state] of Object.entries(snap.markets)) {
    if (!state.warm || !state.inRunning) continue;
    contexts.push({
      marketKey: key,
      quotes: risk.desiredQuotes(state, snap.game, matchMs, fairBook),
      fairProb: state.fairProb,
    });
  }
  return contexts;
}

function buildTick(
  matchMs: number,
  snap: ReturnType<FairBook["snapshot"]>,
  risk: RiskEngine,
  fairBook: FairBook,
  cumPnl: number,
  cumExposure: number,
): Tick {
  const perMarketFair: Tick["perMarketFair"] = {};
  const perMarketQuoteState: Tick["perMarketQuoteState"] = {};
  for (const [key, state] of Object.entries(snap.markets)) {
    perMarketFair[key] = { ...state.fairProb };
    const quotes = risk.desiredQuotes(state, snap.game, matchMs, fairBook);
    perMarketQuoteState[key] = {};
    for (const o of state.outcomes) {
      const q = quotes[o];
      perMarketQuoteState[key]![o] = {
        bid: q?.bid ?? 0,
        ask: q?.ask ?? 0,
        pulled: q?.pulled ?? true,
      };
    }
  }
  return {
    matchMin: matchMs / 60_000,
    matchMs,
    perMarketFair,
    perMarketQuoteState,
    cumPnl,
    cumExposure,
    scoreG1: snap.game.g1,
    scoreG2: snap.game.g2,
    scoreChanged: snap.scoreChanged,
  };
}

export function computeWindowPnls(
  fills: Fill[],
  events: RepriceEvent[],
  cooldownMs: number,
): WindowPnlEntry[] {
  return events.map((ev) => {
    const windowEndTs = ev.jumpTs + cooldownMs;
    const perMarket: Record<string, number> = {};
    for (const f of fills) {
      if (f.matchMs < ev.jumpTs || f.matchMs > windowEndTs) continue;
      perMarket[f.marketKey] =
        (perMarket[f.marketKey] ?? 0) + fillMakerCash(f);
    }
    const totalPnl = Object.values(perMarket).reduce((s, v) => s + v, 0);
    return {
      key: ev.key,
      jumpTs: ev.jumpTs,
      jumpMagnitude: ev.jumpMagnitude,
      windowEndTs,
      perMarket,
      totalPnl,
    };
  });
}

export async function runMaker(
  feed: FeedSource,
  fixtureMeta: FixtureMeta,
  cfg: RunConfig,
): Promise<MakerRunResult> {
  for (const m of DEFAULT_QUOTED_MARKETS) {
    const key = marketKeyFromParts(m.superType, m.period, m.line);
    void key;
  }

  const fairBook = new FairBook();
  fairBook.setStartMs(fixtureMeta.startMs);
  const risk = new RiskEngine(cfg);
  const rng = makeRng(cfg.seed);
  const fills: Fill[] = [];
  const timeline: Tick[] = [];
  const repriceEvents: RepriceEvent[] = [];
  const keys = quotedMarketKeys();

  for (const key of keys) {
    risk.initMarket(key, defaultOutcomes(key));
  }

  let lastMatchMs = 0;
  let lastSampleMs = -1_000;
  let started = false;

  return new Promise((resolve, reject) => {
    feed.on("event", (e) => {
      const matchMs = Math.max(0, e.ts - fixtureMeta.startMs);
      const elapsed = started ? matchMs - lastMatchMs : 0;

      if (elapsed > 0) {
        const preSnap = fairBook.snapshot();
        const contexts = buildQuoteContexts(preSnap, risk, fairBook, lastMatchMs);
        const newFills = simulateTakerFills(
          elapsed,
          lastMatchMs,
          contexts,
          cfg,
          rng,
        );
        for (const f of newFills) {
          risk.applyFill(f);
          fills.push(f);
        }
      }

      fairBook.onEvent(e);
      const snap = fairBook.snapshot();

      if (e.type === "odds" && isQuotedPayload(e.data)) {
        const key = marketKeyFromPayload(e.data);
        risk.initMarket(key, snap.markets[key]?.outcomes ?? defaultOutcomes(key));
        const jump = fairBook.getJump(key);
        if (jump > cfg.repriceJumpThreshold) {
          repriceEvents.push({ key, jumpTs: matchMs, jumpMagnitude: jump });
        }
        risk.onJump(key, matchMs, jump, false);
      }

      if (fairBook.scoreChanged) {
        risk.onScoreJumpAll(keys, matchMs);
      }

      lastMatchMs = matchMs;
      started = true;

      while (lastSampleMs + 1_000 <= matchMs) {
        lastSampleMs += 1_000;
        const cumPnl = markToMarket(risk, snap.markets);
        const cumExposure = totalExposure(risk, snap.markets);
        timeline.push(buildTick(matchMs, snap, risk, fairBook, cumPnl, cumExposure));
      }
    });

    feed.on("error", (err) => reject(err));

    feed.on("end", () => {
      const snap = fairBook.snapshot();
      const result = buildRunResult({
        config: cfg,
        fixtureId: fixtureMeta.fixtureId,
        markets: snap.markets,
        positions: risk.getAllPositions(),
        fills,
        protectEvents: risk.protectEventCount,
        timeline,
        finalGame: snap.game,
      });
      const windowPnls = computeWindowPnls(
        fills,
        repriceEvents,
        cfg.protectCooldownMs,
      );
      resolve({ ...result, repriceEvents, windowPnls });
    });

    void feed.start().catch(reject);
  });
}

export function saveRunResult(result: RunResult, dir = "runs"): string {
  mkdirSync(dir, { recursive: true });
  const prot = result.config.protectionEnabled ? 1 : 0;
  const path = `${dir}/${result.fixtureId}-${result.config.seed}-${prot}.json`;
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}
