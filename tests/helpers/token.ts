
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetInstruction, ComputeBudgetProgram, Keypair, PublicKey, Signer, Transaction, } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export async function createATA(
    payer: anchor.web3.PublicKey,
    accounts: {
        user: anchor.web3.PublicKey,
        mint: anchor.web3.PublicKey,
    }[]
) {

    let transaction = new Transaction();

    for (const account of accounts) {

        const ata = getAssociatedTokenAddressSync(
            account.mint,
            account.user,
            false,
            TOKEN_2022_PROGRAM_ID
        )

        transaction = transaction.add(
            createAssociatedTokenAccountInstruction(
                payer,
                ata,
                account.user,
                account.mint,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            ))
    }
    
    return transaction;
}