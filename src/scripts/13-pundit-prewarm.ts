import "dotenv/config";
import { createFileReplayFeed } from "../feed/fileReplayFeed.js";
import { composeAlert } from "../pundit/compose.js";
import { PunditEventDetector } from "../pundit/events.js";
import { synthesizeSpeech } from "../pundit/tts.js";

function parseFixtureId(): string {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  return args[0] ?? "17588325";
}

async function main(): Promise<void> {
  const fixtureId = parseFixtureId();
  const path = `fixtures/${fixtureId}.json`;

  process.env.VOICE_ENABLED = "true";

  const feed = createFileReplayFeed(path, { speed: 0 });
  const teams = {
    p1: feed.captured.participants[0] ?? "Team 1",
    p2: feed.captured.participants[1] ?? "Team 2",
  };

  const detector = new PunditEventDetector();
  detector.setStartMs(feed.captured.startMs);
  detector.setTeams(teams.p1, teams.p2);
  detector.preloadScoreIncrements(feed.captured.scores, feed.captured.startMs);

  let prewarmed = 0;
  const chain: Promise<void>[] = [];

  detector.on("alert", (ev) => {
    chain.push(
      (async () => {
        const { text } = await composeAlert(ev, teams);
        const audio = await synthesizeSpeech(text);
        if (audio) prewarmed += 1;
        console.log(`[prewarm] ${ev.kind}: ${text}`);
      })(),
    );
  });

  detector.attach(feed);

  await new Promise<void>((resolve, reject) => {
    feed.on("end", () => resolve());
    feed.on("error", (err) => reject(err));
    feed.start().catch(reject);
  });

  await Promise.all(chain);

  console.log(`\nprewarmed ${prewarmed} audio files in pundit-audio/`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
