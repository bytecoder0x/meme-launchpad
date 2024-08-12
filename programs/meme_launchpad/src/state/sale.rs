use anchor_lang::{prelude::*, solana_program};
use anchor_spl::associated_token;

use vesting::state::vesting::VestingType;

use crate::error::MemeLaunchpadError;

#[derive(Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Default, Debug)]
pub struct BidderStats {
    pub fills_volume: u64,
    pub weighted_fills_sum: u128,
    pub min_fill_price: u64,
    pub max_fill_price: u64,
    pub num_trades: u64,
}

#[derive(Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Default, Debug)]
pub struct SaleStats {
    pub first_trade_time: i64,
    pub last_trade_time: i64,
    pub last_amount: u64,
    pub last_price: u64,
    pub wl_bidders: BidderStats,
    pub reg_bidders: BidderStats,
}

#[derive(Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Default, Debug)]
pub struct CommonParams {
    pub name: String,
    pub description: String,
    pub about_seller: String,
    pub seller_link: String,
    pub start_time: i64,
    pub end_time: i64,
    pub close_time: i64,
}

#[derive(Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Debug)]
pub enum PricingModel {
    Fixed,
}

impl Default for PricingModel {
    fn default() -> Self {
        Self::Fixed
    }
}

#[derive(Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Debug)]
pub enum RepriceFunction {
    Linear,
    Exponential,
}

impl Default for RepriceFunction {
    fn default() -> Self {
        Self::Linear
    }
}

#[derive(Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Debug)]
pub enum AmountFunction {
    Fixed,
}

impl Default for AmountFunction {
    fn default() -> Self {
        Self::Fixed
    }
}

#[derive(Copy, Clone, PartialEq, AnchorSerialize, AnchorDeserialize, Default, Debug)]
pub struct PricingParams {
    pub pricing_model: PricingModel,
    pub amount_function: AmountFunction,
    pub start_price: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VestingParams {
    pub vesting_model: VestingType,
    pub duration: u32,
    pub percentage: u32,
}

#[account]
pub struct Sale {
    pub owner: Pubkey,

    pub common: CommonParams,

    pub pricing: PricingParams,
    pub vesting: VestingParams,

    pub token: Pubkey,
    pub payment_token: Pubkey,

    pub sale_amount: u64,
    pub liq_amount: u64,

    pub min_cap: u64,
    pub max_cap: u64,
    pub free_wallet: Pubkey,
    pub already_sold: u64,

    pub is_token_trading: bool,
    
    pub creation_time: i64,

    pub stats: SaleStats,
    pub bump: u8,
}

impl CommonParams {
    // todo: check
    pub fn validate(&self, curtime: i64) -> bool {
        (self.end_time > 0 && self.start_time > 0)
            || (self.end_time > self.start_time && self.end_time > curtime)
    }
}

impl PricingParams {
    pub fn validate(&self) -> bool {
        self.pricing_model == PricingModel::Fixed && self.start_price > 0
    }
}

impl Sale {
    pub const LEN: usize = 8 + std::mem::size_of::<Sale>();
    pub const MAX_TOKENS: usize = 10;

    pub fn validate(&self) -> Result<bool> {
        Ok(self.common.name.len() >= 6
            && self.common.validate(self.get_time()?)
            && self.pricing.validate())
    }

    pub fn is_success(&self) -> bool  {
        let tokens_sold_percentage = self
            .already_sold
            .checked_mul(100_00 as u64)
            .and_then(|x| x.checked_div(self.sale_amount))
            .unwrap();

        tokens_sold_percentage >= 75_00
    }

    /// checks if sale has started
    pub fn is_started(&self, curtime: i64) -> bool {
        self.common.start_time > 0 && curtime >= self.common.start_time
    }

    /// Checks if the sale is ended
    pub fn is_ended(&self, curtime: i64) -> bool {
        curtime >= self.common.end_time
    }

    /// Checks if the sale is ready to close
    pub fn is_ready_to_close(&self, curtime: i64) -> bool {
        curtime >= self.common.close_time
    }

    // #[cfg(feature = "test")]
    // pub fn get_time(&self) -> Result<i64> {
    //     Ok(self.creation_time)
    // }

    #[cfg(not(feature = "test"))]
    pub fn get_time(&self) -> Result<i64> {
        let time = solana_program::sysvar::clock::Clock::get()?.unix_timestamp;
        if time > 0 {
            Ok(time)
        } else {
            Err(ProgramError::InvalidAccountData.into())
        }
    }

    pub fn get_start_time(&self) -> i64 {
        self.common.start_time
    }

    pub fn get_end_time(&self) -> i64 {
        self.common.end_time
    }

    pub fn get_sale_amount(&self) -> Result<u64> {
        match self.pricing.pricing_model {
            PricingModel::Fixed => self.get_sale_amount_fixed(),
        }
    }

    pub fn get_sale_price(&self, amount: u64, curtime: i64) -> Result<u64> {
        match self.pricing.pricing_model {
            PricingModel::Fixed => self.get_sale_price_fixed(),
        }
    }

    fn get_sale_amount_fixed(&self) -> Result<u64> {
        Ok(u64::MAX)
    }

    fn get_sale_price_fixed(&self) -> Result<u64> {
        Ok(self.pricing.start_price)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateSaleParams {
    pub common: CommonParams,
    pub pricing: PricingParams,
    pub vesting: VestingParams,
    pub sale_amount: u64,
    pub min_cap: u64,
    pub max_cap: u64,
}

pub fn _create_sale<'info>(
    _sale: &mut Account<'info, Sale>,
    // _sale: &AccountInfo<'info>,
    owner: AccountInfo<'info>,
    target_token: AccountInfo<'info>,
    target_ata: AccountInfo<'info>,
    payment_ata: AccountInfo<'info>,
    payment_token: AccountInfo<'info>,
    sale_bump: u8,
    associated_token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    params: CreateSaleParams,
    free_wallet: Pubkey,
) -> Result<()> {
    msg!("Creating Sale Account");
    
    let six_months_in_seconds = 6 * 30 * 24 * 60 * 60;
    require!(
        params.common.end_time - params.common.start_time <= six_months_in_seconds,
        MemeLaunchpadError::PreSaleTooLong
    );

    let three_months_in_seconds = 3 * 30 * 24 * 60 * 60;
    require!(
        params.common.close_time - params.common.end_time <= three_months_in_seconds,
        MemeLaunchpadError::LateTradingStart
    );

    let cpi_ctx = CpiContext::new(
        associated_token_program.to_account_info(),
        associated_token::Create {
            payer: owner.to_account_info(),
            associated_token: target_ata.to_account_info(),
            authority: _sale.to_account_info(),
            mint: target_token.to_account_info(),
            system_program: system_program.to_account_info(),
            token_program: token_program.to_account_info(),
        },
    );

    let _ = associated_token::create(cpi_ctx);

    msg!("Creating payment associated token account");
    let _ = associated_token::create(CpiContext::new(
        associated_token_program.to_account_info(),
        associated_token::Create {
            payer: owner.to_account_info(),
            associated_token: payment_ata.to_account_info(),
            authority: _sale.to_account_info(),
            mint: payment_token.to_account_info(),
            system_program: system_program.to_account_info(),
            token_program: token_program.to_account_info(),
        },
    ));

    msg!("Setting Sale Account");
    msg!("sale amount: {}", params.sale_amount);

    let sale = _sale;

    sale.sale_amount = params.sale_amount;
    sale.already_sold = 0;
    sale.owner = owner.key();
    sale.token = target_token.key();
    sale.payment_token = payment_token.key();
    sale.stats = SaleStats::default();
    sale.common = params.common;
    sale.pricing = params.pricing;
    sale.min_cap = params.min_cap;
    sale.max_cap = params.max_cap;
    sale.free_wallet = free_wallet;
    sale.vesting = params.vesting;
    sale.creation_time = sale.get_time()?;
    sale.bump = sale_bump;

    Ok(())
}
