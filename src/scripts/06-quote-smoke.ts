import { createFileReplayFeed } from "../feed/fileReplayFeed.js";
import { FairBook } from "../engine/fairBook.js";
import { quote } from "../engine/quoter.js";
import { DEFAULT_RUN_CONFIG, marketKeyFromParts } from "../engine/types.js";
import type { MarketState } from "../engine/types.js";

const KEY_1X2 = marketKeyFromParts("1X2_PARTICIPANT_RESULT", "FT", null);
const KEY_OU25 = marketKeyFromParts("OVERUNDER_PARTICIPANT_GOALS", "FT", 2.5);

interface GoalSnap {
  matchMin: number;
  s1: MarketState;
  sOu: MarketState;
}

function fmtProb(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function printQuotes(
  label: string,
  matchMin: number,
  state: MarketState,
): void {
  console.log(`\n--- ${label} @ matchMin=${matchMin.toFixed(1)} ---`);
  for (const o of state.outcomes) {
    const fair = state.fairProb[o] ?? 0;
    const q = quote(fair, fair, DEFAULT_RUN_CONFIG, o);
    console.log(
      `  ${o}: fair=${fmtProb(fair)}  bid=${q.bid.toFixed(3)}/${q.bidOdds.toFixed(2)}  ask=${q.ask.toFixed(3)}/${q.askOdds.toFixed(2)}`,
    );
  }
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => a !== "--");
  const fixtureId = arg ?? "17588404";
  const path = `fixtures/${fixtureId}.json`;

  const feed = createFileReplayFeed(path, { speed: 0 });
  const fairBook = new FairBook();
  const startMs = feed.captured.startMs;

  let prevG2 = 0;
  const goalSnaps: { before: GoalSnap | null; after: GoalSnap | null } = {
    before: null,
    after: null,
  };
  let printedInPlay = 0;

  feed.on("event", (e) => {
    const matchMin = (e.ts - startMs) / 60_000;
    const snap = fairBook.snapshot();

    const s1 = fairBook.getMarket(KEY_1X2);
    const sOu = fairBook.getMarket(KEY_OU25);
    if (s1?.inRunning && sOu?.inRunning && snap.game.g2 === prevG2 && !goalSnaps.before) {
      goalSnaps.before = {
        matchMin,
        s1: { ...s1, fairProb: { ...s1.fairProb } },
        sOu: { ...sOu, fairProb: { ...sOu.fairProb } },
      };
    }

    fairBook.onEvent(e);
    const post = fairBook.snapshot();

    if (post.game.g2 > prevG2) {
      const ps1 = fairBook.getMarket(KEY_1X2);
      const psOu = fairBook.getMarket(KEY_OU25);
      if (ps1 && psOu) {
        goalSnaps.after = {
          matchMin,
          s1: { ...ps1, fairProb: { ...ps1.fairProb } },
          sOu: { ...psOu, fairProb: { ...psOu.fairProb } },
        };
      }
    }
    prevG2 = post.game.g2;

    const s1p = fairBook.getMarket(KEY_1X2);
    const sOup = fairBook.getMarket(KEY_OU25);
    if (!s1p?.inRunning || !sOup?.inRunning) return;

    if (printedInPlay < 2) {
      printQuotes("in-play sample", matchMin, s1p);
      printQuotes("O/U 2.5", matchMin, sOup);
      printedInPlay += 1;
    }
  });

  await new Promise<void>((resolve) => {
    feed.on("end", resolve);
    void feed.start();
  });

  const bg = goalSnaps.before;
  const ag = goalSnaps.after;
  if (bg && ag) {
    console.log("\n=== Around first goal ===");
    printQuotes("1X2 BEFORE goal", bg.matchMin, bg.s1);
    printQuotes("1X2 AFTER goal", ag.matchMin, ag.s1);
    printQuotes("O/U 2.5 BEFORE", bg.matchMin, bg.sOu);
    printQuotes("O/U 2.5 AFTER", ag.matchMin, ag.sOu);
  }

  const final = fairBook.snapshot();
  console.log(
    `\nFinal score: ${final.game.g1}-${final.game.g2} (Stats keys 1/2)`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
