import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vesting } from "../target/types/vesting";
import {
    createMint,
    createAssociatedTokenAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    mintTo,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";


describe.only("vesting", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Vesting as Program<Vesting>;

    const paymentToken = new anchor.web3.Keypair();
    const vaultAccount = new anchor.web3.Keypair();
    const user = new anchor.web3.Keypair();

    const saleAccount = provider.wallet as anchor.Wallet;

    async function createATA(key: anchor.web3.PublicKey) {
        const ATA = await createAssociatedTokenAccount(
            provider.connection,
            saleAccount.payer,
            paymentToken.publicKey,
            key,
            {},
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        return ATA;
    }

    async function mint(to: anchor.web3.PublicKey) {
        await mintTo(
            provider.connection,
            saleAccount.payer,
            paymentToken.publicKey,
            to,
            saleAccount.payer,
            1000 * 10 ** 9,
            [],
            {},
            TOKEN_PROGRAM_ID
        );
    }

    before(async () => {
        await createMint(
            provider.connection,
            saleAccount.payer,
            saleAccount.publicKey,
            saleAccount.publicKey,
            9,
            paymentToken,
            {},
            TOKEN_PROGRAM_ID
        );
    });

    it("Initialize vesting account", async () => {
        // const userATA = await createATA(user.publicKey);
        // const vaultATA = await createATA(vaultAccount.publicKey);
        const saleATA = await createATA(saleAccount.publicKey);
        const vesting = anchor.web3.PublicKey.findProgramAddressSync(
            [user.publicKey.toBuffer(), paymentToken.publicKey.toBuffer()],
            program.programId
        )[0];

        await mint(saleATA);

        const params = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 0, // 30 days in seconds
            amount: new anchor.BN(1000),
            vestingType: { simple: {} },
        }

        const vaultATA = await getAssociatedTokenAddress(
            paymentToken.publicKey,
            vaultAccount.publicKey,
            false,
            TOKEN_PROGRAM_ID,
        )

        await program.methods
            .createVesting(params)
            .accounts({
                vestingAccount: vesting,
                saleAccount: saleATA,
                vaultTokenAccount: vaultATA,
                vaultAccount: vaultAccount.publicKey,
                targetToken: paymentToken.publicKey,
                user: user.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
            })
            .signers([saleAccount.payer])
            .rpc().catch(err => console.log(err));
        
        // const releasableAmount = await program.methods
        //     .calculateReleasableAmount()
        //     .accounts({ vestingAccount })
        //     .view();
        // console.log(startDate);

        // const account = await program.account.vestingAccount.fetch(vesting);
        // console.log("Vesting Account: ", account);
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