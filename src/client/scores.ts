import type { AxiosInstance, AxiosResponse } from "axios";
import type { ScorePayload } from "../types.js";
import { createSseParser, flushSseParser } from "../feed/sseParser.js";

function parseScoreTextBody(text: string): ScorePayload[] {
  const parser = createSseParser();
  const rows: ScorePayload[] = [];
  for (const obj of parser.feed(text)) {
    if (obj && typeof obj === "object") rows.push(obj as ScorePayload);
  }
  for (const obj of flushSseParser(parser)) {
    if (obj && typeof obj === "object") rows.push(obj as ScorePayload);
  }
  return rows;
}

function normalizeScoreList(data: unknown): ScorePayload[] {
  if (Array.isArray(data)) return data as ScorePayload[];
  if (typeof data === "string") return parseScoreTextBody(data);
  return [];
}

async function getScoresRaw(
  client: AxiosInstance,
  path: string,
): Promise<ScorePayload[]> {
  const res: AxiosResponse<unknown> = await client.get(path, {
    transformResponse: [(body) => body],
    responseType: "text",
  });
  const body = res.data;
  if (typeof body === "string") return parseScoreTextBody(body);
  return normalizeScoreList(body);
}

export async function getScoresSnapshot(
  client: AxiosInstance,
  fixtureId: number,
): Promise<ScorePayload[]> {
  return getScoresRaw(client, `/api/scores/snapshot/${fixtureId}`);
}

export async function getScoresHistorical(
  client: AxiosInstance,
  fixtureId: number,
): Promise<ScorePayload[]> {
  return getScoresRaw(client, `/api/scores/historical/${fixtureId}`);
}

export async function getScoresInterval(
  client: AxiosInstance,
  epochDay: number,
  hour: number,
  interval: number,
): Promise<ScorePayload[]> {
  const res = await client.get<ScorePayload[] | string>(
    `/api/scores/updates/${epochDay}/${hour}/${interval}`,
    {
      transformResponse: [(body) => body],
      responseType: "text",
    },
  );
  return normalizeScoreList(res.data);
}

export async function getScoresLive(
  client: AxiosInstance,
  fixtureId: number,
): Promise<ScorePayload[]> {
  const rows = await getScoresRaw(client, `/api/scores/updates/${fixtureId}`);
  return rows.filter(
    (r) => (r.FixtureId ?? r.fixtureId) === fixtureId,
  );
}

export function scoreEventTs(data: ScorePayload): number {
  const raw = data.Ts ?? data.ts;
  return typeof raw === "number" ? raw : 0;
}

export function scoreFixtureId(data: ScorePayload): number | undefined {
  const id = data.FixtureId ?? data.fixtureId;
  return typeof id === "number" ? id : undefined;
}
