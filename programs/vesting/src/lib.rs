use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("3HsdG1XceVgBUitEosBpP7EcwWs8yFfS3oN8Qzmv4a3P");

#[program]
pub mod vesting {
    use super::*;

    pub fn initialize_vesting(
        ctx: Context<InitializeVestingAccount>,
        start_date: u32,
        duration: u32,
        amount: u64,
        vesting_type: VestingType,
    ) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_account;

        vesting_account.start_date = start_date;
        vesting_account.duration = duration;
        vesting_account.amount = amount;
        vesting_account.released_amount = 0;
        vesting_account.vesting_type = vesting_type;

        // Transfer tokens to the vault account
        let cpi_accounts = Transfer {
            from: ctx.accounts.sale_account.to_account_info(),
            to: ctx.accounts.vault_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn calculate_releasable_amount(ctx: Context<CalculateReleasableAmount>) -> Result<u64> {
        let vesting_account = &ctx.accounts.vesting_account;
        let current_time = Clock::get()?.unix_timestamp as u32;

        let releasable_amount = match vesting_account.vesting_type {
            VestingType::Simple => {
                if current_time >= vesting_account.start_date + vesting_account.duration {
                    vesting_account.amount
                } else {
                    vesting_account.amount
                }
            }
            VestingType::Linear => {
                if current_time <= vesting_account.start_date {
                    0
                } else if current_time >= vesting_account.start_date + vesting_account.duration {
                    vesting_account.amount
                } else {
                    let elapsed_time = (current_time - vesting_account.start_date) as u64;
                    vesting_account.amount * elapsed_time / vesting_account.duration as u64
                }
            }
        };

        Ok(releasable_amount - vesting_account.released_amount)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum VestingType {
    Simple,
    Linear,
}

#[account]
pub struct VestingAccount {
    pub start_date: u32,
    pub duration: u32,
    pub amount: u64,
    pub released_amount: u64,
    pub vesting_type: VestingType,
}

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

#[derive(Accounts)]
pub struct CalculateReleasableAmount<'info> {
    pub vesting_account: Account<'info, VestingAccount>,
}