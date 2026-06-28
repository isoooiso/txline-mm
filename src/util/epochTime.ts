const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_INTERVAL = 5 * 60_000;

export interface EpochInterval {
  epochDay: number;
  hour: number;
  interval: number;
}

export function tsToInterval(tsMs: number): EpochInterval {
  const epochDay = Math.floor(tsMs / MS_PER_DAY);
  const hour = Math.floor((tsMs % MS_PER_DAY) / MS_PER_HOUR);
  const interval = Math.floor((tsMs % MS_PER_HOUR) / MS_PER_INTERVAL);
  return { epochDay, hour, interval };
}

export function u16le(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n & 0xffff);
  return buf;
}

export function enumerateIntervals(
  startMs: number,
  endMs: number,
): EpochInterval[] {
  if (endMs < startMs) return [];

  const seen = new Set<string>();
  const result: EpochInterval[] = [];

  const alignedStart =
    Math.floor(startMs / MS_PER_INTERVAL) * MS_PER_INTERVAL;
  for (let t = alignedStart; t <= endMs; t += MS_PER_INTERVAL) {
    const iv = tsToInterval(t);
    const key = `${iv.epochDay}:${iv.hour}:${iv.interval}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(iv);
    }
  }

  return result;
}
