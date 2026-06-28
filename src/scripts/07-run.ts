import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFileReplayFeed } from "../feed/fileReplayFeed.js";
import { TXLINE_NETWORK } from "../config.js";
import {
  DEFAULT_RUN_CONFIG,
  quotedMarketKeys,
  type RunConfig,
  type RunResult,
  type SweepConfig,
} from "../engine/types.js";
import {
  aggregateSeeds,
  buildDashboardPayload,
  formatDist,
  type SeedPairResult,
} from "../engine/metrics.js";
import type { DistributionStats } from "../engine/types.js";
import { runMaker, saveRunResult } from "../engine/runner.js";
import {
  winningOutcome1x2,
  winningOutcomeOverUnder,
} from "../engine/settlement.js";

function parseArgs(): {
  fixtureId: string;
  seeds: number[];
  quoteLatencyMs: number;
} {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let fixtureId = "17588404";
  let seedCount = 100;
  let quoteLatencyMs = DEFAULT_RUN_CONFIG.quoteLatencyMs;
  let explicitSeeds: number[] | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-")) {
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
      } else if (a === "--seed" && args[i + 1]) {
        explicitSeeds = [Number(args[i + 1])];
        i += 1;
      }
    } else {
      positional.push(a);
    }
  }

  if (positional.length > 0) fixtureId = positional[0]!;

  if (explicitSeeds === null && positional.length >= 2) {
    const n = Number(positional[1]);
    if (Number.isFinite(n)) {
      if (positional.length >= 3) {
        explicitSeeds = [n];
        quoteLatencyMs = Number(positional[2]!) ?? quoteLatencyMs;
      } else {
        seedCount = n;
      }
    }
  }

  const seeds =
    explicitSeeds ?? Array.from({ length: seedCount }, (_, i) => i + 1);
  return { fixtureId, seeds, quoteLatencyMs };
}

function runOnce(
  fixtureId: string,
  seed: number,
  protectionEnabled: boolean,
  quoteLatencyMs: number,
): Promise<RunResult> {
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

function printMetricRow(
  label: string,
  off: DistributionStats,
  on: DistributionStats,
): void {
  console.log(
    `${label.padEnd(18)} OFF ${formatDist(off)}  |  ON ${formatDist(on)}`,
  );
}

async function main(): Promise<void> {
  const { fixtureId, seeds, quoteLatencyMs } = parseArgs();

  console.log(
    `Sweep fixture ${fixtureId}: ${seeds.length} seeds, quoteLatencyMs=${quoteLatencyMs}\n`,
  );

  const pairs: SeedPairResult[] = [];
  for (const seed of seeds) {
    const off = await runOnce(fixtureId, seed, false, quoteLatencyMs);
    const on = await runOnce(fixtureId, seed, true, quoteLatencyMs);
    pairs.push({ seed, off, on });
    if (seed === seeds[0] || seed === seeds[seeds.length - 1]) {
      saveRunResult(off);
      saveRunResult(on);
    }
  }

  const { seed: _drop, ...sweepBase } = DEFAULT_RUN_CONFIG;
  const sweep: SweepConfig = {
    ...sweepBase,
    quoteLatencyMs,
    seeds,
  };

  const aggregate = aggregateSeeds(pairs, sweep, Number(fixtureId));

  const captured = createFileReplayFeed(`fixtures/${fixtureId}.json`, {
    speed: 0,
  }).captured;
  const dashboard = buildDashboardPayload({
    aggregate,
    pairs,
    fixtureId: Number(fixtureId),
    participant1: captured.participants[0] ?? "part1",
    participant2: captured.participants[1] ?? "part2",
    oddsCount: captured.odds.length,
    network: TXLINE_NETWORK,
    marketKeys: quotedMarketKeys(),
  });

  mkdirSync("runs", { recursive: true });
  mkdirSync("dashboard/public", { recursive: true });
  const aggPath = `runs/aggregate-${fixtureId}.json`;
  const dashPath = `runs/dashboard-${fixtureId}.json`;
  const dashPublic = join("dashboard", "public", `dashboard-${fixtureId}.json`);
  writeFileSync(aggPath, JSON.stringify(aggregate, null, 2));
  writeFileSync(dashPath, JSON.stringify(dashboard));
  writeFileSync(dashPublic, JSON.stringify(dashboard));

  const g = pairs[0]!.off.finalGameState;
  console.log("=== Settlement check (Stats keys 1/2) ===");
  console.log(`Final: ${g.g1}-${g.g2}`);
  console.log(`1X2 winner: ${winningOutcome1x2(g.g1, g.g2)}`);
  console.log(`O/U 1.5: ${winningOutcomeOverUnder(g.g1, g.g2, 1.5)}`);
  console.log(`O/U 2.5: ${winningOutcomeOverUnder(g.g1, g.g2, 2.5)}`);

  console.log("\n=== Aggregate (protection OFF vs ON) ===");
  const m = aggregate.metrics;
  printMetricRow("realizedPnl", m.realizedPnl.off, m.realizedPnl.on);
  printMetricRow("spreadCaptured", m.spreadCaptured.off, m.spreadCaptured.on);
  printMetricRow("inventoryPnl", m.inventoryPnl.off, m.inventoryPnl.on);
  printMetricRow("maxExposure", m.maxExposure.off, m.maxExposure.on);
  printMetricRow("protectEvents", m.protectEvents.off, m.protectEvents.on);
  printMetricRow("fills", m.fills.off, m.fills.on);

  console.log("\n=== Delta summary (ON − OFF, paired per seed) ===");
  const d = aggregate.delta;
  console.log(
    `mean ΔrealizedPnl=${d.meanDelta.realizedPnl.toFixed(4)}  Δinv=${d.meanDelta.inventoryPnl.toFixed(4)}  Δexposure=${d.meanDelta.maxExposure.toFixed(4)}`,
  );
  console.log(
    `ΔrealizedPnl dist: ${formatDist(d.realizedPnl)}  |  protection wins: ${(d.fractionOnWinsRealizedPnl * 100).toFixed(1)}%`,
  );
  console.log(
    `spreadCaptured mean diff (ON−OFF): ${aggregate.spreadCapturedMeanDiff.toFixed(4)} (≈0 ⇒ protection doesn't cost spread)`,
  );

  const lt = aggregate.leftTail;
  console.log("\n=== Left tail ===");
  console.log(
    `worst realizedPnl  OFF=${lt.worstRealizedPnlOff.toFixed(4)}  ON=${lt.worstRealizedPnlOn.toFixed(4)}  (higher is better)`,
  );
  console.log(
    `maxExposure p95    OFF=${lt.maxExposureP95Off.toFixed(4)}  ON=${lt.maxExposureP95On.toFixed(4)}  (lower is better)`,
  );

  console.log(`\n=== Read ===\n${dashboard.honestRead}`);
  console.log(
    `\nSaved: ${aggPath}, ${dashPath}, ${dashPublic} (+ representative per-seed runs)`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
