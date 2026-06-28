import axios from "axios";
import { writeFileSync } from "node:fs";
import { networkConfig, TOKEN_FILE } from "../config.js";

export interface SessionTokens {
  jwt: string;
  apiToken: string;
}

export class TxlineSession {
  jwt: string;
  apiToken: string;

  constructor(tokens: SessionTokens) {
    this.jwt = tokens.jwt;
    this.apiToken = tokens.apiToken;
  }

  headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      "X-Api-Token": this.apiToken,
    };
  }

  async startGuest(): Promise<string> {
    const res = await axios.post<{ token: string }>(
      `${networkConfig.base}/auth/guest/start`,
      {},
      { timeout: 30_000 },
    );
    this.jwt = res.data.token;
    return this.jwt;
  }

  async refreshJwtOnUnauthorized(): Promise<void> {
    await this.startGuest();
    if (this.apiToken) this.save();
  }

  save(): void {
    writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ jwt: this.jwt, apiToken: this.apiToken }, null, 2),
      "utf8",
    );
  }

  static load(tokens: SessionTokens): TxlineSession {
    return new TxlineSession(tokens);
  }

  static persist(tokens: SessionTokens): TxlineSession {
    const session = new TxlineSession(tokens);
    session.save();
    return session;
  }
}
