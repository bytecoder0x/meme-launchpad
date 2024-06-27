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
import { BN } from "bn.js";

describe.only("Vesting", () => {
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

        const { user, userATA, vesting, vestingATA} = await createVesting(vestingParams);
        
        await delay(2000); // 2s

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
        const vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        const vestingPDA = await program.account.vesting.fetch(vesting);    
        
        expect(vestingBalace).to.be.eq("0");
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(vestingParams.amount.toString());
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });

    it("Should correctly claim tokens for Linear type vesting", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 10,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { linear: {} },
        }

        const { user, userATA, vesting, vestingATA } = await createVesting(vestingParams);
        
        // we can assume that the delay time will be 3 seconds, since the execution of all async functions also take time
        await delay(2000); // 3s

        // since 3 seconds have passed and the vesting time is 10 seconds, we can claim 30% from the total amount
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
        const vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        const vestingPDA = await program.account.vesting.fetch(vesting);    

        const tokens70Percent = (700 * 10 ** 9).toString();
        const tokens30Percent = (300 * 10 ** 9).toString();

        expect(vestingBalace).to.be.eq(tokens70Percent); // 100% - 30% = 70%
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(tokens30Percent);
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });

    it("Should correctly claim tokens for Discreate type vesting", async () => {
        const vestingParams = {
            startDate: Math.floor(Date.now() / 1000),
            duration: 10,
            amount: new anchor.BN(1000 * 10 ** 9),
            vestingType: { discreate: [2] }, // we can claim every two seconds 20 % from total amount
        }

        const { user, userATA, vesting, vestingATA } = await createVesting(vestingParams);

        await delay(2000);

        // since 2 seconds have passed and the vesting time is 10 seconds, we can claim 20%
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
        const vestingBalace = (await provider.connection.getTokenAccountBalance(vestingATA)).value.amount;
        const vestingPDA = await program.account.vesting.fetch(vesting);    

        const tokens80Percent = (800 * 10 ** 9).toString();
        const tokens20Percent = (200 * 10 ** 9).toString();

        expect(vestingBalace).to.be.eq(tokens80Percent); // 100% - 20% = 80%
        expect(vestingPDA.releasedAmount.toString()).to.be.eq(tokens20Percent);
        expect(userBalance).to.be.eq(vestingPDA.releasedAmount.toString());
    });
    
});