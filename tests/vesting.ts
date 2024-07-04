import * as anchor from "@coral-xyz/anchor";
import { Vesting } from "../target/types/vesting";
import {
    createMint,
    createAssociatedTokenAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    mintTo,
    approve
} from "@solana/spl-token";
import { expect } from "chai";
import { expectFail } from "./helpers/test";

describe("Vesting", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Vesting as anchor.Program<Vesting>;

    const sale = provider.wallet as anchor.Wallet;
    const paymentToken = new anchor.web3.Keypair();

    async function getATA(key: anchor.web3.PublicKey, PDA: boolean) {
        const ATA = await getAssociatedTokenAddress(
            paymentToken.publicKey,
            key,
            PDA,
            TOKEN_PROGRAM_ID,
        )

        return ATA;
    }

    async function createATA(key: anchor.web3.PublicKey, PDA: boolean) {
        let ATA = await getATA(key, PDA);

        const accountInfo = await provider.connection.getAccountInfo(ATA);
        if (accountInfo === null) {
            await createAssociatedTokenAccount(
                provider.connection,
                sale.payer,
                paymentToken.publicKey,
                key,
                {},
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
            );
        }

        return ATA;
    }

    async function mintTokens(to: anchor.web3.PublicKey) {
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

    async function createVesting(params: any) {
        const user = new anchor.web3.Keypair();
        const vesting = anchor.web3.PublicKey.findProgramAddressSync(
            [user.publicKey.toBuffer(), paymentToken.publicKey.toBuffer()],
            program.programId
        )[0];

        const vestingATA = await getATA(vesting, true);
        const userATA = await createATA(user.publicKey, false);
        const saleATA = await createATA(sale.publicKey, false);

        await approve(provider.connection, sale.payer, saleATA, vesting, sale.publicKey, params.amount, [], {}, TOKEN_PROGRAM_ID);

        await mintTokens(saleATA);

        await program.methods
            .createVesting(params)
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

            return { user, userATA, vesting, vestingATA };
    }

    async function claimTokens(params: any) {
        await program.methods
            .claimTokens()
            .accounts({
                vesting: params.vesting,
                userTokenAccount: params.userATA,
                vestingTokenAccount: params.vestingATA,
                targetToken: paymentToken.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
                user: params.user.publicKey,
            })
            .signers([params.user])
            .rpc();
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

    it("Should correctly create vesting", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 1,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { simple: {} },
        }

        const { vesting, vestingATA } = await createVesting(vestingParams);
        
        const vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        const vestingPDA = await program.account.vesting.fetch(vesting);

        expect(vestingPDA.amount.toString()).to.be.eq(vestingParams.amount.toString());
        expect(vestingPDA.duration).to.be.eq(vestingParams.duration);
        expect(vestingPDA.releasedAmount.toString()).to.be.eq("0");
        expect(vestingPDA.startDate).to.be.eq(vestingParams.startDate);
        expect(vestingPDA.vestingType).to.deep.eq(vestingParams.vestingType);
        expect(vestingBalace).to.be.eq(vestingParams.amount.toString());
    });

    it("Should correctly claim tokens for Simple type vesting", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 1,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { simple: {} },
        }

        const { user, userATA, vesting, vestingATA } = await createVesting(vestingParams);
        await delay(4000); // 5s
        await claimTokens({ user, userATA, vesting, vestingATA })

        const userBalance = (await provider.connection.getTokenAccountBalance(userATA)).value.amount;
        const vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        const vestingPDA = await program.account.vesting.fetch(vesting);    
        
        expect(vestingBalace).to.be.eq("0");
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(vestingParams.amount.toString());
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });

    it("Should correctly claim tokens for Linear type vesting", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 5,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { linear: {} },
        }

        const { user, userATA, vesting, vestingATA } = await createVesting(vestingParams);
        
        await delay(7000);
        await claimTokens({ user, userATA, vesting, vestingATA });

        const userBalance = (await provider.connection.getTokenAccountBalance(userATA)).value.amount;
        const vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        const vestingPDA = await program.account.vesting.fetch(vesting);    

        const tokens100Percent = (1000 * 10 ** 9).toString();

        expect(vestingBalace).to.be.eq("0");
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(tokens100Percent);
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });

    it("Should correctly claim tokens for Discreate type vesting", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 10,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { discrete: [5] }, // we can claim every 5 seconds 50 % from total amount
        }

        const { user, userATA, vesting, vestingATA } = await createVesting(vestingParams);

        await delay(7000);
        await claimTokens({ user, userATA, vesting, vestingATA });

        let userBalance = (await provider.connection.getTokenAccountBalance(userATA)).value.amount;
        let vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        let vestingPDA = await program.account.vesting.fetch(vesting);    

        const tokens50Percent = (500 * 10 ** 9).toString();

        expect(vestingBalace).to.be.eq(tokens50Percent.toString());
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(tokens50Percent);
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());

        await delay(5000);
        await claimTokens({ user, userATA, vesting, vestingATA });

        userBalance = (await provider.connection.getTokenAccountBalance(userATA)).value.amount;
        vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        vestingPDA = await program.account.vesting.fetch(vesting);    

        const tokens100Percent = (1000 * 10 ** 9).toString();

        expect(vestingBalace).to.be.eq("0");
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(tokens100Percent);
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });

    it("Should prevent claim tokens if not available due to time or all tokens claimed", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 2,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { simple: {} },
        }

        const { user, userATA, vesting, vestingATA } = await createVesting(vestingParams);

        await expectFail(claimTokens({ user, userATA, vesting, vestingATA }), "Cannot claim: zero tokens available");
        
        await delay(2000);
        await claimTokens({ user, userATA, vesting, vestingATA });

        await expectFail(claimTokens({ user, userATA, vesting, vestingATA }), "Cannot claim: zero tokens available");
    })
    
});