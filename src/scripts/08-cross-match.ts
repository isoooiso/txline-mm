import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFileReplayFeed } from "../feed/fileReplayFeed.js";
import { DEFAULT_RUN_CONFIG, type RunConfig } from "../engine/types.js";
import {
  aggregateWindows,
  type CrossMatchPair,
} from "../engine/metrics.js";
import { runMaker } from "../engine/runner.js";

function parseArgs(): {
  fixtureIds: string[] | null;
  seeds: number[];
  quoteLatencyMs: number;
} {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let seedCount = 50;
  let quoteLatencyMs = DEFAULT_RUN_CONFIG.quoteLatencyMs;
  let explicitSeeds: number[] | null = null;
  const explicitFixtures: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--seeds" && args[i + 1]) {
      const val = args[i + 1]!;
      if (val.includes(",")) {
        explicitSeeds = val.split(",").map(Number);
      } else {
        seedCount = Number(val);
      }
      i += 1;
    } else if (a === "--quote-latency" && args[i + 1]) {
      quoteLatencyMs = Number(args[i + 1]);
      i += 1;
    } else if (!a.startsWith("-")) {
      explicitFixtures.push(a.replace(/\.json$/, ""));
    }
  }

  const seeds =
    explicitSeeds ?? Array.from({ length: seedCount }, (_, i) => i + 1);

  return {
    fixtureIds: explicitFixtures.length > 0 ? explicitFixtures : null,
    seeds,
    quoteLatencyMs,
  };
}

function discoverFixtures(explicit: string[] | null): string[] {
  if (explicit && explicit.length > 0) return explicit;
  const dir = "fixtures";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

async function runOnce(
  fixtureId: string,
  seed: number,
  protectionEnabled: boolean,
  quoteLatencyMs: number,
) {
  const path = `fixtures/${fixtureId}.json`;
  const feed = createFileReplayFeed(path, { speed: 0 });
  const cfg: RunConfig = {
    ...DEFAULT_RUN_CONFIG,
    seed,
    speed: 0,
    protectionEnabled,
    quoteLatencyMs,
  };
  const meta = {
    fixtureId: feed.captured.fixtureId,
    startMs: feed.captured.startMs,
    participants: feed.captured.participants as [string, string],
  };
  return runMaker(feed, meta, cfg);
}

async function main(): Promise<void> {
  const { fixtureIds: explicit, seeds, quoteLatencyMs } = parseArgs();
  const fixtureIds = discoverFixtures(explicit);

  if (fixtureIds.length === 0) {
    console.error("No fixture files found in fixtures/");
    process.exit(1);
  }

  console.log(
    `Cross-match sweep: ${fixtureIds.length} fixture(s), ${seeds.length} seeds, quoteLatencyMs=${quoteLatencyMs}\n`,
  );

  const pairs: CrossMatchPair[] = [];

  for (const fixtureId of fixtureIds) {
    for (const seed of seeds) {
      const off = await runOnce(fixtureId, seed, false, quoteLatencyMs);
      const on = await runOnce(fixtureId, seed, true, quoteLatencyMs);
      pairs.push({
        fixtureId: Number(fixtureId),
        seed,
        off,
        on,
      });
    }
  }

  const aggregate = aggregateWindows(pairs);

  mkdirSync("runs", { recursive: true });
  const outPath = join("runs", "cross-match-aggregate.json");
  writeFileSync(outPath, JSON.stringify(aggregate, null, 2));

  console.log("=== Per-fixture (whole-match ΔrealizedPnl — noisy / context only) ===");
  for (const fx of aggregate.perFixture) {
    console.log(
      `  ${fx.fixtureId}  score=${fx.score}  repriceEvents=${fx.repriceEventCount}  Δpnl=${fx.wholeMatchDeltaPnl.toFixed(4)}`,
    );
  }

  console.log("\n=== Pooled reprice-window result ===");
  const wd = aggregate.windowDelta;
  console.log(`n=${aggregate.n}`);
  console.log(
    `windowDelta (ON−OFF): mean=${wd.mean.toFixed(4)} std=${wd.std.toFixed(4)} SEM=${wd.sem.toFixed(4)}`,
  );
  console.log(
    `95% CI: [${wd.ci95Low.toFixed(4)}, ${wd.ci95High.toFixed(4)}]  fraction>0=${(aggregate.fractionPositive * 100).toFixed(1)}%`,
  );
  console.log(
    `p5/p50/p95: ${wd.p5.toFixed(4)} / ${wd.p50.toFixed(4)} / ${wd.p95.toFixed(4)}`,
  );

  console.log("\n=== Left tail (window fill cash) ===");
  console.log(
    `offWindowPnl p5=${aggregate.leftTail.offP5.toFixed(4)}  onWindowPnl p5=${aggregate.leftTail.onP5.toFixed(4)}`,
  );

  const wm = aggregate.wholeMatch;
  console.log(
    `\n=== Whole-match (${wm.label}) === mean OFF=${wm.offMean.toFixed(4)} ON=${wm.onMean.toFixed(4)} Δ=${wm.deltaMean.toFixed(4)}`,
  );

  console.log(`\n=== Read ===\n${aggregate.honestRead}`);
  console.log(`\nSaved: ${outPath}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
