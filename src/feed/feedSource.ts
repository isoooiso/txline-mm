import { EventEmitter } from "node:events";
import type { FeedEvent } from "../types.js";

export interface FeedSource extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
  on(event: "event", listener: (ev: FeedEvent) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "end", listener: () => void): this;
}

export const DEDUP_MAX = 50_000;

export class BoundedMessageDedup {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    this.order.push(id);
    while (this.order.length > DEDUP_MAX) {
      const oldest = this.order.shift();
      if (oldest) this.ids.delete(oldest);
    }
    return true;
  }
}

export function createFeedEmitter(): FeedSource {
  return new EventEmitter() as FeedSource;
}
