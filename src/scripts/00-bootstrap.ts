import { activate } from "../auth/activate.js";
import { TxlineSession } from "../auth/session.js";
import { subscribeOnChain } from "../auth/subscribe.js";

async function main(): Promise<void> {
  console.log("=== TxLINE bootstrap ===\n");

  const session = new TxlineSession({ jwt: "", apiToken: "" });

  console.log("1/3  Guest JWT …");
  const jwt = await session.startGuest();
  console.log(`     OK  (${jwt.slice(0, 24)}…)\n`);

  console.log("2/3  On-chain subscribe (service level 12, 4 weeks, 0 TXL) …");
  const txSig = await subscribeOnChain();
  console.log(`     txSig: ${txSig}\n`);

  console.log("3/3  Activate API token …");
  const apiToken = await activate(txSig, jwt);
  session.apiToken = apiToken;
  session.save();
  console.log(`     OK  (${apiToken.slice(0, 24)}…)\n`);

  console.log("Bootstrap complete — tokens saved to .token.json");
}

main().catch((err: unknown) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
