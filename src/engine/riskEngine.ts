import type {
  Fill,
  GameSnapshot,
  MarketState,
  Position,
  Quote,
  RunConfig,
} from "./types.js";
import { pullQuote, quote, suppressAsk, suppressBid } from "./quoter.js";
import type { FairBook } from "./fairBook.js";

const SUSPENDED_PHASES = new Set([3, 14, 15]);

function emptyPosition(outcomes: string[]): Position {
  return {
    shares: Object.fromEntries(outcomes.map((o) => [o, 0])),
    cash: 0,
  };
}

export class RiskEngine {
  private readonly positions = new Map<string, Position>();
  private readonly protectUntil = new Map<string, number>();
  protectEventCount = 0;

  constructor(private readonly cfg: RunConfig) {}

  initMarket(key: string, outcomes: string[]): void {
    if (!this.positions.has(key)) {
      this.positions.set(key, emptyPosition(outcomes));
    }
  }

  onJump(key: string, nowMatchMs: number, jump: number, scoreChanged: boolean): void {
    if (!this.cfg.protectionEnabled) return;
    if (scoreChanged || jump > this.cfg.repriceJumpThreshold) {
      this.protectUntil.set(key, nowMatchMs + this.cfg.protectCooldownMs);
      this.protectEventCount += 1;
    }
  }

  onScoreJumpAll(keys: string[], nowMatchMs: number): void {
    for (const key of keys) {
      this.onJump(key, nowMatchMs, 0, true);
    }
  }

  desiredQuotes(
    state: MarketState,
    game: GameSnapshot,
    nowMatchMs: number,
    fairBook: FairBook,
  ): Record<string, Quote> {
    const pos = this.positions.get(state.key) ?? emptyPosition(state.outcomes);
    const result: Record<string, Quote> = {};

    if (!state.inRunning || !state.warm) {
      for (const o of state.outcomes) result[o] = pullQuote(o);
      return result;
    }

    if (game.phaseId !== undefined && SUSPENDED_PHASES.has(game.phaseId)) {
      for (const o of state.outcomes) result[o] = pullQuote(o);
      return result;
    }

    const inCooldown =
      (this.protectUntil.get(state.key) ?? 0) > nowMatchMs;

    const lagMs = Math.max(0, nowMatchMs - this.cfg.quoteLatencyMs);
    const laggedFair = fairBook.fairAsOf(state.key, lagMs);

    for (const o of state.outcomes) {
      if (inCooldown) {
        result[o] = pullQuote(o);
        continue;
      }

      const fairForQuote = laggedFair?.[o] ?? state.fairProb[o] ?? 0;
      const center =
        fairForQuote - this.cfg.inventorySkewK * (pos.shares[o] ?? 0);
      let q = quote(fairForQuote, center, this.cfg, o);

      if ((pos.shares[o] ?? 0) >= this.cfg.maxOutcomePos) {
        q = suppressAsk(q);
      }
      if ((pos.shares[o] ?? 0) <= -this.cfg.maxOutcomePos) {
        q = suppressBid(q);
      }

      if (this.wouldBreachCap(state.key, o, "takerBuy", q.ask, this.cfg.takerSize)) {
        q = suppressAsk(q);
      }
      if (this.wouldBreachCap(state.key, o, "takerSell", q.bid, this.cfg.takerSize)) {
        q = suppressBid(q);
      }

      result[o] = q;
    }

    return result;
  }

  applyFill(fill: Fill): void {
    const pos = this.positions.get(fill.marketKey);
    if (!pos) return;

    if (fill.side === "takerBuy") {
      pos.shares[fill.outcome] = (pos.shares[fill.outcome] ?? 0) - fill.size;
      pos.cash += fill.price * fill.size;
    } else {
      pos.shares[fill.outcome] = (pos.shares[fill.outcome] ?? 0) + fill.size;
      pos.cash -= fill.price * fill.size;
    }
  }

  worstCaseLoss(key: string, outcomes: string[]): number {
    const pos = this.positions.get(key);
    if (!pos) return 0;
    let minPnl = Infinity;
    for (const winner of outcomes) {
      let pnl = pos.cash;
      for (const o of outcomes) {
        pnl += (pos.shares[o] ?? 0) * (o === winner ? 1 : 0);
      }
      minPnl = Math.min(minPnl, pnl);
    }
    return minPnl === Infinity ? 0 : -minPnl;
  }

  getPosition(key: string): Position | undefined {
    return this.positions.get(key);
  }

  getAllPositions(): Map<string, Position> {
    return this.positions;
  }

  private wouldBreachCap(
    key: string,
    outcome: string,
    side: Fill["side"],
    price: number,
    size: number,
  ): boolean {
    if (price <= 0) return false;
    const pos = this.positions.get(key);
    if (!pos) return false;

    const sim: Position = {
      cash: pos.cash,
      shares: { ...pos.shares },
    };
    if (side === "takerBuy") {
      sim.shares[outcome] = (sim.shares[outcome] ?? 0) - size;
      sim.cash += price * size;
    } else {
      sim.shares[outcome] = (sim.shares[outcome] ?? 0) + size;
      sim.cash -= price * size;
    }

    const outcomes = Object.keys(sim.shares);
    let minPnl = Infinity;
    for (const winner of outcomes) {
      let pnl = sim.cash;
      for (const o of outcomes) {
        pnl += (sim.shares[o] ?? 0) * (o === winner ? 1 : 0);
      }
      minPnl = Math.min(minPnl, pnl);
    }
    const loss = minPnl === Infinity ? 0 : -minPnl;
    return loss > this.cfg.maxMarketLoss;
  }
}
