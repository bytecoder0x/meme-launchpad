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

impl VestingAccount {
    pub fn calculate_releasable_amount(&self, current_time: u32) -> Result<u64> {
        let releasable_amount = match self.vesting_type {
            VestingType::Simple => {
                if current_time >= self.start_date + self.duration {
                    self.amount
                } else {
                    0
                }
            }
            VestingType::Linear => {
                if current_time <= self.start_date {
                    0
                } else if current_time >= self.start_date + self.duration {
                    self.amount
                } else {
                    let elapsed_time = (current_time - self.start_date) as u64;
                    self.amount * elapsed_time / self.duration as u64
                }
            }
        };

        Ok(releasable_amount - self.released_amount)
    }
}