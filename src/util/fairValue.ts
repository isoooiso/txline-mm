import type { FairLine, OddsPayload } from "../types.js";

export function deriveFairLines(payload: OddsPayload): FairLine {
  const outcomes = payload.PriceNames.flatMap((name, i) => {
    const pct = payload.Pct[i];
    if (pct === undefined || pct === "NA") return [];
    const fairProb = Number(pct) / 100;
    if (!Number.isFinite(fairProb) || fairProb <= 0) return [];
    return [
      {
        name,
        fairProb,
        fairOdds: 1 / fairProb,
        rawPrice: payload.Prices[i] ?? null,
      },
    ];
  });

  return {
    fixtureId: payload.FixtureId,
    market: payload.SuperOddsType,
    period: payload.MarketPeriod,
    params: payload.MarketParameters,
    inRunning: payload.InRunning,
    ts: payload.Ts,
    messageId: payload.MessageId,
    outcomes,
  };
}

export function formatFairLineCompact(line: FairLine): string {
  const outcomes = line.outcomes
    .map(
      (o) =>
        `${o.name}@${o.fairOdds.toFixed(3)}(${(o.fairProb * 100).toFixed(1)}%)`,
    )
    .join(", ");
  return `${line.market}/${line.period}/${line.params} → ${outcomes}`;
}
