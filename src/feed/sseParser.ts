export interface SseParser {
  feed(chunk: string): unknown[];
}

export function createSseParser(): SseParser {
  let buffer = "";

  function parseLine(line: string): unknown | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return null;

    let payload = trimmed;
    if (payload.startsWith("data:")) {
      payload = payload.slice(5).trimStart();
    }
    if (!payload) return null;

    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }

  return {
    feed(chunk: string): unknown[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      const parsed: unknown[] = [];
      for (const line of lines) {
        const obj = parseLine(line);
        if (obj !== null) parsed.push(obj);
      }
      return parsed;
    },
  };
}

/** Flush any trailing buffered line (call on stream end). */
export function flushSseParser(parser: SseParser): unknown[] {
  const p = parser as SseParser & { feed: (c: string) => unknown[] };
  return p.feed("\n");
}
