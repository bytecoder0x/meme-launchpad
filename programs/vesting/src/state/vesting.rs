use anchor_lang::prelude::*;

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
pub struct CalculateReleasableAmount<'info> {
    pub vesting_account: Account<'info, VestingAccount>,
}

pub fn _calculate_releasable_amount(ctx: Context<CalculateReleasableAmount>) -> Result<u64> {
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