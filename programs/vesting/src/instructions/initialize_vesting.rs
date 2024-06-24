use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::vesting::{VestingAccount, VestingType};

#[derive(Accounts)]
pub struct InitializeVestingAccount<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [user.key.as_ref(), target_token.key.as_ref()],
        bump,
        space = 8 + 8 + 8 + 8 + 1
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        mut,
        constraint = sale_account.mint.key() == target_token.key()
    )]
    pub sale_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_account: Account<'info, TokenAccount>, 
    #[account(mut)]
    /// CHECK:
    pub user: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK:
    pub target_token: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VestingParams {
    start_date: u32,
    duration: u32,
    amount: u64,
    vesting_type: VestingType,
}

pub fn initialize_vesting(
    ctx: Context<InitializeVestingAccount>,
    params: VestingParams
) -> Result<()> {
    let vesting_account = &mut ctx.accounts.vesting_account;

    vesting_account.start_date = params.start_date;
    vesting_account.duration = params.duration;
    vesting_account.amount = params.amount;
    vesting_account.released_amount = 0;
    vesting_account.vesting_type = params.vesting_type;

    // Transfer tokens to the vault account
    let cpi_accounts = Transfer {
        from: ctx.accounts.sale_account.to_account_info(),
        to: ctx.accounts.vault_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_ctx, params.amount)?;

    Ok(())
}

// pda program