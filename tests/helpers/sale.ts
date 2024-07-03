import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "bn.js";

export function getPurshaseAddresses(
    target_token: anchor.web3.PublicKey,
    payment_token: anchor.web3.PublicKey,
    user: anchor.web3.PublicKey,
    programId: anchor.web3.PublicKey
) {

    const sale = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("sale"),
            target_token.toBuffer(),
        ],
        programId
    )[0]

    const sale_target_token_account = getAssociatedTokenAddressSync(
        target_token,
        sale,
        true,
        TOKEN_2022_PROGRAM_ID
    );

    const sale_payment_token_account = getAssociatedTokenAddressSync(
        payment_token,
        sale,
        true,
        TOKEN_2022_PROGRAM_ID
    );

    const vesting = anchor.web3.PublicKey.findProgramAddressSync(
        [
            user.toBuffer(),
            target_token.toBuffer()
        ],
        anchor.workspace.Vesting.programId
     )[0];

    const vesting_target_token_account = getAssociatedTokenAddressSync(
        target_token,
        vesting,
        true,
        TOKEN_2022_PROGRAM_ID
    );

    const user_payment_token_account = getAssociatedTokenAddressSync(
        payment_token,
        user,
        false,
        TOKEN_2022_PROGRAM_ID
    );

    const user_target_token_account = getAssociatedTokenAddressSync(
        target_token,
        user,
        false,
        TOKEN_2022_PROGRAM_ID
    );

    return {
        signer: user,
        sale,
        saleTargetTokenAccount: sale_target_token_account,
        salePaymentTokenAccount: sale_payment_token_account,
        vesting,
        vestingTargetTokenAccount: vesting_target_token_account,
        userPaymentTokenAccount: user_payment_token_account,
        userTargetTokenAccount: user_target_token_account,
        targetToken: target_token,
        paymentToken: payment_token,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        vestingProgram: anchor.workspace.Vesting.programId
    }

}

export function getCreateSaleAddresses(
    owner: anchor.web3.PublicKey,
    target_token: anchor.web3.PublicKey,
    payment_token: anchor.web3.PublicKey,
    free_account: anchor.web3.PublicKey,
    programId: anchor.web3.PublicKey
) {
    const userATA = getAssociatedTokenAddressSync(
        payment_token,
        owner,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const sale = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("sale"),
            target_token.toBuffer(),
        ],
        programId
    )[0]

    const salePayment = getAssociatedTokenAddressSync(
        payment_token,
        sale,
        true,
        TOKEN_2022_PROGRAM_ID,
    )

    const saleTarget = getAssociatedTokenAddressSync(
        target_token,
        sale,
        true,
        TOKEN_2022_PROGRAM_ID
    )

    const free_account_ATA = getAssociatedTokenAddressSync(
        target_token,
        free_account,
        false,
        TOKEN_2022_PROGRAM_ID
    )
    const authority = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("authority")
        ],
        programId
    )[0]

    return {
        signer: owner,
        targetToken: target_token,
        authority: authority,
        freeTokenAccount: free_account_ATA,
        freeAccount: free_account,
        sale: sale,
        paymentToken: payment_token,
        ownerTokenAccount: userATA,
        saleTargetTokenAccount: saleTarget,
        salePaymentTokenAccount: salePayment,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
    }
}

export function getCloseSaleAddresses(
    owner: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
    paymentToken: anchor.web3.PublicKey,
    programId: anchor.web3.PublicKey,
    raydiumProgramId: anchor.web3.PublicKey,
) {
    const createPoolFeeReveiver = new anchor.web3.PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');

    function u16ToBytes(num: number) {
        const arr = new ArrayBuffer(2);
        const view = new DataView(arr);
        view.setUint16(0, num, false);
        return new Uint8Array(arr);
    }

    const sale = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("sale"),
            mint.toBuffer(),
        ],
        programId
    )[0];

    const raydiumAuthority = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('vault_and_lp_mint_auth_seed')],
        raydiumProgramId
    )[0];

    const ammConfig = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('amm_config'), u16ToBytes(0)],
        raydiumProgramId
    )[0];

    const isTargetTokenLess = mint < paymentToken;
    const poolState = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from('pool'),
            ammConfig.toBytes(),
            ...(isTargetTokenLess ? [mint.toBytes(), paymentToken.toBytes()] : [paymentToken.toBytes(), mint.toBytes()]),
        ],
        raydiumProgramId
    )[0];

    
    const lpMint = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from('pool_lp_mint'),
            poolState.toBytes(),
        ],
        raydiumProgramId
    )[0];

    const saleTargetTokenAccount = getAssociatedTokenAddressSync(
        mint,
        sale,
        true,
        TOKEN_2022_PROGRAM_ID
    );

    const salePaymentTokenAccount = getAssociatedTokenAddressSync(
        paymentToken,
        sale,
        true,
        TOKEN_2022_PROGRAM_ID
    );

    const creatorLpToken = getAssociatedTokenAddressSync(
        lpMint,
        owner,
        true,
        TOKEN_PROGRAM_ID
    );

    const saleLpToken = getAssociatedTokenAddressSync(
        lpMint,
        sale,
        true,
        TOKEN_PROGRAM_ID
    );

    const targetTokenVault = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("pool_vault"),
            poolState.toBytes(),
            mint.toBytes(),
        ],
        raydiumProgramId
    )[0];

    const paymentTokenVault = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("pool_vault"),
            poolState.toBytes(),
            paymentToken.toBytes(),
        ],
        raydiumProgramId
    )[0];

    const observationState = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("observation"),
            poolState.toBytes(),
        ],
        raydiumProgramId
    )[0];

    const authority = anchor.web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("authority")
        ],
        programId
    )[0];

    const userTargetTokenAccount = getAssociatedTokenAddressSync(
        mint,
        owner,
        false,
        TOKEN_2022_PROGRAM_ID
      );

    const userPaymentTokenAccount = getAssociatedTokenAddressSync(
        paymentToken,
        owner,
        false,
        TOKEN_2022_PROGRAM_ID
    );

    return {
        signer: owner,
        ammConfig: ammConfig,
        raydiumAuthority: raydiumAuthority,
        poolState: poolState,
        lpMint: lpMint,
        saleTargetTokenAccount: saleTargetTokenAccount,
        salePaymentTokenAccount: salePaymentTokenAccount,
        userTargetTokenAccount: userTargetTokenAccount,
        userPaymentTokenAccount: userPaymentTokenAccount,
        userLpToken: creatorLpToken,
        saleLpToken: saleLpToken,
        targetTokenVault: targetTokenVault,
        paymentTokenVault: paymentTokenVault,
        createPoolFee: createPoolFeeReveiver,
        observationState: observationState,
        sale: sale,
        authority: authority,
        targetToken: mint,
        paymentToken: paymentToken,
        targetTokenProgram: TOKEN_2022_PROGRAM_ID,
        paymentTokenProgram: TOKEN_2022_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        cpSwapProgram: raydiumProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
    };
}

export function getTokenAndSaleParams(start: number, end: number, delay: number) {
    const token_params = {
        name: "Meme Launchpad",
        symbol: "ML",
        decimals: 8,
        uri: "test/uri",
      }

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
        vesting: {
            duration: 10,
            vestingModel: { discrete: [2] },
            percentage: 50_00, 
        },
        saleAmount: new BN(1000).mul(new BN(10).pow(new BN(token_params.decimals))),
        liqAmount: new BN(700).mul(new BN(10).pow(new BN(token_params.decimals))),
        maxCap: new BN(1000).mul(new BN(10).pow(new BN(token_params.decimals))),
        minCap: new BN(1).mul(new BN(10).pow(new BN(token_params.decimals))),
      }

      return { token_params, sale_params };
}