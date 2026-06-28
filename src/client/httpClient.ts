import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { networkConfig } from "../config.js";
import type { TxlineSession } from "../auth/session.js";

export function createHttpClient(session: TxlineSession): AxiosInstance {
  const client = axios.create({
    baseURL: networkConfig.base,
    timeout: 30_000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const authHeaders = session.headers();
    Object.assign(config.headers, authHeaders);
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error) || !error.config) throw error;
      const status = error.response?.status;
      const config = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };
      if (status === 401 && !config._retry) {
        config._retry = true;
        await session.refreshJwtOnUnauthorized();
        const authHeaders = session.headers();
        Object.assign(config.headers, authHeaders);
        return client.request(config);
      }
      throw error;
    },
  );

  return client;
}
