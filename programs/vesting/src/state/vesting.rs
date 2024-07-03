use anchor_lang::prelude::*;

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
            VestingType::Discrete(frequency) => {
                if current_time <= self.start_date {
                    0
                } else if current_time >= self.start_date + self.duration {
                    self.amount
                } else {
                    let elapsed_time = (current_time - self.start_date) / frequency;
                    let total_periods  = self.duration / frequency;
                    self.amount * elapsed_time as u64 / total_periods as u64
                }
            }
        };

        Ok(releasable_amount - self.released_amount)
    }
}