import type { Quote, RunConfig } from "./types.js";

const EPS = 0.001;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Symmetric quote around inventory-skewed center.
 * Consensus Pct is already demargined — the half-spread δ is the maker's entire edge.
 */
export function quote(
  fairP: number,
  center: number,
  cfg: RunConfig,
  outcome: string,
): Quote {
  const delta = cfg.halfSpread;
  const bid = clamp(center - delta, EPS, 1 - EPS);
  const ask = clamp(center + delta, EPS, 1 - EPS);
  return {
    outcome,
    bid,
    ask,
    bidOdds: 1 / bid,
    askOdds: 1 / ask,
    pulled: false,
    bidPulled: false,
    askPulled: false,
  };
}

export function pullQuote(outcome: string): Quote {
  return {
    outcome,
    bid: 0,
    ask: 0,
    bidOdds: 0,
    askOdds: 0,
    pulled: true,
    bidPulled: true,
    askPulled: true,
  };
}

export function suppressBid(q: Quote): Quote {
  return { ...q, bid: 0, bidOdds: 0, bidPulled: true, pulled: q.askPulled };
}

export function suppressAsk(q: Quote): Quote {
  return { ...q, ask: 0, askOdds: 0, askPulled: true, pulled: q.bidPulled };
}
