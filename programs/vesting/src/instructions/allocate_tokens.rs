use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, Mint, TransferChecked, transfer_checked};

use crate::{
    error::VestingError,
    state::vesting::Vesting,
};
#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(
        mut,
        seeds = [user.key.as_ref(), target_token.key().as_ref()],
        bump
    )]
    pub vesting: Account<'info, Vesting>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == target_token.key(),
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vesting_token_account: InterfaceAccount<'info, TokenAccount>,
    pub target_token: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn allocate_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
    let vesting = &mut ctx.accounts.vesting;
    let current_time = Clock::get()?.unix_timestamp as u32;

    let claimable_amount = vesting.calculate_releasable_amount(current_time)?;

    require!(claimable_amount > 0, VestingError::NoTokensAvailable);

    vesting.released_amount = vesting
        .released_amount
        .checked_add(claimable_amount)
        .ok_or(VestingError::Overflow)?;

    let target_token = ctx.accounts.target_token.key();
    let user = ctx.accounts.user.key();

    let signer_seeds: &[&[&[u8]]] = &[&[
        user.as_ref(),
        target_token.as_ref(),
        &[ctx.bumps.vesting]
    ]];

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.target_token.to_account_info(),
        from: ctx.accounts.vesting_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vesting.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

    transfer_checked(cpi_ctx, claimable_amount, ctx.accounts.target_token.decimals)?;

    Ok(())
}