import * as anchor from "@coral-xyz/anchor";
import { BN, min } from "bn.js";
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
import { getCloseSaleAddresses, getCreateSaleAddresses, getFreeAddresses, getPurshaseAddresses, getTokenAndSaleParams } from "./helpers/sale";
import { createATA } from "./helpers/token";
import { createAndSendV0Tx, expectFail, expectSystemFail } from "./helpers/test";

import raydium_idl from "../idls/raydium_cp_swap.json";
import { RaydiumCpSwap } from "../idls/raydium_types";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";

const Day = 24 * 60 * 60;

const RAYDIUM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const createPoolFeeReveiver = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');

describe.only("meme_launchpad", () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider);

  const program = anchor.workspace.MemeLaunchpad as Program<MemeLaunchpad>;
  const cp_swap_program = new anchor.Program(raydium_idl, provider) as Program<RaydiumCpSwap>;

  const wallet = provider.wallet as anchor.Wallet;

  const additionalComputeBudgetInstruction =
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 600000,
    });

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

  describe("Successful sale", () => {
    const paymentToken = new anchor.web3.Keypair();
    const free_account = new anchor.web3.Keypair();
    const user = new anchor.web3.Keypair();
    const investor = new anchor.web3.Keypair();
    const mint = anchor.web3.Keypair.generate();

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

    const freeAddresses = getFreeAddresses(
      investor.publicKey,
      mint.publicKey,
      free_account.publicKey,
      program.programId,
    );

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
        100_000_000 * (10 ** 9),
        [],
        {},
        TOKEN_2022_PROGRAM_ID
      )
    });
  
    it("Should correctly create launchpad", async () => {
      const { token_params, sale_params } = getTokenAndSaleParams(9);
      const freeAmount = new BN(100).mul(new BN(10).pow(new BN(8))); // 100 tokens
  
      const tx = await program.methods.createLaunchpad({
        freeAccount: free_account.publicKey,
        freeAmount,
        createTokenParams: token_params,
        createSaleParams: sale_params,
      }).accounts({
        ...saleAddresses
      })
        .preInstructions([additionalComputeBudgetInstruction])
        .signers([wallet.payer, mint]).rpc().catch(e => console.error(e));
  
      const saleTargetTokenAccount = await provider.connection.getTokenAccountBalance(saleAddresses.saleTargetTokenAccount);
      const freeTargetTokenAccount = await provider.connection.getTokenAccountBalance(saleAddresses.freeTokenAccount);
  
      expect(saleTargetTokenAccount.value.amount).to.be.eq(sale_params.saleAmount.add(sale_params.saleAmount).toString());
      expect(freeTargetTokenAccount.value.amount).to.be.eq(freeAmount.toString());
    });
  
    it("Should prevent buy tokens if sale hasn't start", async () => {
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
  
      const amount = new BN(100).mul(new BN(10).pow(new BN(8)));
      await expectFail(
        program.methods.buyToken(
          {
            amount: amount,
            amountSpecifiedInput: true,
          }
        ).accounts({ ...purshaseAddresses }).signers([user]).rpc(),
        "Sale hasn't started"
      );
    });
  
    it("Should correctly buy tokens", async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
  
      const params = {
        amount: new BN(2500).mul(new BN(10).pow(new BN(9))), // 2500$
        amountSpecifiedInput: true,
      }
  
      const amountPaymentToken = 1_000_000 * (10 ** 9);
      await mintTokens(purshaseAddresses.userPaymentTokenAccount, paymentToken.publicKey, amountPaymentToken);
  
      await program.methods.buyToken(
        params
      ).accounts({
        ...purshaseAddresses,
      }).signers([user]).rpc().catch(e => console.error(e));
  
      // we paid 2500 usdc at price 5$ per token and expected total amount target token must be 500
      const totalAmountTargetToken = 500 * 10 ** 8;
      const expectedVestingBalance = totalAmountTargetToken * 50_00 / 100_00; // 50% from total amount
      const expectedUserBalance = totalAmountTargetToken - expectedVestingBalance;
      const userBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
      const vestingBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
      const salePaymentBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);
  
      expect(Number(userBalance.value.amount)).to.be.eq(expectedUserBalance);
      expect(Number(vestingBalance.value.amount)).to.be.eq(expectedVestingBalance);
      expect(Number(salePaymentBalance.value.amount)).to.be.eq(Number(params.amount));
  
      const params2 = {
        amount: new BN(500).mul(new BN(10).pow(new BN(8))), // 500 tokens
        amountSpecifiedInput: false,
      }
  
      await program.methods.buyToken(
        params2
      ).accounts({
        ...purshaseAddresses,
      }).signers([user]).rpc().catch(e => console.error(e));
  
      const startPrice = new BN(5).mul(new BN(10).pow(new BN(9)));
  
      // we want to get 500 token at price 5$ per token and expected total amount payment token must be 2500
      const expectedVestingBalance2 = Number(params2.amount) * 50_00 / 100_00; // 50% from total amount
      const expectedUserBalance2 = totalAmountTargetToken - expectedVestingBalance;
      const expectedSalePaymentBalance = Number(params2.amount.mul(startPrice).div(new BN(10).pow(new BN(8))));
      const userBalance2 = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
      const vestingBalance2 = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
      const salePaymentBalance2 = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);
  
      expect(Number(userBalance2.value.amount)).to.be.eq(expectedUserBalance + expectedUserBalance2);
      expect(Number(vestingBalance2.value.amount)).to.be.eq(expectedVestingBalance + expectedVestingBalance2);
      expect(Number(salePaymentBalance2.value.amount)).to.be.eq(expectedSalePaymentBalance + Number(params.amount));
    });
  
    it('Should correctly transfer tokens from free account', async () => {
      const ATACreationAddresses = [
        {
          user: investor.publicKey,
          mint: mint.publicKey,
        }
      ]
  
      const transaction = (await createATA(wallet.publicKey, ATACreationAddresses))
          .add(
              SystemProgram.transfer({
                  fromPubkey: wallet.publicKey,
                  toPubkey: free_account.publicKey,
                  lamports: 1_000_000_000, // 1 sol
              })
          )
          .add(
              SystemProgram.transfer({
                  fromPubkey: wallet.publicKey,
                  toPubkey: investor.publicKey,
                  lamports: 1_000_000_000, // 1 sol
              })
          );

      await provider.sendAndConfirm(transaction, [wallet.payer]);
  
      const initialFreeAccountBalance  = await provider.connection.getTokenAccountBalance(saleAddresses.freeTokenAccount);
      const initialEscrowBalance = 0;
  
      const tokenAmount = 100 * (10 ** 8);
      const tx = await program.methods
        .transferToEscrow(new BN((tokenAmount)))
        .accounts({
          ...freeAddresses
        })
        .signers([free_account])
        .rpc()
        .catch((e) => console.error(e));
  
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const finalFreeAccountBalance  = await provider.connection.getTokenAccountBalance(saleAddresses.freeTokenAccount);
        const finalEscrowBalance = await provider.connection.getTokenAccountBalance(freeAddresses.escrowTargetTokenAccount);
        const accountInfo = await getAccount(provider.connection, saleAddresses.freeTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
  
        expect(accountInfo.isFrozen).to.be.eq(true);
        expect(Number(initialFreeAccountBalance.value.amount) - tokenAmount).to.be.eq(Number(finalFreeAccountBalance.value.amount));
        expect(initialEscrowBalance + tokenAmount).to.be.eq(Number(finalEscrowBalance.value.amount));
    });
  
    it("Should prevent mint more tokens after launch sale", async () => {
      await expectSystemFail(
        mintTokens(purshaseAddresses.userTargetTokenAccount, mint.publicKey, 1),
        "Account is frozen"
      );
      await expectSystemFail(
        mintTokens(purshaseAddresses.saleTargetTokenAccount, mint.publicKey, 1),
        "the total supply of this token is fixed"
      );
    });
  
    it("Should prevent close sale if it isn't ready", async () => {
      const ATACreationAddresses = [
        {
          user: wallet.publicKey,
          mint: mint.publicKey,
        }
      ]
  
      const ataTransaction = await createATA(wallet.publicKey, ATACreationAddresses);
      await provider.sendAndConfirm(ataTransaction, [wallet.payer]);
  
      await expectFail(
            program.methods
          .closeSale()
          .accounts({...closeSaleAddresses,})
          .preInstructions([additionalComputeBudgetInstruction])
          .signers([wallet.payer])
          .rpc(),
            "Sale is not ready to close"
          );
    });
  
    it("Should prevent buy tokens if sale has been ended", async () => {
      await new Promise((resolve) => setTimeout(resolve, 8000));
  
      const amount = new BN(100).mul(new BN(10).pow(new BN(8)));
      await expectFail(
        program.methods.buyToken(
          {
            amount: amount,
            amountSpecifiedInput: true,
          }
        ).accounts({ ...purshaseAddresses }).signers([user]).rpc(),
        "Sale has been ended"
      );
    });
  
    it('Should correctly close sale', async () => {
      const saleAccountInfo = await program.account.sale.fetch(closeSaleAddresses.sale);
      const salePaymentBalance = await provider.connection.getTokenAccountBalance(closeSaleAddresses.salePaymentTokenAccount);
      const liquidityTargetToken = Number(saleAccountInfo.saleAmount) * 100 / 1000;
      const liquidityPaymentToken = Number(salePaymentBalance.value.amount) * 900 / 1000;
  
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
      const paymentTokenVaultBalance  = await provider.connection.getTokenAccountBalance(closeSaleAddresses.paymentTokenVault);
  
      expect(Number(targetTokenVaultBalance.value.amount)).to.be.eq(liquidityTargetToken);
      expect(Number(paymentTokenVaultBalance.value.amount)).to.be.eq(liquidityPaymentToken);
    });
  
    it('Should correctly transfer tokens from escrow to investor if sale is successful', async () => {
      const investorATA = getAssociatedTokenAddressSync(
        mint.publicKey,
        investor.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
  
      const initialEscrowBalance  = await provider.connection.getTokenAccountBalance(freeAddresses.escrowTargetTokenAccount);
  
      const vesting = anchor.web3.PublicKey.findProgramAddressSync(
        [
            investor.publicKey.toBuffer(),
            mint.publicKey.toBuffer()
        ],
        anchor.workspace.Vesting.programId
      )[0];

      const vesting_target_token_account = getAssociatedTokenAddressSync(
        mint.publicKey,
        vesting,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = await program.methods
        .withdrawFromEscrow()
        .accounts({
          receiver: investor.publicKey,
          sale: freeAddresses.sale,
          targetToken: freeAddresses.targetToken,
          vesting,
          vestingTargetTokenAccount: vesting_target_token_account,
          escrow: freeAddresses.escrow,
          escrowTargetTokenAccount: freeAddresses.escrowTargetTokenAccount, 
          receiverTargetTokenAccount: investorATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID
        })
        .signers([investor])
        .rpc()
        .catch((e) => console.error(e));
  
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const finalEscrowBalance  = await provider.connection.getTokenAccountBalance(freeAddresses.escrowTargetTokenAccount);
        const finalInvestorBalance = await provider.connection.getTokenAccountBalance(investorATA);
        const finalVestingBalance = await provider.connection.getTokenAccountBalance(vesting_target_token_account);
        const accountInfo = await getAccount(provider.connection, investorATA, "confirmed", TOKEN_2022_PROGRAM_ID);
  
        const expectedVestingBalance = Number(initialEscrowBalance.value.amount) / 2;
        const expectedInvestorBalance = Number(initialEscrowBalance.value.amount) / 2;

        expect(accountInfo.isFrozen).to.be.eq(true);
        expect(Number(finalEscrowBalance.value.amount)).to.be.eq(0);
        expect(Number(finalInvestorBalance.value.amount)).to.be.eq(expectedInvestorBalance);
        expect(Number(finalVestingBalance.value.amount)).to.be.eq(expectedVestingBalance);
    });
  
    it("Should prevent thaw tokens if the trading hasn't yet started", async () => {
      await expectFail(
        program.methods.thawToken().accounts({
          signer: user.publicKey,
          sale: saleAddresses.sale,
          authority: saleAddresses.authority,
          userTargetTokenAccount: purshaseAddresses.userTargetTokenAccount,
          targetToken: mint.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        }).signers([user]).rpc(),
        "Operation not allowed because token trading is inactive"
      );
    })

    it("Should prevent attacks from sniper bots", async () => {
      const bot = new anchor.web3.Keypair();
      const ATACreationAddresses = [
        {
          user: bot.publicKey,
          mint: mint.publicKey,
        },
        {
          user: bot.publicKey,
          mint: paymentToken.publicKey,
        }
      ]
  
      const ataTransaction = await createATA(wallet.publicKey, ATACreationAddresses);
      await provider.sendAndConfirm(ataTransaction, [wallet.payer]);
  
      const botTargetATA = getAssociatedTokenAddressSync(
        mint.publicKey,
        bot.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
  
      const botPaymentATA =  getAssociatedTokenAddressSync(
        paymentToken.publicKey,
        bot.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
  
      // The price on sale was $5, now the price on radium is 45$
      // So, we should receive not 9 tokens but 1 when buying for $45
      const amountIn = 45 * (10 ** 9);
      await mintTokens(botPaymentATA, paymentToken.publicKey, amountIn);
  
      const initialBotTargetBalance  = await provider.connection.getTokenAccountBalance(botTargetATA);
      const initialBotPaymentBalance = await provider.connection.getTokenAccountBalance(botPaymentATA);
  
      await cp_swap_program.methods.swapBaseInput(
        new BN(amountIn), new BN(0)
      ).accounts({
        payer: bot.publicKey,
        authority: closeSaleAddresses.raydiumAuthority,
        ammConfig: closeSaleAddresses.ammConfig,
        poolState: closeSaleAddresses.poolState,
        inputTokenAccount: botPaymentATA,
        outputTokenAccount: botTargetATA,
        inputVault: closeSaleAddresses.paymentTokenVault,
        outputVault: closeSaleAddresses.targetTokenVault,
        inputTokenProgram: TOKEN_2022_PROGRAM_ID,
        outputTokenProgram: TOKEN_2022_PROGRAM_ID,
        inputTokenMint: paymentToken.publicKey,
        outputTokenMint: mint.publicKey,
        observationState: closeSaleAddresses.observationState,
      }).signers([bot]).rpc().catch(e => console.error(e));
  
      const finalBotTargetBalance  = await provider.connection.getTokenAccountBalance(botTargetATA);
      const finalBotPaymentBalance = await provider.connection.getTokenAccountBalance(botPaymentATA);
  
      expect(Number(initialBotTargetBalance.value.amount)).to.be.eq(0);
      expect(Number(initialBotPaymentBalance.value.amount)).to.be.eq(amountIn);
      expect(Number(finalBotPaymentBalance.value.amount)).to.be.eq(0);
      // We round since bot receive about 0.988 tokens due to the small amount of liquidity in the pool
      expect(Math.round(Number(finalBotTargetBalance.value.uiAmount))).to.be.eq(1);
    });
  
    it("Should correctly increase liquidity and equalize the price on radium", async () => {
      const lpSupplyBefore = (await cp_swap_program.account.poolState.fetch(closeSaleAddresses.poolState)).lpSupply.toNumber(); 
      const salePaymentBalanceBefore = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.salePaymentTokenAccount)).value.amount;
      const saleTargetBalanceBefore = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.saleTargetTokenAccount)).value.amount;
      const vaultPaymentBalanceBefore = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.paymentTokenVault)).value.amount;
      const vaultTargetBalanceBefore = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.targetTokenVault)).value.amount;
  
      const startPrice = 5 * (10 ** 9);
      const currentPrice = (Number(vaultPaymentBalanceBefore) * (10 ** 8)) / Number(vaultTargetBalanceBefore);
      const mulTo = Math.sqrt(currentPrice / startPrice);
      const amountIn = ((Number(vaultTargetBalanceBefore) * mulTo) - Number(vaultTargetBalanceBefore)) * 99 / 100;
      const amountOut = (amountIn * Number(vaultPaymentBalanceBefore)) / (Number(vaultTargetBalanceBefore) + amountIn);
  
      const salePaymentBalanceAfterSwap = Number(salePaymentBalanceBefore) + amountOut;
      const saleTargetBalanceAfterSwap  = Number(saleTargetBalanceBefore) - amountIn;
      const vaultPaymentBalanceAfterSwap  = Number(vaultPaymentBalanceBefore) - amountOut;
      const vaultTargetBalanceAfterSwap  = Number(vaultTargetBalanceBefore) + amountIn;

      const tx = await program.methods.increaseLiq(
        ).accounts({
          ...closeSaleAddresses
        })
        .preInstructions([additionalComputeBudgetInstruction])
        .signers([wallet.payer])
        .rpc()
        .catch((e) => console.error(e));
  
      // await createAndSendV0Tx(provider, [tx], wallet.payer, undefined, cp_swap_program);

      const lpSupplyAfter = (await cp_swap_program.account.poolState.fetch(closeSaleAddresses.poolState)).lpSupply.toNumber(); 
      const salePaymentBalanceAfter = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.salePaymentTokenAccount)).value.amount;
      const saleTargetBalanceAfter = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.saleTargetTokenAccount)).value.amount;
      const vaultPaymentBalanceAfter = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.paymentTokenVault)).value.amount;
      const vaultTargetBalanceAfter = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.targetTokenVault)).value.amount;
      const saleLpBalanceAfter = (await provider.connection.getTokenAccountBalance(closeSaleAddresses.saleLpToken)).value.amount;

      const lpSaleTargetToken = (saleTargetBalanceAfterSwap * lpSupplyBefore) / vaultTargetBalanceAfterSwap;
      const lpSalePaymentToken = (salePaymentBalanceAfterSwap * lpSupplyBefore) / vaultPaymentBalanceAfterSwap;
 
      const newLpAmount = Math.min(lpSaleTargetToken, lpSalePaymentToken);

      const lpDelta = 2 * (10 ** 9); // 2
      const paymentDelta = 3 * (10 ** 9); // 3
      const targetDelta = 10 * (10 ** 8); // 10
      const priceDelta = 1 * (10 ** 8); // 0.1
  
      const saleAccountInfo = await program.account.sale.fetch(closeSaleAddresses.sale);
      const paymnetAmountFromBot = 45 * (10 ** 9);
      const expectedVaultTargetBalance = (startPrice * Number(saleAccountInfo.alreadySold) / 10 ** 8) + paymnetAmountFromBot;
      const radiumPrice = Number(vaultPaymentBalanceAfter) * 10 ** 8 / Number(vaultTargetBalanceAfter);
  
      expect(lpSupplyAfter).to.be.closeTo(newLpAmount + lpSupplyBefore, lpDelta);
      expect(Number(saleTargetBalanceAfter)).to.be.eq(0);
      expect(Number(saleLpBalanceAfter)).to.be.eq(0);
      expect(Number(salePaymentBalanceAfter)).to.be.closeTo(0, paymentDelta);
      expect(Number(vaultTargetBalanceAfter)).to.be.closeTo(Number(saleAccountInfo.alreadySold), targetDelta);
      expect(Number(vaultPaymentBalanceAfter)).to.be.closeTo(expectedVaultTargetBalance, paymentDelta);
      expect(radiumPrice).to.be.closeTo(startPrice, priceDelta);
    });

    it("Should correctly thaw account", async () => {
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
    });

    it("Should correctly claim tokens", async () => {
      const vestingProgram = anchor.workspace.Vesting;
  
      const userBalanceBeforeClaim = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
      const vestingBalanceBeforeClaim = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
      const halfTokenAmountInVesting = Number(vestingBalanceBeforeClaim.value.amount) / 2;
      
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // We can claim half of the amount in vesting. 
      // Since the step is 10 seconds, and about 20 seconds have passed since the beginning of the bought of tokens. 
      // The total vesting time is 40 seconds. 
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
  
    it("Should correctly swap tokens after increase liquidity for correctly price", async () => {
      const price = 5 * (10 ** 9);
      const tokenAmount = new BN(100).mul(new BN(10).pow(new BN(8))); // 100 tokens
      const minExpectedPaymnetAmount = new BN(450).mul(new BN(10).pow(new BN(9))); // price 5$ per one token, but 450 USDC since liq in pool is small
  
      const userTargetBalanceBefore = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount)).value.amount;
      const userPaymentBalanceBefore = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount)).value.amount;
  
      await cp_swap_program.methods.swapBaseInput(
        tokenAmount, new BN(minExpectedPaymnetAmount)
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
  
      const userTargetBalanceAfter = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount)).value.amount;
      const userPaymentBalanceAfter = (await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount)).value.amount;
      
      expect(Number(userTargetBalanceAfter)).to.be.eq(Number(userTargetBalanceBefore) - Number(tokenAmount));
      expect(Number(userPaymentBalanceAfter)).to.be.closeTo(Number(userPaymentBalanceBefore) + Number(minExpectedPaymnetAmount), 50 * (10 ** 9));
    });

    it("Should correctly burn tokens after start of trades", async () => {
      const userBalanceBeforeBurn = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
      const tokenAmount = 1 * (10 ** 8);
  
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

  describe("Unsuccessful sale", () => {
    const paymentToken = new anchor.web3.Keypair();
    const free_account = new anchor.web3.Keypair();
    const user = new anchor.web3.Keypair();
    const investor = new anchor.web3.Keypair();
    const mint = anchor.web3.Keypair.generate();

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
    );

    const closeSaleAddresses = getCloseSaleAddresses(
      wallet.publicKey,
      mint.publicKey,
      paymentToken.publicKey,
      program.programId,
      RAYDIUM_PROGRAM_ID
    );

    const freeAddresses = getFreeAddresses(
      investor.publicKey,
      mint.publicKey,
      free_account.publicKey,
      program.programId,
    );

    before(async () => {
      await createMint(provider.connection, wallet.payer, wallet.publicKey, wallet.publicKey, 6, paymentToken, {},
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
        100_000_000 * (10 ** 6),
        [],
        {},
        TOKEN_2022_PROGRAM_ID
      )
    });

    it("Should correctly buy tokens with specific amount of tokens and different payment token", async () => {
      const { token_params, sale_params } = getTokenAndSaleParams(6);
      const freeAmount = new BN(100).mul(new BN(10).pow(new BN(8))); // 100 tokens
  
      const tx = await program.methods.createLaunchpad({
        freeAccount: free_account.publicKey,
        freeAmount,
        createTokenParams: token_params,
        createSaleParams: sale_params,
      }).accounts({
        ...saleAddresses
      })
        .preInstructions([additionalComputeBudgetInstruction])
        .signers([wallet.payer, mint]).rpc().catch(e => console.error(e));

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
              lamports: 1_000_000_000, // 1 sol
          })
      );
      await provider.sendAndConfirm(transaction, [wallet.payer]);

      const params = {
        amount: new BN(24532).mul(new BN(10).pow(new BN(6))), // 245.32 token to buy
        amountSpecifiedInput: false,
      }
      const amountPaymentToken = 1_000_000 * (10 ** 6);
      await mintTokens(purshaseAddresses.userPaymentTokenAccount, paymentToken.publicKey, amountPaymentToken);

      await new Promise((resolve) => setTimeout(resolve, 4000));

      await program.methods.buyToken(
        params
      ).accounts({
        ...purshaseAddresses,
      }).signers([user]).rpc().catch(e => console.error(e));

      const totalAmountTargetToken = Number(params.amount);
      const expectedVestingBalance = totalAmountTargetToken * 50_00 / 100_00; // 50% from total amount
      const expectedUserBalance = totalAmountTargetToken - expectedVestingBalance;
      const expectedSalePaymentBalance = Number(params.amount.mul(sale_params.pricing.startPrice).div(new BN(10).pow(new BN(8))));
      const userBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);
      const vestingBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.vestingTargetTokenAccount);
      const salePaymentBalance = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);
  
      expect(Number(userBalance.value.amount)).to.be.eq(expectedUserBalance);
      expect(Number(vestingBalance.value.amount)).to.be.eq(expectedVestingBalance);
      expect(Number(salePaymentBalance.value.amount)).to.be.eq(expectedSalePaymentBalance);
    });

    it("Should prevent close sale and initialize pool if sale isn't successful", async () => {
      const ATACreationAddresses = [
        {
          user: wallet.publicKey,
          mint: mint.publicKey,
        }
      ]
  
      const ataTransaction = await createATA(wallet.publicKey, ATACreationAddresses);
      await provider.sendAndConfirm(ataTransaction, [wallet.payer]);

      await new Promise((resolve) => setTimeout(resolve, 10000));

      await expectFail(
          program.methods
        .closeSale()
        .accounts( { ...closeSaleAddresses } )
        .preInstructions([additionalComputeBudgetInstruction])
        .signers([wallet.payer])
        .rpc(),
          "Sale didn't not sell a sufficient number of tokens"
        );
    });

    it("Should correctly transfer payment tokens to user if sale isn't successful", async () => {
      const salePaymentBalanceBefore = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);
      const userPaymentBalanceBefore = await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount);
      const saleTargetBalanceBefore = await provider.connection.getTokenAccountBalance(purshaseAddresses.saleTargetTokenAccount);
      const userTargetBalanceBefore = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);

      await program.methods.refundTokens().accounts({
        ...purshaseAddresses,
      }).signers([user]).rpc().catch(e => console.error(e));

      const salePaymentBalanceAfter = await provider.connection.getTokenAccountBalance(purshaseAddresses.salePaymentTokenAccount);
      const userPaymentBalanceAfter = await provider.connection.getTokenAccountBalance(purshaseAddresses.userPaymentTokenAccount);
      const saleTargetBalanceAfter = await provider.connection.getTokenAccountBalance(purshaseAddresses.saleTargetTokenAccount);
      const userTargetBalanceAfter = await provider.connection.getTokenAccountBalance(purshaseAddresses.userTargetTokenAccount);

      const accountInfo = await getAccount(provider.connection, purshaseAddresses.userTargetTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
  
      expect(accountInfo.isFrozen).to.be.eq(true);
      expect(Number(saleTargetBalanceAfter.value.amount)).to.be.eq(Number(saleTargetBalanceBefore.value.amount) + Number(userTargetBalanceBefore.value.amount));
      expect(Number(salePaymentBalanceBefore.value.amount)).to.be.eq(Number(userPaymentBalanceAfter.value.amount) - Number(userPaymentBalanceBefore.value.amount));
      expect(Number(salePaymentBalanceAfter.value.amount)).to.be.eq(0);
      expect(Number(userTargetBalanceAfter.value.amount)).to.be.eq(0);
    });

    it("Should prevent refund if user has already done it or the balance is zero", async () => {
      await expectFail(
        program.methods.refundTokens().accounts({
          ...purshaseAddresses,
        }).signers([user]).rpc(),
        "Refund is not possible because the token balance is zero"
      );
    });

    it("Should prevent refund for investor if sale isn't successful", async () => {
      const ATACreationAddresses = [
        {
          user: investor.publicKey,
          mint: mint.publicKey,
        }
      ]
  
      const transaction = (await createATA(wallet.publicKey, ATACreationAddresses))
          .add(
              SystemProgram.transfer({
                  fromPubkey: wallet.publicKey,
                  toPubkey: free_account.publicKey,
                  lamports: 1_000_000_000, // 1 sol
              })
          )
          .add(
              SystemProgram.transfer({
                  fromPubkey: wallet.publicKey,
                  toPubkey: investor.publicKey,
                  lamports: 1_000_000_000, // 1 sol
              })
          );

      await provider.sendAndConfirm(transaction, [wallet.payer]);
  
  
      const tokenAmount = 100 * (10 ** 8);
      await program.methods
        .transferToEscrow(new BN((tokenAmount)))
        .accounts({
          ...freeAddresses
        })
        .signers([free_account])
        .rpc()
        .catch((e) => console.error(e));

      const investorATA = getAssociatedTokenAddressSync(
        mint.publicKey,
        investor.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
  
      const vesting = anchor.web3.PublicKey.findProgramAddressSync(
        [
            investor.publicKey.toBuffer(),
            mint.publicKey.toBuffer()
        ],
        anchor.workspace.Vesting.programId
      )[0];

      const vesting_target_token_account = getAssociatedTokenAddressSync(
        mint.publicKey,
        vesting,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      await expectFail(
        program.methods
        .withdrawFromEscrow()
        .accounts({
          receiver: investor.publicKey,
          sale: freeAddresses.sale,
          targetToken: freeAddresses.targetToken,
          vesting,
          vestingTargetTokenAccount: vesting_target_token_account,
          escrow: freeAddresses.escrow,
          escrowTargetTokenAccount: freeAddresses.escrowTargetTokenAccount, 
          receiverTargetTokenAccount: investorATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID
        })
        .signers([investor])
        .rpc(),
        "Sale didn't not sell a sufficient number of tokens"
      );
    });
  });
});
