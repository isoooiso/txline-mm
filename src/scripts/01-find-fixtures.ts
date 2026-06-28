import { TxlineSession } from "../auth/session.js";
import { createHttpClient } from "../client/httpClient.js";
import {
  findWorldCupFixtures,
  printFixtures,
} from "../client/fixtures.js";
import { loadStoredTokens } from "../config.js";

async function main(): Promise<void> {
  const tokens = loadStoredTokens();
  if (!tokens) {
    console.error("No tokens found — run: npm run bootstrap");
    process.exit(1);
  }

  const session = TxlineSession.load(tokens);
  const client = createHttpClient(session);
  const fixtures = await findWorldCupFixtures(client);
  printFixtures(fixtures);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
