import { config as loadDotenv } from "dotenv";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "..");
export const TOKEN_FILE = resolve(PROJECT_ROOT, ".token.json");

export type NetworkName = "mainnet" | "devnet";

export interface NetworkConfig {
  base: string;
  programId: string;
  txlMint: string;
  rpcUrl: string;
}

const NETWORKS: Record<NetworkName, Omit<NetworkConfig, "rpcUrl">> = {
  mainnet: {
    base: "https://txline.txodds.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
  devnet: {
    base: "https://txline-dev.txodds.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  },
};

function parseNetwork(): NetworkName {
  const raw = (process.env.TXLINE_NETWORK ?? "devnet").toLowerCase();
  if (raw === "mainnet" || raw === "devnet") return raw;
  throw new Error(`Invalid TXLINE_NETWORK="${raw}" — use mainnet or devnet`);
}

export const TXLINE_NETWORK = parseNetwork();

export const networkConfig: NetworkConfig = {
  ...NETWORKS[TXLINE_NETWORK],
  rpcUrl:
    process.env.TXLINE_RPC_URL ??
    (TXLINE_NETWORK === "mainnet"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com"),
};

export const SERVICE_LEVEL_ID = 12;
export const DURATION_WEEKS = 4;
export const SELECTED_LEAGUES: number[] = [];

export const WORLD_CUP_COMPETITION_ID = process.env.WORLD_CUP_COMPETITION_ID
  ? Number(process.env.WORLD_CUP_COMPETITION_ID)
  : undefined;

export function loadWalletKeypair(): Keypair {
  const secret = process.env.WALLET_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("WALLET_SECRET_KEY is not set in .env");
  }
  if (secret.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(secret) as number[]);
    return Keypair.fromSecretKey(bytes);
  }
  return Keypair.fromSecretKey(bs58.decode(secret));
}

export interface StoredTokens {
  jwt: string;
  apiToken: string;
}

export function loadStoredTokens(): StoredTokens | null {
  if (existsSync(TOKEN_FILE)) {
    const parsed = JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as StoredTokens;
    if (parsed.jwt && parsed.apiToken) return parsed;
  }
  const jwt = process.env.TXLINE_JWT ?? process.env.VITE_TXLINE_JWT;
  const apiToken =
    process.env.TXLINE_API_TOKEN ?? process.env.VITE_TXLINE_API_TOKEN;
  if (jwt && apiToken) return { jwt, apiToken };
  return null;
}
