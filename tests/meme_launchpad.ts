import * as anchor from "@coral-xyz/anchor";
import { BN } from "bn.js";
import { Program } from "@coral-xyz/anchor";
import { MemeLaunchpad } from "../target/types/meme_launchpad";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  burn,
} from "@solana/spl-token";
import { expect } from "chai";
import { getCloseSaleAddresses, getCreateSaleAddresses, getPurshaseAddresses, getTokenAndSaleParams } from "./helpers/sale";
import { createATA } from "./helpers/token";
import { expectFail, expectSystemFail } from "./helpers/test";

import raydium_idl from "../idls/raydium_cp_swap.json";
import { RaydiumCpSwap } from "../idls/raydium_types";

const Day = 24 * 60 * 60;

const RAYDIUM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const createPoolFeeReveiver = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');

describe.only("meme_launchpad", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider);

  const program = anchor.workspace.MemeLaunchpad as Program<MemeLaunchpad>;
  const cp_swap_program = new anchor.Program(raydium_idl, provider) as Program<RaydiumCpSwap>;

  const wallet = provider.wallet as anchor.Wallet;
  const paymentToken = new anchor.web3.Keypair();
  const free_account = new anchor.web3.Keypair();
  const user = new anchor.web3.Keypair();
  const user2 = new anchor.web3.Keypair();
  const mint = anchor.web3.Keypair.generate();

  const additionalComputeBudgetInstruction =
  ComputeBudgetProgram.setComputeUnitLimit({
    units: 600000,
  });

  const saleAddresses = getCreateSaleAddresses(
    wallet.publicKey,
    mint.publicKey,
    paymentToken.publicKey,
    free_account.publicKey,
    program.programId
  );

  const purshaseAddresses = getPurshaseAddresses(
    mint.publicKey,
    paymentToken.publicKey,
    user.publicKey,
    program.programId
  )

  const closeSaleAddresses = getCloseSaleAddresses(
    wallet.publicKey,
    mint.publicKey,
    paymentToken.publicKey,
    program.programId,
    RAYDIUM_PROGRAM_ID
  );

  async function mintTokens(to: anchor.web3.PublicKey, token: anchor.web3.PublicKey, amount: number) {
    await mintTo(
      provider.connection,
      wallet.payer,
      token,
      to,
      wallet.payer,
      amount,
      [],
      {},
      TOKEN_2022_PROGRAM_ID,
    )
  }

  before(async () => {
    await createMint(provider.connection, wallet.payer, wallet.publicKey, wallet.publicKey, 9, paymentToken, {},
      TOKEN_2022_PROGRAM_ID);

    const ATA = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      paymentToken.publicKey,
      wallet.publicKey,
      {},
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    await mintTo(
      provider.connection,
      wallet.payer,
      paymentToken.publicKey,
      ATA,
      wallet.payer,
      10000000000 * 10 ** 8,
      [],
      {},
      TOKEN_2022_PROGRAM_ID
    )
  });

  // it("create token", async () => {

  //   const params = {
  //     name: "Meme Launchpad",
  //     symbol: "ML",
  //     decimals: 8,
  //     uri: "",
  //   }

  //   const mint = anchor.web3.Keypair.generate();
  //   const tokenAccount = await getAssociatedTokenAddress(
  //     mint.publicKey, 
  //     wallet.publicKey,
  //     false,
  //     TOKEN_2022_PROGRAM_ID
  //   );

  //   const authority = anchor.web3.PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("authority")
  //     ],
  //     program.programId
  //   )[0]

  //   // Add your test here.
  //   const tx = await program.methods.createToken(params).accounts({
  //     signer: wallet.publicKey,
  //     mint: mint.publicKey,
  //     tokenAccount: tokenAccount,
  //     tokenProgram: TOKEN_2022_PROGRAM_ID,
  //     authority: authority,
  //     associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //     systemProgram: anchor.web3.SystemProgram.programId,
  //     rent: anchor.web3.SYSVAR_RENT_PUBKEY,

  //   }).signers([wallet.payer, mint]).rpc().catch(e => console.error(e));

  //   const userTokenAccount = await provider.connection.getTokenAccountBalance(tokenAccount);
  //   console.log("userTokenAccount", userTokenAccount);
  // });

  it("create launchpad", async () => {
    const start = (Date.now() / 1000);
    const end = start + 10;
    const delay = end + 10;

    const { token_params, sale_params } = getTokenAndSaleParams(start, end, delay);

    const tx = await program.methods.createLaunchpad({
      freeAccount: free_account.publicKey,
      freeAmount: new BN(588).mul(new BN(10).pow(new BN(token_params.decimals))),
      createTokenParams: token_params,
      createSaleParams: sale_params,
    }).accounts({
      ...saleAddresses
    })
      .preInstructions([additionalComputeBudgetInstruction])
      .signers([wallet.payer, mint]).rpc().catch(e => console.error(e));

    const saleTargetTokenAccount = await provider.connection.getTokenAccountBalance(saleAddresses.saleTargetTokenAccount);
    const freeTargetTokenAccount = await provider.connection.getTokenAccountBalance(saleAddresses.freeTokenAccount);

    expect(saleTargetTokenAccount.value.amount).to.be.eq(sale_params.saleAmount.add(sale_params.liqAmount).toString());
    expect(freeTargetTokenAccount.value.amount).to.be.eq(new BN(588).mul(new BN(10).pow(new BN(token_params.decimals))).toString());
  })

  it("buy tokens", async () => {
    const params = {
      amount: new BN(100).mul(new BN(10).pow(new BN(8))),
      amountSpecifiedInput: true,
    }

    const ATACreationAddresses = [
      {
        user: user.publicKey,
        mint: paymentToken.publicKey
      }, 
      {
        user: user.publicKey,
        mint: mint.publicKey
      }
    ]

    const transaction = (await createATA(wallet.publicKey, ATACreationAddresses)).add(
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: user.publicKey,
            lamports: 1000000000, // 1 sol
        })
    );
    
    await provider.sendAndConfirm(transaction, [wallet.payer]);

    const amountPaymentToken = 10000000000 * 10 ** 8;
    await mintTokens(purshaseAddresses.userPaymentTokenAccount, paymentToken.publicKey, amountPaymentToken);

    await program.methods.buyToken(
      params
    ).accounts({
      ...purshaseAddresses,
    }).signers([user]).rpc().catch(e => console.error(e));

    const totalAmountTargetToken = 200000000;
    const expectedVestingBalance = totalAmountTargetToken * 50_00 / 100_00; // 50% from total amount
    const expectedUserBalance = totalAmountTargetToken - expectedVestingBalance;
    const userBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const vestingBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
    const salePaymentBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);

    expect(Number(userBalance.value.amount)).to.be.eq(expectedUserBalance);
    expect(Number(vestingBalance.value.amount)).to.be.eq(expectedVestingBalance);
    expect(Number(salePaymentBalance.value.amount)).to.be.eq(Number(params.amount));
  });

  it.skip('sale timerange test', async () => {
    const newMint = anchor.web3.Keypair.generate();

    const start = (Date.now() / 1000) + 20;
    const end = start + 20;
    const delay = end + 20;

    const { token_params, sale_params } = getTokenAndSaleParams(start, end, delay);

    const saleAddresses = getCreateSaleAddresses(
      wallet.publicKey,
      newMint.publicKey,
      paymentToken.publicKey,
      free_account.publicKey,
      program.programId
    );

    const tx = await program.methods.createLaunchpad({
      freeAccount: free_account.publicKey,
      freeAmount: new BN(588).mul(new BN(10).pow(new BN(token_params.decimals))),
      createTokenParams: token_params,
      createSaleParams: sale_params,
    }).accounts({ ...saleAddresses })
      .preInstructions([additionalComputeBudgetInstruction])
      .signers([wallet.payer, newMint]).rpc().catch(e => console.error(e));


    const purshaseAddresses = getPurshaseAddresses(
      newMint.publicKey,
      paymentToken.publicKey,
      user.publicKey,
      program.programId
    );
    
    const ATACreationAddresses = [
      {
        user: user.publicKey,
        mint: newMint.publicKey,
      }
    ]

    const transaction = await createATA(wallet.publicKey, ATACreationAddresses)
    await provider.sendAndConfirm(transaction, [wallet.payer])

    const amount = new BN(100).mul(new BN(10).pow(new BN(8)));
    await expectFail(
      program.methods.buyToken(
        {
          amount: amount,
          amountSpecifiedInput: true,
        }
      ).accounts({ ...purshaseAddresses }).signers([user]).rpc(),
      "Sale hasn't started"
    )
    
    await new Promise((resolve) => setTimeout(resolve, 20000));

    await program.methods.buyToken(
      {
        amount: amount,
        amountSpecifiedInput: true,
      }
    ).accounts({ ...purshaseAddresses }).signers([user]).rpc().catch(e => console.error(e));

    await new Promise((resolve) => setTimeout(resolve, 20000));

    await expectFail(
      program.methods.buyToken(
        {
          amount: amount,
          amountSpecifiedInput: true,
        }
      ).accounts({ ...purshaseAddresses }).signers([user]).rpc(),
      "Sale has been ended"
    )
  })

  it("no more tokens can mint", async () => {
    await expectSystemFail(
      mintTokens(purshaseAddresses.userTargetTokenAccount, mint.publicKey, 1),
      "Account is frozen"
    );
    await expectSystemFail(
        mintTokens(purshaseAddresses.saleTargetTokenAccount, mint.publicKey, 1),
        "the total supply of this token is fixed"
    );
  });

  it('close sale', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const ATACreationAddresses = [
      {
        user: wallet.publicKey,
        mint: mint.publicKey,
      }
    ]

    const ataTransaction = await createATA(wallet.publicKey, ATACreationAddresses);
    await provider.sendAndConfirm(ataTransaction, [wallet.payer])

    const tx = await program.methods.closeSale().accounts({
      ...closeSaleAddresses
    }).preInstructions([additionalComputeBudgetInstruction]).signers([wallet.payer]).rpc().catch(e => console.error(e));
  })

  it("thaw account", async () => {
    await program.methods.thawToken().accounts({
      signer: user.publicKey,
      sale: saleAddresses.sale,
      authority: saleAddresses.authority,
      userTargetTokenAccount: purshaseAddresses.userTargetTokenAccount, 
      targetToken: mint.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).signers([user]).rpc().catch(e => console.error(e));
  
  })

  it("claim tokens", async () => {
    const vestingProgram = anchor.workspace.Vesting;

    const userBalanceBeforeClaim = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const vestingBalanceBeforeClaim = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
    const halfTokenAmountInVesting = Number(vestingBalanceBeforeClaim.value.amount) / 2;

    // We can claim half of the amount in vesting. 
    // Since the step is 5 seconds, and 10 seconds have passed since the beginning of the bought of tokens.
    // The total vesting time is 20 seconds.
    await vestingProgram.methods
      .claimTokens()
      .accounts({
        vesting: purshaseAddresses.vesting,
        userTokenAccount: purshaseAddresses.userTargetTokenAccount,
        vestingTokenAccount: purshaseAddresses.vestingTargetTokenAccount,
        targetToken: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        user: user.publicKey,
    }).signers([user]).rpc().catch(e => console.error(e));

    const userBalanceAfterClaim = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const vestingBalanceAfterClaim = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);

    expect(Number(userBalanceAfterClaim.value.amount)).to.be.eq(Number(userBalanceBeforeClaim.value.amount) + halfTokenAmountInVesting);
    expect(Number(vestingBalanceAfterClaim.value.amount)).to.be.eq(Number(vestingBalanceBeforeClaim.value.amount) - halfTokenAmountInVesting);
  });

  it("swap after sale", async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    
    const tx = await cp_swap_program.methods.swapBaseInput(
      new BN(1000000), new BN(30000)
    ).accounts({
      payer: user.publicKey,
      authority: closeSaleAddresses.raydiumAuthority,
      ammConfig: closeSaleAddresses.ammConfig,
      poolState: closeSaleAddresses.poolState,
      inputTokenAccount: purshaseAddresses.userTargetTokenAccount,
      outputTokenAccount: purshaseAddresses.userPaymentTokenAccount,
      inputVault: closeSaleAddresses.targetTokenVault,
      outputVault: closeSaleAddresses.paymentTokenVault,
      inputTokenProgram: TOKEN_2022_PROGRAM_ID,
      outputTokenProgram: TOKEN_2022_PROGRAM_ID,
      inputTokenMint: mint.publicKey,
      outputTokenMint: paymentToken.publicKey,
      observationState: closeSaleAddresses.observationState,
    }).signers([user]).rpc().catch(e => console.error(e));
  });

  it("burn tokens after start of trades", async () => {
    const userBalanceBeforeBurn = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const tokenAmount = 10000;

    await burn(
        provider.connection,
        user,
        purshaseAddresses.userTargetTokenAccount,
        mint.publicKey,
        user.publicKey,
        tokenAmount,
        [],
        {},
        TOKEN_2022_PROGRAM_ID
    );

    const userBalanceAfterBurn = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);

    expect(Number(userBalanceBeforeBurn.value.amount)).to.be.eq(Number(userBalanceAfterBurn.value.amount) + tokenAmount);
  });
});
