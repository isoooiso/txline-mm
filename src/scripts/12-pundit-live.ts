import "dotenv/config";
import { existsSync } from "node:fs";
import { TxlineSession } from "../auth/session.js";
import { loadStoredTokens } from "../config.js";
import { createLiveFeed } from "../feed/liveFeed.js";
import { loadCapturedFixture } from "../feed/fileReplayFeed.js";
import {
  drainSendQueue,
  resetSendQueue,
  runPundit,
} from "../pundit/runner.js";

function parseFixtureId(): number {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const id = Number(args[0]);
  if (!Number.isFinite(id)) {
    throw new Error("Usage: npm run pundit-live -- <fixtureId>");
  }
  return id;
}

async function main(): Promise<void> {
  const fixtureId = parseFixtureId();
  const capturePath = `fixtures/${fixtureId}.json`;
  if (!existsSync(capturePath)) {
    throw new Error(
      `Need ${capturePath} for participant names and startMs (run capture first)`,
    );
  }
  const captured = loadCapturedFixture(capturePath);

  const tokens = loadStoredTokens();
  if (!tokens) {
    throw new Error("No tokens — run: npm run bootstrap");
  }

  console.log(`Pundit live: fixture ${fixtureId}\n`);

  resetSendQueue();
  const session = TxlineSession.load(tokens);
  const feed = createLiveFeed(session);

  await runPundit(
    feed,
    {
      fixtureId: captured.fixtureId,
      participants: captured.participants,
      startMs: captured.startMs,
      scores: captured.scores,
    },
    {},
  );

  feed.on("error", (err) => console.error("[feed]", err.message));

  await feed.start();
  console.log("Live pundit running — Ctrl+C to stop.\n");

  await new Promise<void>(() => {
    /* run until interrupted */
  });
}

main().catch(async (e: unknown) => {
  console.error(e);
  await drainSendQueue();
  process.exit(1);
});
