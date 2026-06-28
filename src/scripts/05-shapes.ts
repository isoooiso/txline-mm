import { readFileSync } from "node:fs";

const id = process.argv[2] ?? "17588404";
const d: any = JSON.parse(readFileSync(`fixtures/${id}.json`, "utf8"));
const line = (s: string) => console.log("\n=== " + s + " ===");

line("RAW OddsPayload[0]");
console.log(JSON.stringify(d.odds[0], null, 2));

line("RAW ScorePayload[0]");
console.log(JSON.stringify(d.scores[0], null, 2));

line("FINAL ScorePayload (result repr)");
console.log(JSON.stringify(d.scores[d.scores.length - 1], null, 2));

line("DISTINCT MARKETS (SuperOddsType :: Period :: Params :: PriceNames :: InRunning : count)");
const t = new Map<string, number>();

for (const o of d.odds as any[]) {
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
  .forEach(([k, n]) => console.log(String(n).padStart(6), k));

line("COUNTS");
console.log(`odds=${d.odds.length}  scores=${d.scores.length}`);
