import { writeFileSync, mkdirSync } from "node:fs";
import { TxlineSession } from "../auth/session.js";
import { createHttpClient } from "../client/httpClient.js";
import { getFixturesSnapshot } from "../client/fixtures.js";
import { getOddsInterval } from "../client/odds.js";
import {
  getScoresHistorical,
  getScoresInterval,
  scoreEventTs,
  scoreFixtureId,
} from "../client/scores.js";
import { loadStoredTokens } from "../config.js";
import { enumerateIntervals } from "../util/epochTime.js";
import type { OddsPayload, ScorePayload, FixturePayload } from "../types.js";

const arg = process.argv.slice(2).find((a) => a !== "--");
const fixtureId = Number(arg ?? 17588404);

async function main(): Promise<void> {
  const tokens = loadStoredTokens();
  if (!tokens) {
    console.error("No tokens found — run: npm run bootstrap");
    process.exit(1);
  }

  const session = TxlineSession.load(tokens);
  const client = createHttpClient(session);

  const fixtures: FixturePayload[] = await getFixturesSnapshot(client);
  const fx = fixtures.find((f) => f.FixtureId === fixtureId);
  if (!fx) throw new Error(`fixture ${fixtureId} not in snapshot`);

  const startMs = Number(fx.StartTime);
  const preMs = startMs - 10 * 60_000;
  const endMs = startMs + 150 * 60_000;

  const odds: OddsPayload[] = [];
  for (const { epochDay, hour, interval } of enumerateIntervals(preMs, endMs)) {
    const batch = await getOddsInterval(client, epochDay, hour, interval);
    for (const o of batch) {
      if (o.FixtureId === fixtureId) odds.push(o);
    }
  }
  odds.sort((a, b) => Number(a.Ts) - Number(b.Ts));

  let scores: ScorePayload[] = [];
  try {
    scores = await getScoresHistorical(client, fixtureId);
  } catch {
    scores = [];
  }
  if (scores.length === 0) {
    for (const { epochDay, hour, interval } of enumerateIntervals(preMs, endMs)) {
      const batch = await getScoresInterval(client, epochDay, hour, interval);
      for (const row of batch) {
        if (scoreFixtureId(row) === fixtureId) scores.push(row);
      }
    }
    scores.sort((a, b) => scoreEventTs(a) - scoreEventTs(b));
  }

  mkdirSync("fixtures", { recursive: true });
  writeFileSync(
    `fixtures/${fixtureId}.json`,
    JSON.stringify(
      {
        fixtureId,
        participants: [fx.Participant1, fx.Participant2],
        startMs,
        endMs,
        odds,
        scores,
      },
      null,
      2,
    ),
  );

  const hdr = (s: string) => console.log("\n=== " + s + " ===");
  hdr("RAW OddsPayload[0]");
  console.log(JSON.stringify(odds[0], null, 2));
  hdr("RAW ScorePayload[0]");
  console.log(JSON.stringify(scores[0], null, 2));
  hdr("FINAL ScorePayload (result repr)");
  console.log(JSON.stringify(scores.at(-1), null, 2));

  hdr(
    "DISTINCT MARKETS  (SuperOddsType | Period | Params | PriceNames | InRunning : count)",
  );
  const t = new Map<string, number>();
  for (const o of odds) {
    const k = [
      o.SuperOddsType,
      o.MarketPeriod,
      o.MarketParameters,
      (o.PriceNames ?? []).join("|"),
      o.InRunning,
    ].join("  ::  ");
    t.set(k, (t.get(k) ?? 0) + 1);
  }
  [...t.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`${String(n).padStart(5)}  ${k}`));

  hdr("COUNTS");
  console.log(
    `odds=${odds.length}  scores=${scores.length}  ->  fixtures/${fixtureId}.json`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
