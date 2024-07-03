import * as anchor from "@coral-xyz/anchor";
import { BN, min } from "bn.js";
import { Program } from "@coral-xyz/anchor";
import { MemeLaunchpad } from "../target/types/meme_launchpad";
import { ComputeBudgetInstruction, ComputeBudgetProgram, Keypair, PublicKey, Signer, Transaction, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAccount,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  transfer,
  mintTo,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createWrappedNativeAccount, NATIVE_MINT, getAssociatedTokenAddress,
  NATIVE_MINT_2022,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import { expect } from "chai";
import { getCreateSaleAddresses, getPurshaseAddresses } from "./helpers/sale";
import { createATA } from "./helpers/token";
import {expectFail} from "./helpers/test";
// const Day = 24 * 60 * 60 * 1000;
// seconds in day
const Day = 24 * 60 * 60;

describe.only("meme_launchpad", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider);

  const program = anchor.workspace.MemeLaunchpad as Program<MemeLaunchpad>;
  const wallet = provider.wallet as anchor.Wallet;
  const paymentToken = new anchor.web3.Keypair();
  const free_account = new anchor.web3.Keypair();
  const user = new anchor.web3.Keypair();
  const mint = anchor.web3.Keypair.generate();

  before(async () => {
    await createMint(provider.connection, wallet.payer, wallet.publicKey, wallet.publicKey, 9, paymentToken, {},
      TOKEN_2022_PROGRAM_ID);

    const ata = await createAssociatedTokenAccount(
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
      ata,
      wallet.payer,
      1000000000000000000,
      [],
      {},
      TOKEN_2022_PROGRAM_ID
    )

  });

  // it("Is initialized!", async () => {
  //   // Add your test here.
  //   const tx = await program.methods.initialize().rpc();
  //   console.log("Your transaction signature", tx);
  // });

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
    const token_params = {
      name: "Meme Launchpad",
      symbol: "ML",
      decimals: 8,
      uri: "test/uri",
    }

    const start = Date.now() / 1000;
    const end = start + 5 * Day;
    const sale_params = {
      common: {
        name: "Sale#1",
        description: "Saledescription",
        aboutSeller: "Someone",
        sellerLink: "Lihk",
        startTime: new BN(start),
        endTime: new BN(end),
        saleDelay: new BN(end + 1 * Day),
      },
      pricing: {
        pricingModel: { fixed: {} },
        amountFunction: { fixed: {} },
        startPrice: new BN(50),
      },
      vesting: {
        duration: 10,
        vestingModel: { discrete: [2] },
        percentage: 10_00, 
      },
      saleAmount: new BN(1000).mul(new BN(10).pow(new BN(token_params.decimals))),
      liqAmount: new BN(700).mul(new BN(10).pow(new BN(token_params.decimals))),
    }

    const userATA = getAssociatedTokenAddressSync(
      paymentToken.publicKey,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const sale = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("sale"),
        mint.publicKey.toBuffer(),
      ],
      program.programId
    )[0]

    const salePayment = getAssociatedTokenAddressSync(
      paymentToken.publicKey,
      sale,
      true,
      TOKEN_2022_PROGRAM_ID,
    )

    const saleTarget = getAssociatedTokenAddressSync(
      mint.publicKey,
      sale,
      true,
      TOKEN_2022_PROGRAM_ID
    )

    const user_traget_ATA = getAssociatedTokenAddressSync(
      mint.publicKey,
      free_account.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    )

    const authority = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("authority")
      ],
      program.programId
    )[0]

    const additionalComputeBudgetInstruction =
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 600000,
      });

    const tx = await program.methods.createLaunchpad({
      freeAccount: free_account.publicKey,
      freeAmount: new BN(588).mul(new BN(10).pow(new BN(token_params.decimals))),
      createTokenParams: token_params,
      createSaleParams: sale_params,
    }).accounts({
      signer: wallet.publicKey,
      targetToken: mint.publicKey,
      authority: authority,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      freeTokenAccount: user_traget_ATA,
      freeAccount: free_account.publicKey,
      sale: sale,
      paymentToken: paymentToken.publicKey,
      saleTargetTokenAccount: saleTarget,
      salePaymentTokenAccount: salePayment
    })
      .preInstructions([additionalComputeBudgetInstruction])
      .signers([wallet.payer, mint]).rpc().catch(e => console.error(e));

    const saleTargetTokenAccount = await provider.connection.getTokenAccountBalance(saleTarget);
    const freeTargetTokenAccount = await provider.connection.getTokenAccountBalance(user_traget_ATA);

    expect(saleTargetTokenAccount.value.amount).to.be.eq(sale_params.saleAmount.add(sale_params.liqAmount).toString());
    expect(freeTargetTokenAccount.value.amount).to.be.eq(new BN(588).mul(new BN(10).pow(new BN(token_params.decimals))).toString());
  })

  it("buy token", async () => {

    const params = {
      amount: new BN(100).mul(new BN(10).pow(new BN(8))),
      amountSpecifiedInput: true,
    }

    const purshaseAddresses = getPurshaseAddresses(
      mint.publicKey,
      paymentToken.publicKey,
      user.publicKey,
      program.programId
    )

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        purshaseAddresses.userPaymentTokenAccount,
        user.publicKey,
        paymentToken.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    ).add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        purshaseAddresses.userTargetTokenAccount,
        user.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    ).add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: user.publicKey,
        lamports: 1000000000, // 1 sol
      })
    );

    await provider.sendAndConfirm(transaction, [wallet.payer]);

    await mintTo(
      provider.connection,
      wallet.payer,
      paymentToken.publicKey,
      purshaseAddresses.userPaymentTokenAccount,
      wallet.payer,
      1000000000000000000,
      [],
      {},
      TOKEN_2022_PROGRAM_ID,
    )

    await program.methods.buyToken(
      params
    ).accounts({
      ...purshaseAddresses,
      vestingProgram: anchor.workspace.Vesting.programId
    }).signers([user]).rpc().catch(e => console.error(e));

    console.log(await provider.connection.getBalance(purshaseAddresses.vestingTargetTokenAccount))

  });

  it.skip('sale timerange test', async () => {
    const newMint = anchor.web3.Keypair.generate();

    const token_params = {
      name: "Meme Launchpad",
      symbol: "ML",
      decimals: 8,
      uri: "test/uri",
    }

    const start = (Date.now() / 1000) + 20;
    const end = start + 20;
    const delay = end + 20;
    const sale_params = {
      common: {
        name: "Sale#1",
        description: "Saledescription",
        aboutSeller: "Someone",
        sellerLink: "Lihk",
        startTime: new BN(start),
        endTime: new BN(end),
        saleDelay: new BN(delay),
      },
      pricing: {
        pricingModel: { fixed: {} },
        amountFunction: { fixed: {} },
        startPrice: new BN(50),
      },
      saleAmount: new BN(1000).mul(new BN(10).pow(new BN(token_params.decimals))),
      liqAmount: new BN(700).mul(new BN(10).pow(new BN(token_params.decimals))),
    }

    const saleAddresses = getCreateSaleAddresses(
      wallet.publicKey,
      newMint.publicKey,
      paymentToken.publicKey,
      free_account.publicKey,
      program.programId
    );

    const additionalComputeBudgetInstruction =
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 600000,
      });

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

    const amount = new BN(100).mul(new BN(10).pow(new BN(8)));

    const ataTransaction = await createATA(
      wallet.publicKey,
      [
        {
          user: user.publicKey,
          mint: newMint.publicKey,
        }
      ],
    )
    await provider.sendAndConfirm(ataTransaction, [wallet.payer])


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

});
