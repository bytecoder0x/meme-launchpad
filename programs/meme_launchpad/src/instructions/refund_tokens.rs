use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token_interface::{
    freeze_account, thaw_account, transfer_checked, FreezeAccount, Mint, ThawAccount, TokenAccount,
    TokenInterface, TransferChecked,
    }
};

use vesting::program::Vesting;

use crate::{
    error::MemeLaunchpadError,
    state::{sale::Sale, token::TokenAuthority},
};

#[derive(Accounts)]
pub struct RefundTokens<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"sale", target_token.key().as_ref()],
        bump
    )]
    pub sale: Box<Account<'info, Sale>>,

    #[account(
        seeds = [b"authority".as_ref()],
        bump
    )]
    pub authority: Account<'info, TokenAuthority>,

    pub target_token: InterfaceAccount<'info, Mint>,

    pub payment_token: InterfaceAccount<'info, Mint>,

    /// CHECK:
    #[account(
        mut,
        seeds = [signer.key.as_ref(), target_token.key().as_ref()],
        bump,
        seeds::program = vesting_program.key()
    )]
    pub vesting: AccountInfo<'info>,

    /// CHECK:
    #[account(
        mut,
        constraint = vesting_target_token_account.mint == target_token.key(),
        constraint = vesting_target_token_account.owner == vesting.key()
    )]
    pub vesting_target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(
        mut,
        constraint = sale_target_token_account.mint == sale.token.key(),
        constraint = sale_target_token_account.owner == sale.key()
    )]
    pub sale_target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(
        mut,
        constraint = sale_payment_token_account.mint == sale.payment_token.key(),
        constraint = sale_payment_token_account.owner == sale.key()
    )]
    pub sale_payment_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(
        mut,
        constraint = user_payment_token_account.mint == sale.payment_token.key(),
        constraint = user_payment_token_account.owner == signer.key()
    )]
    pub user_payment_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(
        mut,
        constraint = user_target_token_account.mint == sale.token.key(),
        constraint = user_target_token_account.owner == signer.key()
    )]
    pub user_target_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub vesting_program: Program<'info, Vesting>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
    rent: Sysvar<'info, Rent>,
}

pub fn refund_tokens(ctx: Context<RefundTokens>) -> Result<()> {
    let sale = &mut ctx.accounts.sale;
    let curtime = sale.get_time()?;

    require!(
        sale.is_ready_to_close(curtime),
        MemeLaunchpadError::SaleNotReadyToClose
    );

    require!(
        !sale.sale_success,
        MemeLaunchpadError::SaleIsSuccess
    );

    let user_target_token_balance = ctx.accounts.user_target_token_account.amount;
    let vesting_target_token_balance = ctx.accounts.vesting_target_token_account.amount;

    require!(
        user_target_token_balance != 0,
        MemeLaunchpadError::InsufficientBalance
    );


    let total_target_tokens = user_target_token_balance
        .checked_add(vesting_target_token_balance)
        .ok_or(MemeLaunchpadError::MathOverflow)?;

    let target_token_units = 10u64.pow(ctx.accounts.target_token.decimals as u32);
    let price = sale.get_sale_price(total_target_tokens, curtime)?;

    let refund_amount_in_payment_token = (total_target_tokens as u128)
        .checked_mul(price as u128)
        .and_then(|x| x.checked_div(target_token_units as u128))
        .and_then(|x| x.try_into().ok())
        .ok_or(MemeLaunchpadError::MathOverflow)?;

    let target_key = ctx.accounts.target_token.key();
    let sale_signer: &[&[&[u8]]] = &[&["sale".as_bytes(), target_key.as_ref(), &[ctx.bumps.sale]]];

    msg!("transferring payment tokens to user");
    let payment_token_transfer_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.payment_token.to_account_info(),
            from: ctx.accounts.sale_payment_token_account.to_account_info(),
            to: ctx.accounts.user_payment_token_account.to_account_info(),
            authority: sale.to_account_info(),
        },
        sale_signer
    );

    transfer_checked(payment_token_transfer_cpi_ctx, refund_amount_in_payment_token, ctx.accounts.payment_token.decimals)?;

    let authority_signer: &[&[&[u8]]] = &[&[b"authority", &[ctx.bumps.authority]]];

    let thaw_cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ThawAccount {
            account : ctx.accounts.user_target_token_account.to_account_info(),
            mint : ctx.accounts.target_token.to_account_info(),
            authority : ctx.accounts.authority.to_account_info()
        },
        authority_signer
    );
    thaw_account(thaw_cpi_context)?;

    msg!("transferring target tokens to sale");
    let target_token_transfer_cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.target_token.to_account_info(),
            from: ctx.accounts.user_target_token_account.to_account_info(),
            to: ctx.accounts.sale_target_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        },
    );

    transfer_checked(target_token_transfer_cpi_ctx, user_target_token_balance, ctx.accounts.target_token.decimals)?;

    let froze_cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        FreezeAccount {
            account : ctx.accounts.user_target_token_account.to_account_info(),
            mint : ctx.accounts.target_token.to_account_info(),
            authority : ctx.accounts.authority.to_account_info()
        },
        authority_signer
    );
    freeze_account(froze_cpi_context)?;

    Ok(())
}
