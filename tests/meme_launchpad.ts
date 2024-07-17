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
  transfer,
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { getCloseSaleAddresses, getCreateSaleAddresses, getPurshaseAddresses, getTokenAndSaleParams } from "./helpers/sale";
import { createATA } from "./helpers/token";
import { expectFail, expectSystemFail } from "./helpers/test";

import raydium_idl from "../idls/raydium_cp_swap.json";
import { RaydiumCpSwap } from "../idls/raydium_types";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";

const Day = 24 * 60 * 60;

const RAYDIUM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const createPoolFeeReveiver = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');

describe("meme_launchpad", () => {
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
      10000000000 * (10 ** 8),
      [],
      {},
      TOKEN_2022_PROGRAM_ID
    )
  });

  it("create launchpad", async () => {
    const start = (Date.now() / 1000);
    const end = start + 10;
    const delay = end + 10;

    const { token_params, sale_params } = getTokenAndSaleParams(start, end, delay, new BN(5).mul(new BN(10).pow(new BN(8))));

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
      amount: new BN(50).mul(new BN(10).pow(new BN(9))),
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

    const amountPaymentToken = 10000000000 * (10 ** 9);
    await mintTokens(purshaseAddresses.userPaymentTokenAccount, paymentToken.publicKey, amountPaymentToken);

    await program.methods.buyToken(
      params
    ).accounts({
      ...purshaseAddresses,
    }).signers([user]).rpc().catch(e => console.error(e));

    // we paid 50 usdc at price 0.5$ per token and expected total amount target token must be 100
    const totalAmountTargetToken = 100 * 10 ** 8;
    const expectedVestingBalance = totalAmountTargetToken * 50_00 / 100_00; // 50% from total amount
    const expectedUserBalance = totalAmountTargetToken - expectedVestingBalance;
    const userBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const vestingBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
    const salePaymentBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);

    expect(Number(userBalance.value.amount)).to.be.eq(expectedUserBalance);
    expect(Number(vestingBalance.value.amount)).to.be.eq(expectedVestingBalance);
    expect(Number(salePaymentBalance.value.amount)).to.be.eq(Number(params.amount));

    const params2 = {
      amount: new BN(100).mul(new BN(10).pow(new BN(8))),
      amountSpecifiedInput: false,
    }

    await program.methods.buyToken(
      params2
    ).accounts({
      ...purshaseAddresses,
    }).signers([user]).rpc().catch(e => console.error(e));

    const startPrice = new BN(5).mul(new BN(10).pow(new BN(8)));

    // we want to get 100 token at price 0.5$ per token and expected total amount payment token must be 50
    const totalAmountTargetToken2 = 100 * 10 ** 8;
    const expectedVestingBalance2 = totalAmountTargetToken2 * 50_00 / 100_00; // 50% from total amount
    const expectedUserBalance2 = totalAmountTargetToken - expectedVestingBalance;
    const expectedSalePaymentBalance = Number(params2.amount.mul(startPrice).div(new BN(10).pow(new BN(8))));
    const userBalance2 = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const vestingBalance2 = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
    const salePaymentBalance2 = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);
    
    expect(Number(userBalance2.value.amount)).to.be.eq(expectedUserBalance + expectedUserBalance2);
    expect(Number(vestingBalance2.value.amount)).to.be.eq(expectedVestingBalance + expectedVestingBalance2);
    expect(Number(salePaymentBalance2.value.amount)).to.be.eq(Number(params.amount) + expectedSalePaymentBalance);
  });

  it.skip("buy tokens with different payment tokens", async () => {
    const newPaymentToken = new anchor.web3.Keypair();

    const newSaleAddresses = getCreateSaleAddresses(
      wallet.publicKey,
      mint.publicKey,
      newPaymentToken.publicKey,
      free_account.publicKey,
      program.programId
    );

    const newPurshaseAddresses = getPurshaseAddresses(
      mint.publicKey,
      newPaymentToken.publicKey,
      user2.publicKey,
      program.programId
    );

    const params = {
      amount: new BN(153).mul(new BN(10).pow(new BN(6))), // 15.3 token to buy
      amountSpecifiedInput: false,
    }

    await createMint(provider.connection, wallet.payer, wallet.publicKey, wallet.publicKey, 6, newPaymentToken, {},
      TOKEN_2022_PROGRAM_ID);

      const start = (Date.now() / 1000);
      const end = start + 10;
      const delay = end + 10;
  
      const startPrice = new BN(78).mul(new BN(10).pow(new BN(4))); // price per token 0.78$

      const { token_params, sale_params } = getTokenAndSaleParams(start, end, delay, startPrice);
  
      const tx = await program.methods.createLaunchpad({
        freeAccount: free_account.publicKey,
        freeAmount: new BN(588).mul(new BN(10).pow(new BN(token_params.decimals))),
        createTokenParams: token_params,
        createSaleParams: sale_params,
      }).accounts({
        ...newSaleAddresses
      })
        .preInstructions([additionalComputeBudgetInstruction])
        .signers([wallet.payer, mint]).rpc().catch(e => console.error(e));

    const ATACreationAddresses = [
      {
        user: user2.publicKey,
        mint: newPaymentToken.publicKey
      }, 
      {
        user: user2.publicKey,
        mint: mint.publicKey
      }
    ]

    const transaction = (await createATA(wallet.publicKey, ATACreationAddresses)).add(
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: user2.publicKey,
            lamports: 1000000000, // 1 sol
        })
    );
    
    await provider.sendAndConfirm(transaction, [wallet.payer]);

    const amountPaymentToken = 10000000000 * (10 ** 9);
    await mintTokens(newPurshaseAddresses.userPaymentTokenAccount, newPaymentToken.publicKey, amountPaymentToken);

    await program.methods.buyToken(
      params
    ).accounts({
      ...newPurshaseAddresses,
    }).signers([user2]).rpc().catch(e => console.error(e));

    const totalAmountTargetToken = Number(params.amount);
    const expectedVestingBalance = totalAmountTargetToken * 50_00 / 100_00; // 50% from total amount
    const expectedUserBalance = totalAmountTargetToken - expectedVestingBalance;
    const expectedSalePaymentBalance = Number(params.amount.mul(startPrice).div(new BN(10).pow(new BN(8))));
    const userBalance = await provider.connection.getTokenAccountBalance(newPurshaseAddresses.userTargetTokenAccount);
    const vestingBalance = await provider.connection.getTokenAccountBalance(newPurshaseAddresses.vestingTargetTokenAccount);
    const salePaymentBalance = await provider.connection.getTokenAccountBalance(newPurshaseAddresses.salePaymentTokenAccount);

    expect(Number(userBalance.value.amount)).to.be.eq(expectedUserBalance);
    expect(Number(vestingBalance.value.amount)).to.be.eq(expectedVestingBalance);
    expect(Number(salePaymentBalance.value.amount)).to.be.eq(expectedSalePaymentBalance);
  });

  it.skip('sale timerange test', async () => {
    const newMint = anchor.web3.Keypair.generate();

    const start = (Date.now() / 1000) + 20;
    const end = start + 20;
    const delay = end + 20;

    const { token_params, sale_params } = getTokenAndSaleParams(start, end, delay, new BN(5).mul(new BN(10).pow(new BN(8))));

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

  it('transfer tokens from free account', async () => {
    const tokenAmount = 100 * (10 ** 8);

    const initialFreeAccountBalance  = await provider.connection.getTokenAccountBalance(saleAddresses.freeTokenAccount);
    const initialReceiverBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);

    const tx = await program.methods
      .transferToken(new BN((tokenAmount)))
      .accounts({
        signer: saleAddresses.freeAccount,
        sale: saleAddresses.sale,
        authority: saleAddresses.authority,
        targetToken: saleAddresses.targetToken,
        signerTargetTokenAccount: saleAddresses.freeTokenAccount,
        receiverTargetTokenAccount: purshaseAddresses.userTargetTokenAccount,
        receiver: user.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID
      })
      .signers([free_account])
      .rpc()
      .catch((e) => console.error(e));

      const finalFreeAccountBalance  = await provider.connection.getTokenAccountBalance(saleAddresses.freeTokenAccount);
      const finalReceiverBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
      const accountInfo = await getAccount(provider.connection, purshaseAddresses.userTargetTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);

      expect(accountInfo.isFrozen).to.be.eq(true);
      expect(Number(initialFreeAccountBalance.value.amount) - tokenAmount).to.be.eq(Number(finalFreeAccountBalance.value.amount));
      expect(Number(initialReceiverBalance.value.amount) + tokenAmount).to.be.eq(Number(finalReceiverBalance.value.amount));
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
    await provider.sendAndConfirm(ataTransaction, [wallet.payer]);

    const saleAccountInfo = await program.account.sale.fetch(closeSaleAddresses.sale);
    const liquidityTargetToken = Number(saleAccountInfo.liqAmount);

    const tx = await program.methods
        .closeSale()
        .accounts({
            ...closeSaleAddresses,
        })
        .preInstructions([additionalComputeBudgetInstruction])
        .signers([wallet.payer])
        .rpc()
        .catch((e) => console.error(e));
    
    const targetTokenVaultBalance  = await provider.connection.getTokenAccountBalance(closeSaleAddresses.targetTokenVault);
    const salePaymentBalance = await provider.connection.getTokenAccountBalance(closeSaleAddresses.salePaymentTokenAccount);

    expect(Number(targetTokenVaultBalance.value.amount)).to.be.eq(liquidityTargetToken);
    expect(Number(salePaymentBalance.value.amount)).to.be.eq(0);
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
  
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const accountInfo = await getAccount(provider.connection, purshaseAddresses.userTargetTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(accountInfo.isFrozen).to.be.eq(false);
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
      console.log(userBalanceAfterClaim)
    expect(Number(userBalanceAfterClaim.value.amount)).to.be.eq(Number(userBalanceBeforeClaim.value.amount) + halfTokenAmountInVesting);
    expect(Number(vestingBalanceAfterClaim.value.amount)).to.be.eq(Number(vestingBalanceBeforeClaim.value.amount) - halfTokenAmountInVesting);
  });

  it.skip("swap after sale", async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const initialUserTargetBalance  = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const initialUserPaymentBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount);

    const amountIn = new BN(1000000);
    const minimumAmountOut = new BN(30000);

    const tx = await cp_swap_program.methods.swapBaseInput(
      amountIn, minimumAmountOut
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

    const finalUserTargetBalance  = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
    const finalUserPaymentBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount);

    expect(Number(initialUserTargetBalance.value.amount)).to.be.eq(Number(finalUserTargetBalance.value.amount) + Number(amountIn));
    expect(Number(initialUserPaymentBalance.value.amount)).to.be.lessThan(Number(finalUserPaymentBalance.value.amount) - Number(minimumAmountOut));
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


  it.skip('a', async () => {
    
    const a = cp_swap_program.coder.events.decode('eaPNyTnadTzdhRPKDwus/5Zu2GxjHohlqAXtBbfEKD5ALX5T6bBywABcsuwiAAAAN0A61F0BAAAAzdR9AwAAAAPvGgtcAQAAXdREeQMAAAAAAAAAAAAAAAAAAAAAAAAAAA==');
    
    for (const key in a.data) {
      
      console.log(key + "  " + a.data[key].toString());
    }
  })

  it.only("liq test", async () => {

    

    const start = (Date.now() / 1000);
    const end = start + 5;
    const delay = end + 1;

    const { token_params, sale_params } = getTokenAndSaleParams(start, end, delay);


    const ad = getCloseSaleAddresses(
      wallet.publicKey,
      mint.publicKey,
      paymentToken.publicKey,
      program.programId,
      RAYDIUM_PROGRAM_ID
    );

    const paymentAta =  getAssociatedTokenAddressSync(
      paymentToken.publicKey,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const targetAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const lpAta = getAssociatedTokenAddressSync(
      ad.lpMint,
      user.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const tx = await program.methods.createLaunchpad({
      freeAmount: new BN(600).mul(new BN(10).pow(new BN(token_params.decimals))),
      createTokenParams: token_params,
      createSaleParams: sale_params,
      minCap: new BN(0),
      maxCap: new BN(1000).mul(new BN(10).pow(new BN(token_params.decimals))),
    }).accounts({
      ...saleAddresses
    })
      .preInstructions([additionalComputeBudgetInstruction])
      .signers([wallet.payer, mint]).rpc().catch(e => console.error(e));

      const params = {
        amount: new BN(1000).mul(new BN(10).pow(new BN(8))),
        amountSpecifiedInput: false,
      }
  
      const ATACreationAddresses1 = [
        {
          user: user.publicKey,
          mint: paymentToken.publicKey
        },
        {
          user: user.publicKey,
          mint: mint.publicKey
        }
      ]
  
      const transaction = (await createATA(wallet.publicKey, ATACreationAddresses1))
      .add(
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


      await new Promise((resolve) => setTimeout(resolve, 5000));

      const ATACreationAddresses2 = [
        {
          user: wallet.publicKey,
          mint: mint.publicKey,
        }
      ]
  
      const ataTransaction = await createATA(wallet.publicKey, ATACreationAddresses2);
      await provider.sendAndConfirm(ataTransaction, [wallet.payer])
      // console.log("Sale Payment token: ", await provider.connection.getTokenAccountBalance(closeSaleAddresses.salePaymentTokenAccount));
      // console.log("Sale Target token: ", await provider.connection.getTokenAccountBalance(closeSaleAddresses.saleTargetTokenAccount));


      /// CLOSE
      // console.log('Lp supply_0:' +  (await cp_swap_program.account.poolState.fetch(ad.poolState)).lpSupply.toString( )); 
      console.log("Sale Payment token (before_0): ", (await provider.connection.getTokenAccountBalance(ad.salePaymentTokenAccount)).value.uiAmount);
      console.log("Sale Target token: (before_0):", (await provider.connection.getTokenAccountBalance(ad.saleTargetTokenAccount)).value.uiAmount);
      // console.log("Vault Payment token (before_0): ", (await provider.connection.getTokenAccountBalance(ad.paymentTokenVault)).value.uiAmount);
      // console.log("Vault Target token (before_0): ", (await provider.connection.getTokenAccountBalance(ad.targetTokenVault)).value.uiAmount);
     
      const tx2 = await program.methods.closeSale().accounts({
        ...closeSaleAddresses
      }).preInstructions([additionalComputeBudgetInstruction]).signers([wallet.payer]).rpc().catch(e => console.error(e));
  

      /// THAw
      await program.methods.thawToken().accounts({
        signer: user.publicKey,
        sale: saleAddresses.sale,
        authority: saleAddresses.authority,
        userTargetTokenAccount: purshaseAddresses.userTargetTokenAccount,
        targetToken: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      }).signers([user]).rpc().catch(e => console.error(e));
    
      const ata = await createATA(user.publicKey, [{user: user.publicKey, mint: ad.lpMint, token_program: TOKEN_PROGRAM_ID}]);
      await provider.sendAndConfirm(ata, [user]);
      
      
      const isTargetTokenLess = Buffer.compare(mint.publicKey.toBuffer(), paymentToken.publicKey.toBuffer()) <= 0;
  
      
      // cp_swap_program.m
      // 500 = x* 5000/ 150 = 

      //swap = 
      /*
              let mut token_0_amount = lp_token_amount
            .checked_mul(swap_token_0_amount)?
            .checked_div(lp_token_supply)?;
      */
      //target = 50
      //payment = 5000

      // 45000 = x * 5000/ 150;

      // 150
      // 000000000

      // 1350


      console.log('Lp supply_0:' +  (await cp_swap_program.account.poolState.fetch(ad.poolState)).lpSupply.toString( )); 
      console.log("Sale Payment token (before): ", (await provider.connection.getTokenAccountBalance(ad.salePaymentTokenAccount)).value.uiAmount);
      console.log("Sale Target token: (before):", (await provider.connection.getTokenAccountBalance(ad.saleTargetTokenAccount)).value.uiAmount);
      console.log("Vault Payment token (before): ", (await provider.connection.getTokenAccountBalance(ad.paymentTokenVault)).value.uiAmount);
      console.log("Vault Target token (before): ", (await provider.connection.getTokenAccountBalance(ad.targetTokenVault)).value.uiAmount);
      // await swap()

      let swapTokensAmount = new BN(100).mul(new BN(10).pow(new BN(token_params.decimals)));
      // let lpTokensAmount = new BN(300).mul(new BN(10).pow(new BN(9)));
      const inst = await program.methods.increaseLiq(
        swapTokensAmount,
        new BN(
          // 320000000000
          349000000000
        )
        // lpTokensAmount
      ).accounts({
        ...closeSaleAddresses
      }).signers([wallet.payer]).instruction();

      
      const txl = await createAndSendV0Tx(provider, [inst], wallet.payer)
      console.log("Sale Payment token (after): ", (await provider.connection.getTokenAccountBalance(closeSaleAddresses.salePaymentTokenAccount)).value.uiAmount);
      console.log("Sale Target token (after): ", (await provider.connection.getTokenAccountBalance(closeSaleAddresses.saleTargetTokenAccount)).value.uiAmount);
      console.log("Vault Payment token (after): ", (await provider.connection.getTokenAccountBalance(ad.paymentTokenVault)).value.uiAmount);
      console.log("Vault Target token (after): ", (await provider.connection.getTokenAccountBalance(ad.targetTokenVault)).value.uiAmount);
      await swap()
      console.log('Lp supply_0:' +  (await cp_swap_program.account.poolState.fetch(ad.poolState)).lpSupply.toString( )); 
         
      if(txl){
        const e = await provider.connection.getParsedTransaction(txl, {commitment: 'confirmed', maxSupportedTransactionVersion: 0})
        parseEvents(cp_swap_program, e.meta.logMessages);
      } 
      
    })


  const swap  = async () => {

    const paymentBefore = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount)).value.uiAmount;
    const targetBefore = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount)).value.uiAmount;
    
    console.log("SWAP Payment token before: ", paymentBefore);
    console.log("SWAP  Target token before: ", targetBefore);

    const tx = await cp_swap_program.methods.swapBaseInput(
      new BN(1).mul(
        new BN(10).pow(new BN(8))
      ), new BN(30000)
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


    const paymentAfter = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount)).value.uiAmount;
    const targetAfter = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount)).value.uiAmount;
    

    console.log("SWAP Payment token after: ", paymentAfter);
    console.log("SWAP  Target token after: ", targetAfter);
    console.log("SWAP DIFF: ", paymentBefore - paymentAfter);
  }

  async function createAndSendV0Tx(
    provider: anchor.AnchorProvider,
    txInstructions: anchor.web3.TransactionInstruction[],
    payer: anchor.web3.Signer,
    addressLookupTable: PublicKey[] | undefined = undefined
  ) {
    // Step 1 - Fetch the latest blockhash
    let latestBlockhash = await provider.connection.getLatestBlockhash(
      "confirmed"
    );
    console.log(
      "   ✅ - Fetched latest blockhash. Last Valid Height:",
      latestBlockhash.lastValidBlockHeight
    );
  
    // Step 2 - Generate Transaction Message
    let messageV0;
    if (addressLookupTable) {
  
      const result: anchor.web3.AddressLookupTableAccount[] = []
      for (const address of addressLookupTable) {
        const lookupTableAccount = (
          await provider.connection.getAddressLookupTable(address)
        ).value;
        if (!lookupTableAccount) throw new Error("Address Lookup Table not found");
        result.push(lookupTableAccount)
      }
  
      messageV0 = new anchor.web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions,
      }).compileToV0Message(result);
    } else {
      messageV0 = new anchor.web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions,
      }).compileToV0Message();
    }
  
    console.log("   ✅ - Compiled Transaction Message");
    const transaction = new anchor.web3.VersionedTransaction(messageV0);
  
    // Step 3 - Sign your transaction with the required `Signers`
    transaction.sign([payer]);
    console.log("   ✅ - Transaction Signed");
  
    // Step 4 - Send our v0 transaction to the cluster
    const txid = await provider.connection.sendTransaction(transaction, {
      maxRetries: 5,
    }).catch(err => {
      console.error(err)
      if (err.logs) {
        err.logs.forEach(element => {
          console.error(element)
        });
        parseEvents(cp_swap_program, err.logs);
      }
      throw new Error(err)
    });
    console.log("   ✅ - Transaction sent to network");
  
    // Step 5 - Confirm Transaction
    const confirmation = await provider.connection.confirmTransaction({
      signature: txid,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed');
  
    if (confirmation.value.err) {
      throw new Error(
        `   ❌ - Transaction not confirmed.\nReason: ${confirmation.value.err}`
      );
    }
  
    console.log("🎉 Transaction Successfully Confirmed!");
    return txid;
  }
});


function parseEvents(program: Program<any>, logMessages:  string[]){
  logMessages.forEach(a=>{
    if(a.includes('Program data:', 0)){
      const tmp = a.split(': ');
      // console.log(tmp[1]);
      const obj = program.coder.events.decode(tmp[1]);
      console.log("EVENT: " + obj.name);
      for (const key in obj.data) {
        console.log(key + "  " + obj.data[key].toString());
      }
      console.log("-------------------------------------------------");
    }
    
  })

}

