import { networkConfig } from "../config.js";
import type { TxlineSession } from "../auth/session.js";
import type { FeedEvent, OddsPayload, ScorePayload } from "../types.js";
import { scoreEventTs } from "../client/scores.js";
import {
  BoundedMessageDedup,
  createFeedEmitter,
  type FeedSource,
} from "./feedSource.js";
import { createSseParser, flushSseParser } from "./sseParser.js";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function mapOdds(data: OddsPayload, dedup: BoundedMessageDedup): FeedEvent | null {
  if (!dedup.add(data.MessageId)) return null;
  return { type: "odds", ts: data.Ts, data };
}

function mapScore(data: ScorePayload): FeedEvent {
  return { type: "score", ts: scoreEventTs(data) || Date.now(), data };
}

async function consumeStream(
  url: string,
  session: TxlineSession,
  onObjects: (objects: unknown[]) => void,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    ...session.headers(),
    Accept: "text/event-stream",
  };

  const res = await fetch(url, { headers, signal });
  if (res.status === 401) {
    await session.refreshJwtOnUnauthorized();
    throw new Error("SSE 401 — JWT refreshed, reconnecting");
  }
  if (!res.ok) {
    throw new Error(`SSE ${url} failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error(`SSE ${url}: empty body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    onObjects(parser.feed(text));
  }

  onObjects(flushSseParser(parser));
}

export function createLiveFeed(session: TxlineSession): FeedSource {
  const emitter = createFeedEmitter();
  const dedup = new BoundedMessageDedup();
  let running = false;
  let stopped = false;
  let abort: AbortController | null = null;
  let backoff = INITIAL_BACKOFF_MS;

  async function runStream(path: string, handler: (obj: unknown) => void): Promise<void> {
    while (running && !stopped) {
      abort = new AbortController();
      try {
        await consumeStream(
          `${networkConfig.base}${path}`,
          session,
          (objects) => {
            for (const obj of objects) handler(obj);
          },
          abort.signal,
        );
        if (!stopped) {
          await sleep(backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        }
      } catch (err) {
        if (stopped) return;
        const error = err instanceof Error ? err : new Error(String(err));
        emitter.emit("error", error);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  emitter.start = async () => {
    if (running) return;
    running = true;
    stopped = false;
    backoff = INITIAL_BACKOFF_MS;

    void runStream("/api/odds/stream", (obj) => {
      const data = obj as OddsPayload;
      if (!data?.MessageId) return;
      const ev = mapOdds(data, dedup);
      if (ev) emitter.emit("event", ev);
    });

    void runStream("/api/scores/stream", (obj) => {
      const data = obj as ScorePayload;
      emitter.emit("event", mapScore(data));
    });
  };

  emitter.stop = () => {
    stopped = true;
    running = false;
    abort?.abort();
    emitter.emit("end");
  };

  return emitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
