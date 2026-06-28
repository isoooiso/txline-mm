import { TxlineSession } from "../auth/session.js";
import { createHttpClient } from "../client/httpClient.js";
import { getFixturesSnapshot } from "../client/fixtures.js";
import { loadStoredTokens } from "../config.js";
import { createReplayFeed } from "../feed/replayFeed.js";
import { deriveFairLines, formatFairLineCompact } from "../util/fairValue.js";

const PRE_MATCH_MS = 30 * 60_000;
const POST_MATCH_MS = 2.5 * 3_600_000;

async function main(): Promise<void> {
  const fixtureIdArg = process.argv[2];
  if (!fixtureIdArg) {
    console.error("Usage: npm run replay -- <fixtureId>");
    process.exit(1);
  }
  const fixtureId = Number(fixtureIdArg);
  if (!Number.isFinite(fixtureId)) {
    console.error("fixtureId must be a number");
    process.exit(1);
  }

  const tokens = loadStoredTokens();
  if (!tokens) {
    console.error("No tokens found — run: npm run bootstrap");
    process.exit(1);
  }

  const session = TxlineSession.load(tokens);
  const client = createHttpClient(session);
  const fixtures = await getFixturesSnapshot(client);
  const fixture = fixtures.find((f) => f.FixtureId === fixtureId);
  if (!fixture) {
    console.error(`Fixture ${fixtureId} not found in snapshot`);
    process.exit(1);
  }

  const startMs = fixture.StartTime - PRE_MATCH_MS;
  const endMs = fixture.StartTime + POST_MATCH_MS;

  console.log(
    `Replay ${fixture.Participant1} vs ${fixture.Participant2} (${fixtureId})`,
  );
  console.log(
    `Window: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}\n`,
  );

  let oddsCount = 0;
  let scoreCount = 0;
  let scoreShapeLogged = false;

  const feed = createReplayFeed(session, {
    fixtureId,
    startMs,
    endMs,
    speed: 0,
  });

  feed.on("event", (ev) => {
    if (ev.type === "odds") {
      oddsCount += 1;
      const line = deriveFairLines(ev.data);
      console.log(`[odds] ${formatFairLineCompact(line)}`);
    } else {
      scoreCount += 1;
      if (!scoreShapeLogged) {
        console.log("[score] sample shape:", JSON.stringify(ev.data));
        scoreShapeLogged = true;
      }
      console.log(`[score] ${JSON.stringify(ev.data)}`);
    }
  });

  feed.on("error", (err) => console.error("Feed error:", err));

  await new Promise<void>((resolve) => {
    feed.on("end", resolve);
    void feed.start();
  });

  console.log(`\nDone — odds: ${oddsCount}, scores: ${scoreCount}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
