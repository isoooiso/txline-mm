import "dotenv/config";
import { createFileReplayFeed } from "../feed/fileReplayFeed.js";
import {
  DEFAULT_PUNDIT_RUN_CONFIG,
  drainSendQueue,
  resetSendQueue,
  runPundit,
} from "../pundit/runner.js";

function parseArgs(): { fixtureId: string; speed: number } {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  return {
    fixtureId: args[0] ?? "17588325",
    speed: args[1] ? Number(args[1]) : DEFAULT_PUNDIT_RUN_CONFIG.speed,
  };
}

async function main(): Promise<void> {
  const { fixtureId, speed } = parseArgs();
  const path = `fixtures/${fixtureId}.json`;

  console.log(`Pundit replay: fixture ${fixtureId}, speed=${speed}x\n`);

  resetSendQueue();
  const feed = createFileReplayFeed(path, { speed });
  await runPundit(
    feed,
    {
      fixtureId: feed.captured.fixtureId,
      participants: feed.captured.participants,
      startMs: feed.captured.startMs,
      scores: feed.captured.scores,
    },
    { speed },
  );

  await new Promise<void>((resolve, reject) => {
    feed.on("end", () => resolve());
    feed.on("error", (err) => reject(err));
    feed.start().catch(reject);
  });

  await drainSendQueue();
  console.log("\nPundit replay finished.");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
