import axios from "axios";
import nacl from "tweetnacl";
import { SELECTED_LEAGUES, loadWalletKeypair, networkConfig } from "../config.js";

export async function activate(txSig: string, jwt: string): Promise<string> {
  const wallet = loadWalletKeypair();
  const leagues = SELECTED_LEAGUES;
  const message = `${txSig}:${leagues.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(message),
    wallet.secretKey,
  );
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  const res = await axios.post(
    `${networkConfig.base}/api/token/activate`,
    { txSig, walletSignature, leagues },
    {
      headers: { Authorization: `Bearer ${jwt}` },
      timeout: 30_000,
    },
  );

  const data = res.data;
  if (typeof data === "string") return data;
  if (data && typeof data.token === "string") return data.token;
  throw new Error(
    `Unexpected activate response: ${JSON.stringify(data).slice(0, 200)}`,
  );
}
