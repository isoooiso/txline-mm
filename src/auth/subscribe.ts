import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import idl from "../idl/txline.json" with { type: "json" };
import {
  DURATION_WEEKS,
  SERVICE_LEVEL_ID,
  loadWalletKeypair,
  networkConfig,
} from "../config.js";
import {
  findPricingMatrixPda,
  findTokenTreasuryPda,
} from "../util/pda.js";

export async function subscribeOnChain(
  wallet?: Keypair,
): Promise<string> {
  const keypair = wallet ?? loadWalletKeypair();
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");
  const walletAdapter = new Wallet(keypair);
  const provider = new AnchorProvider(connection, walletAdapter, {
    commitment: "confirmed",
  });

  const programId = new PublicKey(networkConfig.programId);
  const program = new Program(idl as Idl, provider);

  const txlMint = new PublicKey(networkConfig.txlMint);
  const [tokenTreasuryPda] = findTokenTreasuryPda(programId);
  const [pricingMatrixPda] = findPricingMatrixPda(programId);

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  const userTokenAccount = getAssociatedTokenAddressSync(
    txlMint,
    keypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  await createAssociatedTokenAccountIdempotent(
    connection,
    keypair,
    txlMint,
    keypair.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID,
  );

  type SubscribeBuilder = {
    accounts: (accts: Record<string, PublicKey>) => { rpc: () => Promise<string> };
  };

  const txSig = await (
    program.methods.subscribe as (
      serviceLevelId: number,
      weeks: number,
    ) => SubscribeBuilder
  )(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: keypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: txlMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`On-chain subscribe confirmed: ${txSig}`);
  return txSig;
}
