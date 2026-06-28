import type { AxiosInstance } from "axios";
import type { FixturePayload } from "../types.js";
import { WORLD_CUP_COMPETITION_ID } from "../config.js";

export async function getFixturesSnapshot(
  client: AxiosInstance,
  competitionId?: number,
): Promise<FixturePayload[]> {
  const params: Record<string, number> = {};
  if (competitionId !== undefined) params.competitionId = competitionId;
  const res = await client.get<FixturePayload[]>("/api/fixtures/snapshot", {
    params,
  });
  return res.data;
}

export async function findWorldCupFixtures(
  client: AxiosInstance,
): Promise<FixturePayload[]> {
  if (WORLD_CUP_COMPETITION_ID !== undefined) {
    return getFixturesSnapshot(client, WORLD_CUP_COMPETITION_ID);
  }

  const all = await getFixturesSnapshot(client);
  return all.filter((f) => {
    const competition = String(f.Competition ?? "");
    return /world\s*cup/i.test(competition);
  });
}

export function printFixtures(fixtures: FixturePayload[]): void {
  console.log(`Found ${fixtures.length} World Cup fixture(s):\n`);
  for (const f of fixtures) {
    const start = new Date(f.StartTime).toISOString();
    console.log(
      `  ${f.FixtureId}  ${f.Participant1} vs ${f.Participant2}  @ ${start}`,
    );
  }
}
