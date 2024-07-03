import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

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