use anchor_lang::prelude::*;
use anchor_spl::{associated_token::{self, AssociatedToken}, token::{self, Mint, Token, TokenAccount, Transfer}};

use crate::state::vesting::{VestingAccount, VestingType};

#[derive(Accounts)]
pub struct InitializeVestingAccount<'info> {
    #[account(
        init,
        payer = signer,
        seeds = [user.key.as_ref(), target_token.key().as_ref()],
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
    /// CHECK:
    pub vault_token_account: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK:
    pub vault_account: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK:
    pub user: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK:
    pub target_token: Account<'info, Mint>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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

    let _ = associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: ctx.accounts.signer.to_account_info(),
            associated_token: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.vault_account.to_account_info(),
            mint: ctx.accounts.target_token.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ));

    // Transfer tokens to the vault account
    let cpi_accounts = Transfer {
        from: ctx.accounts.sale_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.signer.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_ctx, params.amount)?;

    Ok(())
}