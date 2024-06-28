
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
}

#[derive(Accounts)]
pub struct Initialize {}
