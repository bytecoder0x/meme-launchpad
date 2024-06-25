//! Error types

use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Overflow in arithmetic operation")]
    Overflow,
    #[msg("Cannot claim: zero tokens available")]
    NoTokensAvailable,
}
