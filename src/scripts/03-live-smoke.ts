import { TxlineSession } from "../auth/session.js";
import { loadStoredTokens } from "../config.js";
import { createLiveFeed } from "../feed/liveFeed.js";
import { deriveFairLines, formatFairLineCompact } from "../util/fairValue.js";
import type { FeedEvent } from "../types.js";

const DURATION_SEC = Number(process.env.LIVE_SECONDS ?? 30);
const MAX_PRINT = Number(process.env.LIVE_MAX_EVENTS ?? 5);

async function main(): Promise<void> {
  const tokens = loadStoredTokens();
  if (!tokens) {
    console.error("No tokens found — run: npm run bootstrap");
    process.exit(1);
  }

  const session = TxlineSession.load(tokens);
  const feed = createLiveFeed(session);

  let oddsTotal = 0;
  let scoreTotal = 0;
  let oddsPrinted = 0;
  let scorePrinted = 0;
  const samples: FeedEvent[] = [];

  feed.on("event", (ev) => {
    if (ev.type === "odds") {
      oddsTotal += 1;
      if (oddsPrinted < MAX_PRINT) {
        oddsPrinted += 1;
        console.log(`[odds] ${formatFairLineCompact(deriveFairLines(ev.data))}`);
      }
    } else {
      scoreTotal += 1;
      if (scorePrinted < MAX_PRINT) {
        scorePrinted += 1;
        console.log(`[score] ${JSON.stringify(ev.data)}`);
      }
    }
    if (samples.length < MAX_PRINT * 2) samples.push(ev);
  });

  feed.on("error", (err) => {
    console.error("[feed error]", err.message);
  });

  console.log(`Live feed for ${DURATION_SEC}s …\n`);
  await feed.start();

  await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));
  feed.stop();

  console.log(
    `\nCounters — odds: ${oddsTotal}, scores: ${scoreTotal} (printed first ${MAX_PRINT} each)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
