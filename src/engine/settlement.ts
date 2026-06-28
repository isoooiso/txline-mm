import type { GameSnapshot, MarketState, Position } from "./types.js";

export function winningOutcome1x2(g1: number, g2: number): string {
  if (g1 > g2) return "part1";
  if (g1 === g2) return "draw";
  return "part2";
}

export function winningOutcomeOverUnder(
  g1: number,
  g2: number,
  line: number,
): string {
  return g1 + g2 > line ? "over" : "under";
}

export function settleMarket(
  state: MarketState,
  position: Position,
  game: GameSnapshot,
): { winningOutcome: string; realizedPnl: number } {
  let winner: string;
  if (state.superType === "1X2_PARTICIPANT_RESULT") {
    winner = winningOutcome1x2(game.g1, game.g2);
  } else if (state.superType === "OVERUNDER_PARTICIPANT_GOALS") {
    winner = winningOutcomeOverUnder(game.g1, game.g2, state.line ?? 0);
  } else {
    winner = state.outcomes[0] ?? "";
  }

  let realizedPnl = position.cash;
  for (const o of state.outcomes) {
    realizedPnl += (position.shares[o] ?? 0) * (o === winner ? 1 : 0);
  }

  return { winningOutcome: winner, realizedPnl };
}

export function settleAll(
  markets: Record<string, MarketState>,
  positions: Map<string, Position>,
  game: GameSnapshot,
): Record<string, { winningOutcome: string; realizedPnl: number }> {
  const out: Record<string, { winningOutcome: string; realizedPnl: number }> =
    {};
  for (const [key, state] of Object.entries(markets)) {
    const pos = positions.get(key);
    if (!pos) continue;
    out[key] = settleMarket(state, pos, game);
  }
  return out;
}
