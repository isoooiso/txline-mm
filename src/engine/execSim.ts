/**
 * Simulated taker flow — NO real venue. Venue-agnostic Poisson-arrival model.
 *
 * Takers arrive at rate takerLambdaPerMin (per market, scaled to elapsed match-time).
 * Each arrival picks a random outcome and compares a noisy perception of CURRENT fair
 * to the maker quote. Adverse selection emerges because the maker quotes off lagged fair
 * (quoteLatencyMs) while takers act on current fair — stale quotes get picked off after jumps.
 *
 * RNG draws (outcome index + perceived noise) are consumed unconditionally on every arrival
 * so OFF and ON runs share an identical arrival/perception stream for the same seed.
 */
import type { Fill, Quote, RunConfig } from "./types.js";
import type { Rng } from "../util/rng.js";

export interface MarketQuoteContext {
  marketKey: string;
  quotes: Record<string, Quote>;
  fairProb: Record<string, number>;
}

export function simulateTakerFills(
  elapsedMatchMs: number,
  matchMs: number,
  markets: MarketQuoteContext[],
  cfg: RunConfig,
  rng: Rng,
): Fill[] {
  if (elapsedMatchMs <= 0) return [];

  const fills: Fill[] = [];
  const elapsedMin = elapsedMatchMs / 60_000;
  const lambda = cfg.takerLambdaPerMin * elapsedMin;

  for (const m of markets) {
    const arrivals = rng.poisson(lambda);
    const outcomes = Object.keys(m.quotes);
    if (outcomes.length === 0) continue;

    for (let i = 0; i < arrivals; i++) {
      const o = outcomes[Math.floor(rng.next() * outcomes.length)]!;
      const fair = m.fairProb[o] ?? 0;
      const perceived = fair + rng.normal() * cfg.takerNoiseSd;

      const q = m.quotes[o];
      if (!q || q.pulled) continue;

      if (!q.askPulled && q.ask > 0 && perceived > q.ask) {
        fills.push({
          ts: matchMs,
          matchMs,
          marketKey: m.marketKey,
          outcome: o,
          side: "takerBuy",
          price: q.ask,
          size: cfg.takerSize,
          fairAtFill: fair,
        });
      } else if (!q.bidPulled && q.bid > 0 && perceived < q.bid) {
        fills.push({
          ts: matchMs,
          matchMs,
          marketKey: m.marketKey,
          outcome: o,
          side: "takerSell",
          price: q.bid,
          size: cfg.takerSize,
          fairAtFill: fair,
        });
      }
    }
  }

  return fills;
}

export function spreadContribution(fill: Fill): number {
  return Math.abs(fill.price - fill.fairAtFill) * fill.size;
}

/** Immediate maker cash impact from a fill (window P&L building block). */
export function fillMakerCash(fill: Fill): number {
  return fill.side === "takerBuy"
    ? fill.price * fill.size
    : -(fill.price * fill.size);
}
