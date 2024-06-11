use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::state::sale::{CommonParams, PricingParams, Sale, SaleStats, _create_sale, CreateSaleParams};

#[derive(Accounts)]
pub struct CreateSale<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Sale::LEN,
        seeds = [b"sale", target_token.key().as_ref()],
        bump
    )]
    pub sale: Box<Account<'info, Sale>>,

    #[account(mut)]
    pub payment_token: Account<'info, Mint>,

    #[account(mut)]
    pub target_token: Account<'info, Mint>,

    /// CHECK:
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    #[account(mut)]
    pub sale_target_token_account: Account<'info, TokenAccount>,

    /// CHECK:
    #[account(mut)]
    pub sale_payment_token_account: Account<'info, TokenAccount>,

    system_program: Program<'info, System>,
    rent: Sysvar<'info, Rent>,
}

// #[derive(AnchorSerialize, AnchorDeserialize)]
// pub struct CreateSaleParams {
//     pub common: CommonParams,
//     pub pricing: PricingParams,
//     pub amount: u64,
//     pub liq_amount: u64,
// }

// pub fn create_sale(ctx: Context<CreateSale>, params: CreateSaleParams) -> Result<()> {
//     _create_sale(
//         ctx.accounts.sale.to_account_info(),
//         ctx.accounts.owner.to_account_info(),
//         ctx.accounts.target_token.key(),
//         ctx.accounts.payment_token.key(),
//         ctx.bumps.sale,
//         params,
//     )
//     // let sale = &mut ctx.accounts.sale;

//     // sale.sale_amount = params.amount;
//     // sale.already_sold = 0;

//     // sale.owner = *ctx.accounts.owner.key;
//     // sale.token = ctx.accounts.target_token.key();
//     // sale.payment_token = ctx.accounts.payment_token.key();
//     // sale.stats = SaleStats::default();
//     // sale.common = params.common;
//     // sale.pricing = params.pricing;
//     // sale.creation_time = sale.get_time()?;
//     // sale.bump = ctx.bumps.sale;

//     // Ok(())
// }
