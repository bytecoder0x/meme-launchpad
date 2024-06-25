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
import { expect } from "chai";

describe("Vesting", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Vesting as anchor.Program<Vesting>;

    const sale = provider.wallet as anchor.Wallet;
    const user = new anchor.web3.Keypair();
    const paymentToken = new anchor.web3.Keypair();


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

    function delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    it("Create vesting and claim tokens", async () => {
        const vesting = anchor.web3.PublicKey.findProgramAddressSync(
            [user.publicKey.toBuffer(), paymentToken.publicKey.toBuffer()],
            program.programId
        )[0];

        const vestingATA = await getATA(vesting, true);
        const userATA = await createATA(user.publicKey);
        const saleATA = await createATA(sale.publicKey);

        await mint(saleATA);

        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 1,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { simple: {} },
        }

        // create vesting
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
        
        let vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        let vestingPDA = await program.account.vestingAccount.fetch(vesting);

        expect(vestingPDA.amount.toString()).to.be.eq(vestingParams.amount.toString());
        expect(vestingPDA.duration).to.be.eq(vestingParams.duration);
        expect(vestingPDA.releasedAmount.toString()).to.be.eq("0");
        expect(vestingPDA.startDate).to.be.eq(vestingParams.startDate);
        expect(vestingPDA.vestingType).to.deep.eq(vestingParams.vestingType);
        expect(vestingBalace).to.be.eq(vestingParams.amount.toString());

        await delay(5000); // 5s

        // claim tokens
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

        const userBalance = (await provider.connection.getTokenAccountBalance(userATA)).value.amount;
        vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        vestingPDA = await program.account.vestingAccount.fetch(vesting);    
        
        expect(vestingBalace).to.be.eq("0");
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(vestingParams.amount.toString());
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });
});