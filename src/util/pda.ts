import { PublicKey } from "@solana/web3.js";
import { u16le } from "./epochTime.js";

export function findTokenTreasuryPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    programId,
  );
}

export function findPricingMatrixPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    programId,
  );
}

/** For later Merkle verification slices — not used in slice 1. */
export function findDailyBatchRootsPda(
  programId: PublicKey,
  epochDay: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_batch_roots"), u16le(epochDay)],
    programId,
  );
}

/** For later Merkle verification slices — not used in slice 1. */
export function findDailyScoresRootsPda(
  programId: PublicKey,
  epochDay: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), u16le(epochDay)],
    programId,
  );
}
