import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vesting } from "../target/types/vesting";
const { SystemProgram, Keypair } = anchor.web3;

describe('vesting', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

   const program = anchor.workspace.Vesting as Program<Vesting>

  it('Initialize vesting account', async () => {
    const vestingAccount = Keypair.generate();
    const vaultTokenAccount = Keypair.generate();
    const saleTokenAccount = Keypair.generate();
    const targetToken = Keypair.generate();

    const startDate = Math.floor(Date.now() / 1000); // Current time as Unix timestamp
    const duration = 60 * 60 * 24 * 30; // 30 days in seconds
    const amount = new anchor.BN(1000); // Amount of tokens
    const vestingType = { simple: {} };

    await program.rpc.initializeVesting(
      startDate,
      duration,
      amount,
      vestingType,
      {
        accounts: {
          vestingAccount: vestingAccount.publicKey,
          saleTokenAccount: saleTokenAccount.publicKey,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          targetToken: targetToken.publicKey,
          authority: provider.wallet.publicKey,
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [vestingAccount],
        instructions: [
          await program.account.vestingAccount.createInstruction(vestingAccount),
          await program.account.vestingAccount.createInstruction(vaultTokenAccount),
          await program.account.vestingAccount.createInstruction(saleTokenAccount),
          await program.account.vestingAccount.createInstruction(targetToken),
        ],
      }
    );

    const account = await program.account.vestingAccount.fetch(vestingAccount.publicKey);
    console.log("Vesting Account: ", account);
  });
});