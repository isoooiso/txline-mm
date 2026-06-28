import axios from "axios";
import { TxlineSession } from "../auth/session.js";
import { createHttpClient } from "../client/httpClient.js";
import { getFixturesSnapshot } from "../client/fixtures.js";
import {
  getScoresHistorical,
  getScoresInterval,
  getScoresLive,
} from "../client/scores.js";
import { loadStoredTokens } from "../config.js";
import { enumerateIntervals } from "../util/epochTime.js";
import type { FixturePayload } from "../types.js";

const arg = process.argv.slice(2).find((a) => a !== "--");
const id = Number(arg);
if (!Number.isFinite(id)) {
  console.error("Usage: npm run scores-probe -- <fixtureId>");
  process.exit(1);
}

function line(s: string): void {
  console.log("\n=== " + s + " ===");
}

function formatAxiosError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status;
    const body =
      e.response?.data !== undefined
        ? String(e.response.data).slice(0, 300)
        : "";
    return `FAILED status=${status ?? "?"} ${body || e.message}`;
  }
  return `FAILED ${e instanceof Error ? e.message : String(e)}`;
}

async function main(): Promise<void> {
  const tokens = loadStoredTokens();
  if (!tokens) {
    console.error("No tokens found — run: npm run bootstrap");
    process.exit(1);
  }

  const session = TxlineSession.load(tokens);
  const http = createHttpClient(session);

  const fixtures = await getFixturesSnapshot(http);
  const fx = fixtures.find((f: FixturePayload) => f.FixtureId === id);

  line("FIXTURE META");
  if (fx) {
    const startMs = Number(fx.StartTime);
    console.log({
      FixtureId: fx.FixtureId,
      StartTime: fx.StartTime,
      start: new Date(startMs).toISOString(),
      ageH: ((Date.now() - startMs) / 3.6e6).toFixed(1),
      Participant1: fx.Participant1,
      Participant2: fx.Participant2,
    });
  } else {
    console.log(`fixture ${id} NOT in snapshot`);
  }
  const startMs = fx ? Number(fx.StartTime) : Date.now();

  line("SOURCE 1: /scores/historical/{id} (raw text)");
  try {
    const r = await http.get(`/api/scores/historical/${id}`, {
      responseType: "text",
      transformResponse: [(body) => body],
    });
    console.log("status", r.status, "len", String(r.data).length);
    console.log("first 600 chars:\n", String(r.data).slice(0, 600));
  } catch (e: unknown) {
    console.log(formatAxiosError(e));
  }

  line("SOURCE 1b: getScoresHistorical (parsed client)");
  try {
    const parsed = await getScoresHistorical(http, id);
    console.log("count", parsed.length);
    if (parsed[0]) console.log("sample[0]:", JSON.stringify(parsed[0]).slice(0, 400));
  } catch (e: unknown) {
    console.log(formatAxiosError(e));
  }

  line("SOURCE 2: /scores/updates/{id} (live 5-min cache, raw text)");
  try {
    const r = await http.get(`/api/scores/updates/${id}`, {
      responseType: "text",
      transformResponse: [(body) => body],
    });
    console.log("status", r.status, "len", String(r.data).length);
    console.log(String(r.data).slice(0, 400));
  } catch (e: unknown) {
    console.log(formatAxiosError(e));
  }

  line("SOURCE 2b: getScoresLive (parsed client)");
  try {
    const parsed = await getScoresLive(http, id);
    console.log("count", parsed.length);
    if (parsed[0]) console.log("sample[0]:", JSON.stringify(parsed[0]).slice(0, 400));
  } catch (e: unknown) {
    console.log(formatAxiosError(e));
  }

  line("SOURCE 3: /scores/updates/{epochDay}/{hour}/{interval} across window");
  const ivs = enumerateIntervals(startMs - 10 * 60_000, startMs + 150 * 60_000);
  let total = 0;
  let withData = 0;
  const samples: string[] = [];
  let intervalErrors = 0;

  for (const { epochDay, hour, interval } of ivs) {
    try {
      const r = await http.get(
        `/api/scores/updates/${epochDay}/${hour}/${interval}`,
        { responseType: "text", transformResponse: [(body) => body] },
      );
      const body = String(r.data);
      const hits = body
        .split("\n")
        .filter((l) => l.includes(`"FixtureId":${id}`));
      if (hits.length > 0) {
        withData += 1;
        if (samples.length < 2) samples.push(hits[0]!);
      }
      total += hits.length;
    } catch (e: unknown) {
      intervalErrors += 1;
      if (intervalErrors <= 3) {
        console.log(
          `[${epochDay}/${hour}/${interval}]`,
          formatAxiosError(e),
        );
      }
    }
  }

  console.log(
    `intervals scanned=${ivs.length}  intervals with this fixture=${withData}  matching lines=${total}  errors=${intervalErrors}`,
  );
  samples.forEach((s, i) => console.log(`sample ${i}:`, s.slice(0, 300)));

  line("SOURCE 3b: getScoresInterval sample (parsed client)");
  if (ivs.length > 0) {
    const iv = ivs[Math.floor(ivs.length / 2)]!;
    try {
      const parsed = await getScoresInterval(http, iv.epochDay, iv.hour, iv.interval);
      const forFx = parsed.filter(
        (row) => (row.FixtureId ?? row.fixtureId) === id,
      );
      console.log(
        `mid-window interval ${iv.epochDay}/${iv.hour}/${iv.interval}: total=${parsed.length} forFixture=${forFx.length}`,
      );
      if (forFx[0]) console.log("sample:", JSON.stringify(forFx[0]).slice(0, 400));
    } catch (e: unknown) {
      console.log(formatAxiosError(e));
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
