//! Error types

use anchor_lang::prelude::*;

#[error_code]
pub enum MemeLaunchpadError {
    #[msg("Account is not authorized to sign this instruction")]
    MultisigAccountNotAuthorized,
    #[msg("Account has already signed this instruction")]
    MultisigAlreadySigned,
    #[msg("This instruction has already been executed")]
    MultisigAlreadyExecuted,
    #[msg("Invalid launchpad config")]
    InvalidLaunchpadConfig,
    #[msg("Invalid custody config")]
    InvalidCustodyConfig,
    #[msg("Invalid sale config")]
    InvalidSaleConfig,
    #[msg("Invalid pricing config")]
    InvalidPricingConfig,
    #[msg("Invalid token amount")]
    InvalidTokenAmount,
    #[msg("Too many remaining accounts")]
    TooManyAccountKeys,
    #[msg("Invalid bid account address")]
    InvalidBidAddress,
    #[msg("Invalid receiving account address")]
    InvalidReceivingAddress,
    #[msg("Invalid dispensing account address")]
    InvalidDispenserAddress,
    #[msg("Dispensing accounts should have the same decimals")]
    InvalidDispenserDecimals,
    #[msg("Invalid seller's balance address")]
    InvalidSellerBalanceAddress,
    #[msg("New sales are not allowed at this time")]
    NewSalesNotAllowed,
    #[msg("Sale updates are not allowed at this time")]
    SaleUpdatesNotAllowed,
    #[msg("Sale refills are not allowed at this time")]
    SaleRefillsNotAllowed,
    #[msg("Sale pull-outs are not allowed at this time")]
    SalePullOutsNotAllowed,
    #[msg("Bids are not allowed at this time")]
    BidsNotAllowed,
    #[msg("Withdrawals are not allowed at this time")]
    WithdrawalsNotAllowed,
    #[msg("Instruction is not allowed in production")]
    InvalidEnvironment,
    #[msg("Sale hasn't started")]
    SaleNotStarted,
    #[msg("Sale has been ended")]
    SaleEnded,
    #[msg("Sale is empty")]
    SaleEmpty,
    #[msg("Sale is not empty")]
    SaleNotEmpty,
    #[msg("Sale is not updatable")]
    SaleNotUpdatable,
    #[msg("Sale with fixed amount")]
    SaleWithFixedAmount,
    #[msg("Sale limit exceeded")]
    SaleLimitExceeded,
    #[msg("Sale is still in progress")]
    SaleInProgress,
    #[msg("Overflow in arithmetic operation")]
    MathOverflow,
    #[msg("Unsupported price oracle")]
    UnsupportedOracle,
    #[msg("Invalid oracle account")]
    InvalidOracleAccount,
    #[msg("Invalid oracle state")]
    InvalidOracleState,
    #[msg("Stale oracle price")]
    StaleOraclePrice,
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    #[msg("Insufficient amount available at the given price")]
    InsufficientAmount,
    #[msg("Bid amount is too large")]
    BidAmountTooLarge,
    #[msg("Bid price is too small")]
    BidPriceTooSmall,
    #[msg("Fill limit exceeded")]
    FillAmountLimit,
    #[msg("Unexpected price calculation error")]
    PriceCalcError,
    #[msg("This instruction must be all alone in the transaction")]
    MustBeSingleInstruction,
    #[msg("Sale is not ready to close")]
    SaleNotReadyToClose,
    #[msg("Pool is not initialized")]
    PoolNotInitialized, 
    #[msg("Invalid pool state")]
    InvalidPoolState,
    #[msg("Amount out is below the minimum cap")]
    BelowMinCap,
    #[msg("Amount out is above the maximum cap")]
    AboveMaxCap,
    #[msg("Sale didn't not sell a sufficient number of tokens")]
    SaleIsNotSuccess,
    #[msg("Refund is not possible because the token balance is zero")]
    InsufficientBalance,
}
