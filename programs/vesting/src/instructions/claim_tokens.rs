use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    error::VestingError,
    state::vesting::VestingAccount,
};
#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(
        mut,
        seeds = [user.key.as_ref(), target_token.key().as_ref()],
        bump
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == target_token.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault".as_ref(), target_token.key().as_ref()],
        bump
    )]
    pub vault_account: AccountInfo<'info>,
    pub vault_token_account: Account<'info, TokenAccount>,
    pub target_token: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn allocate_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
    let vesting_account = &mut ctx.accounts.vesting_account;
    let current_time = Clock::get()?.unix_timestamp as u32;

    let claimable_amount = vesting_account.calculate_releasable_amount(current_time)?;

    require!(claimable_amount > 0, VestingError::NoTokensAvailable);

    vesting_account.released_amount = vesting_account
        .released_amount
        .checked_add(claimable_amount)
        .ok_or(VestingError::Overflow)?;

    let target_token = ctx.accounts.target_token.key();

    let signer_seeds: &[&[&[u8]]] = &[&[
        "vault".as_bytes(),
        target_token.as_ref(),
        &[ctx.bumps.vault_account]
    ]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault_account.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

    token::transfer(cpi_ctx, claimable_amount)?;

    Ok(())
}