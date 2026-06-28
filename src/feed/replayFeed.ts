import { createHttpClient } from "../client/httpClient.js";
import { getOddsInterval } from "../client/odds.js";
import {
  getScoresHistorical,
  getScoresInterval,
  scoreEventTs,
  scoreFixtureId,
} from "../client/scores.js";
import type { TxlineSession } from "../auth/session.js";
import type { FeedEvent, OddsPayload, ScorePayload } from "../types.js";
import { enumerateIntervals } from "../util/epochTime.js";
import {
  BoundedMessageDedup,
  createFeedEmitter,
  type FeedSource,
} from "./feedSource.js";

export interface ReplayOptions {
  fixtureId: number;
  startMs: number;
  endMs: number;
  /** Playback speed multiplier (60 = 1 hour of data in 1 minute). */
  speed?: number;
}

const TWO_WEEKS_MS = 14 * 86_400_000;
const SIX_HOURS_MS = 6 * 3_600_000;

function isHistoricalWindowEligible(nowMs: number, startMs: number): boolean {
  const age = nowMs - startMs;
  return age >= SIX_HOURS_MS && age <= TWO_WEEKS_MS;
}

async function loadReplayEvents(
  session: TxlineSession,
  opts: ReplayOptions,
): Promise<FeedEvent[]> {
  const client = createHttpClient(session);
  const dedup = new BoundedMessageDedup();
  const events: FeedEvent[] = [];

  const intervals = enumerateIntervals(opts.startMs, opts.endMs);
  for (const iv of intervals) {
    const batch = await getOddsInterval(
      client,
      iv.epochDay,
      iv.hour,
      iv.interval,
    );
    for (const row of batch) {
      if (row.FixtureId !== opts.fixtureId) continue;
      if (row.Ts < opts.startMs || row.Ts > opts.endMs) continue;
      if (!dedup.add(row.MessageId)) continue;
      events.push({ type: "odds", ts: row.Ts, data: row });
    }
  }

  let scoreRows: ScorePayload[] = [];
  const now = Date.now();
  try {
    if (isHistoricalWindowEligible(now, opts.startMs)) {
      scoreRows = await getScoresHistorical(client, opts.fixtureId);
    } else {
      throw new Error("outside historical eligibility window");
    }
  } catch {
    for (const iv of intervals) {
      const batch = await getScoresInterval(
        client,
        iv.epochDay,
        iv.hour,
        iv.interval,
      );
      for (const row of batch) {
        if (scoreFixtureId(row) !== opts.fixtureId) continue;
        scoreRows.push(row);
      }
    }
  }

  for (const row of scoreRows) {
    const ts = scoreEventTs(row);
    if (ts && (ts < opts.startMs || ts > opts.endMs)) continue;
    events.push({ type: "score", ts: ts || opts.startMs, data: row });
  }

  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.type === b.type) return 0;
    return a.type === "odds" ? -1 : 1;
  });

  return events;
}

export function createReplayFeed(
  session: TxlineSession,
  opts: ReplayOptions,
): FeedSource {
  const emitter = createFeedEmitter();
  const speed = opts.speed ?? 60;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  emitter.start = async () => {
    stopped = false;
    const events = await loadReplayEvents(session, opts);
    if (stopped) return;

    if (speed <= 0) {
      for (const ev of events) {
        if (stopped) return;
        emitter.emit("event", ev);
      }
      emitter.emit("end");
      return;
    }

    let prevTs: number | null = null;
    let index = 0;

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
      if (prevTs !== null) {
        delay = Math.max(0, (next.ts - prevTs) / speed);
      }
      delay = Math.min(delay, 5_000);
      timer = setTimeout(emitNext, delay);
    };

    emitNext();
  };

  emitter.stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    emitter.emit("end");
  };

  return emitter;
}

export async function prefetchReplayEvents(
  session: TxlineSession,
  opts: ReplayOptions,
): Promise<FeedEvent[]> {
  return loadReplayEvents(session, opts);
}
