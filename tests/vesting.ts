import * as anchor from "@coral-xyz/anchor";
import { Vesting } from "../target/types/vesting";
import {
    createMint,
    createAssociatedTokenAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    mintTo
} from "@solana/spl-token";


describe.only("vesting", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Vesting as anchor.Program<Vesting>;

    const user = new anchor.web3.Keypair();
    const paymentToken = new anchor.web3.Keypair();

    const sale = provider.wallet as anchor.Wallet;

    async function createATA(key: anchor.web3.PublicKey) {
        const ATA = await createAssociatedTokenAccount(
            provider.connection,
            sale.payer,
            paymentToken.publicKey,
            key,
            {},
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        return ATA;
    }

    async function getATA(key: anchor.web3.PublicKey, PDA: boolean) {
        const ATA = await getAssociatedTokenAddress(
            paymentToken.publicKey,
            key,
            PDA,
            TOKEN_PROGRAM_ID,
        )

        return ATA;
    }

    async function mint(to: anchor.web3.PublicKey) {
        await mintTo(
            provider.connection,
            sale.payer,
            paymentToken.publicKey,
            to,
            sale.payer,
            1000 * 10 ** 9,
            [],
            {},
            TOKEN_PROGRAM_ID
        );
    }

    before(async () => {
        await createMint(
            provider.connection,
            sale.payer,
            sale.publicKey,
            sale.publicKey,
            9,
            paymentToken,
            {},
            TOKEN_PROGRAM_ID
        );
    });

    it("Initialize vesting account", async () => {
        const vesting = anchor.web3.PublicKey.findProgramAddressSync(
            [user.publicKey.toBuffer(), paymentToken.publicKey.toBuffer()],
            program.programId
        )[0];

        const userATA = await createATA(user.publicKey);
        const saleATA = await createATA(sale.publicKey);
        const vestingATA = await getATA(vesting, true);
        await mint(saleATA);

        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 1,
            amount: new anchor.BN(1000),
            vestingType: { simple: {} },
        }

        await program.methods
            .createVesting(vestingParams)
            .accounts({
                vesting: vesting,
                saleTokenAccount: saleATA,
                vestingTokenAccount: vestingATA,
                targetToken: paymentToken.publicKey,
                user: user.publicKey,
                signer: sale.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
            })
            .signers([sale.payer])
            .rpc().catch(err => console.log(err));
        
            function delay(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            await delay(1000 * 10);

            await program.methods
                .claimTokens()
                .accounts({
                    vesting: vesting,
                    userTokenAccount: userATA,
                    vestingTokenAccount: vestingATA,
                    targetToken: paymentToken.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    user: user.publicKey,
                })
                .signers([user])
                .rpc().catch(err => console.log(err));

        const account = await program.account.vestingAccount.fetch(vesting);
        console.log("Vesting Account: ", account);
    });
});


// const transaction = new Transaction().add(
//     createAssociatedTokenAccountInstruction(
//         wallet.publicKey,
//         saleATA,
//         saleAccount.publicKey,
//         paymentToken.publicKey,
//         TOKEN_PROGRAM_ID,
//         ASSOCIATED_TOKEN_PROGRAM_ID
//     )
// );

// await provider.sendAndConfirm(transaction, [wallet.payer]);