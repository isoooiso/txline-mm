import { readFileSync } from "node:fs";
import type { FeedEvent, OddsPayload, ScorePayload } from "../types.js";
import { scoreEventTs } from "../client/scores.js";
import { createFeedEmitter, type FeedSource } from "./feedSource.js";

export interface CapturedFixture {
  fixtureId: number;
  participants: string[];
  startMs: number;
  endMs: number;
  odds: OddsPayload[];
  scores: ScorePayload[];
}

export interface FileReplayOptions {
  speed?: number;
}

function buildEvents(captured: CapturedFixture): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const o of captured.odds) {
    events.push({ type: "odds", ts: o.Ts, data: o });
  }
  for (const s of captured.scores) {
    events.push({ type: "score", ts: scoreEventTs(s) || captured.startMs, data: s });
  }
  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.type === b.type) return 0;
    return a.type === "odds" ? -1 : 1;
  });
  return events;
}

export function loadCapturedFixture(path: string): CapturedFixture {
  return JSON.parse(readFileSync(path, "utf8")) as CapturedFixture;
}

export function createFileReplayFeed(
  path: string,
  opts: FileReplayOptions = {},
): FeedSource & { captured: CapturedFixture } {
  const captured = loadCapturedFixture(path);
  const events = buildEvents(captured);
  const emitter = createFeedEmitter();
  const speed = opts.speed ?? 60;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const feed = emitter as FeedSource & { captured: CapturedFixture };
  feed.captured = captured;

  feed.start = async () => {
    stopped = false;
    if (speed <= 0) {
      for (const ev of events) {
        if (stopped) return;
        emitter.emit("event", ev);
      }
      emitter.emit("end");
      return;
    }

    let index = 0;
    let prevTs: number | null = null;

    const emitNext = () => {
      if (stopped || index >= events.length) {
        emitter.emit("end");
        return;
      }
      const ev = events[index]!;
      index += 1;
      emitter.emit("event", ev);
      prevTs = ev.ts;
      if (index >= events.length) {
        emitter.emit("end");
        return;
      }
      const next = events[index]!;
      let delay = 0;
      if (prevTs !== null) delay = Math.max(0, (next.ts - prevTs) / speed);
      delay = Math.min(delay, 5_000);
      timer = setTimeout(emitNext, delay);
    };

    emitNext();
  };

  feed.stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    emitter.emit("end");
  };

  return feed;
}
