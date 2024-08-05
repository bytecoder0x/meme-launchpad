
mod error;
mod instructions;
mod state;

use {anchor_lang::prelude::*, instructions::*};

declare_id!("6xX32V5PW4Q46qPbpHCYzFyUPXaRvPKnBsse2NimayRs");

#[program]
pub mod meme_launchpad {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    pub fn create_launchpad(ctx: Context<CreateTokenAndSale>, data: CreateTokenAndSaleParams) -> Result<()> {
        return instructions::create_token_and_sale(ctx, data);
    }

    pub fn buy_token(ctx: Context<BuyToken>, data: BuyTokenParams) -> Result<()> {
        return instructions::buy_token(ctx, data);
    }

    pub fn close_sale(ctx: Context<CloseSale>) -> Result<()> {
        return instructions::close_sale(ctx);
    }

    pub fn thaw_token(ctx: Context<ThawToken>) -> Result<()> {
        return instructions::thaw_token(ctx);
    }

    pub fn transfer_to_escrow(ctx: Context<TransferToEscrow>, amount: u64) -> Result<()> {
        return instructions::transfer_to_escrow(ctx, amount);
    }

    pub fn withdraw_from_escrow(ctx: Context<WithdrawFromEscrow>) -> Result<()> {
        return instructions::withdraw_from_escrow(ctx);
    }

    pub fn increase_liq(ctx: Context<IncreaseLiq>) -> Result<()> {
        return instructions::increase_liq(ctx);
    }
}

#[derive(Accounts)]
pub struct Initialize {}
