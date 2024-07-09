use anchor_lang::prelude::*;

use crate::error::VestingError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
#[derive(InitSpace)]
pub enum VestingType {
    Simple,
    Linear,
    Discrete(u32)
}

#[account]
#[derive(InitSpace)]
pub struct Vesting { 
    pub start_date: u32,
    pub duration: u32,
    pub amount: u64,
    pub released_amount: u64,
    pub vesting_type: VestingType,
}

impl Vesting {
    pub fn calculate_releasable_amount(&self, current_time: u32) -> Result<u64> {
        let passed_time = self.start_date.checked_add(self.duration).ok_or(VestingError::Overflow)?;

        let releasable_amount = match self.vesting_type {
            VestingType::Simple => {
                if current_time >=passed_time {
                    self.amount
                } else {
                    0
                }
            }
            VestingType::Linear => {
                if current_time <= self.start_date {
                    0
                } else if current_time >= passed_time {
                    self.amount
                } else {
                    let elapsed_time = (current_time.checked_sub(self.start_date).ok_or(VestingError::Overflow)?) as u64;
                    self.amount
                        .checked_mul(elapsed_time)
                        .and_then(|x| x.checked_div(self.duration as u64))
                        .ok_or(VestingError::Overflow)?
                }
            }
            VestingType::Discrete(frequency) => {
                if current_time <= self.start_date {
                    0
                } else if current_time >= passed_time {
                    self.amount
                } else {
                    let elapsed_time = current_time
                        .checked_sub(self.start_date)
                        .and_then(|x| x.checked_div(frequency))
                        .ok_or(VestingError::Overflow)?;
                    let total_periods = self.duration.checked_div(frequency).ok_or(VestingError::Overflow)?;
                    self.amount
                        .checked_mul(elapsed_time as u64)
                        .and_then(|x| x.checked_div(total_periods as u64))
                        .ok_or(VestingError::Overflow)?
                }
            }
        };

        let available_quantity = releasable_amount
            .checked_sub(self.released_amount)
            .ok_or(VestingError::Overflow)?;

        Ok(available_quantity)
    }
}
