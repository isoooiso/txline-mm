import type { AxiosInstance } from "axios";
import type { OddsPayload } from "../types.js";

export async function getOddsSnapshot(
  client: AxiosInstance,
  fixtureId: number,
  asOf?: number,
): Promise<OddsPayload[]> {
  const params: Record<string, number> = {};
  if (asOf !== undefined) params.asOf = asOf;
  const res = await client.get<OddsPayload[]>(
    `/api/odds/snapshot/${fixtureId}`,
    { params },
  );
  return res.data;
}

export async function getOddsInterval(
  client: AxiosInstance,
  epochDay: number,
  hour: number,
  interval: number,
): Promise<OddsPayload[]> {
  const res = await client.get<OddsPayload[]>(
    `/api/odds/updates/${epochDay}/${hour}/${interval}`,
  );
  return res.data;
}
