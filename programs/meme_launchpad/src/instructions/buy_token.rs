use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked,
    Mint,
    TokenAccount,
    TokenInterface,
    TransferChecked,
    ThawAccount,
    thaw_account,
    freeze_account,
    FreezeAccount,
};

use crate::{
    error::MemeLaunchpadError,
    state::{sale::Sale, token::TokenAuthority},
};

#[derive(Accounts)]
pub struct BuyToken<'info> {
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

    system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyTokenParams {
    pub amount: u64,
    pub amount_specified_input: bool,
}

pub fn buy_token(ctx: Context<BuyToken>, params: BuyTokenParams) -> Result<()> {
    let sale = &mut ctx.accounts.sale;
    let curtime = sale.get_time()?;

    require!(sale.is_started(curtime), MemeLaunchpadError::SaleNotStarted);

    require!(!sale.is_ended(curtime), MemeLaunchpadError::SaleEnded);

    let price = sale.get_sale_price(params.amount, curtime)?;
    let amount_in;
    let amount_out;
    // let total_price = price * amount;

    if params.amount_specified_input {
        amount_in = params.amount;
        amount_out = amount_in / price;
    } else {
        amount_out = params.amount;
        amount_in = amount_out * price;
    }

    if sale.already_sold + amount_out >= sale.sale_amount {
        return Err(MemeLaunchpadError::SaleLimitExceeded.into());
    }

    msg!("transfer paymment");
    // transfer amount_in from user_payment_token_account to sale_payment_token_account
    let in_cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.payment_token.to_account_info(),
            from: ctx.accounts.user_payment_token_account.to_account_info(),
            to: ctx.accounts.sale_payment_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        },
    );

    transfer_checked(in_cpi_ctx, amount_in, ctx.accounts.payment_token.decimals)?;

    // todo: impelement vesting

    
    let target_key = ctx.accounts.target_token.key();
    // signer seeds for sale
    let seeds: &[&[&[u8]]] = &[&[
        "sale".as_bytes(),
        target_key.as_ref(),
        &[ctx.bumps.sale]
    ]];

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

    msg!("transfer target");
    // transfer amount_out from sale_target_token_account to user_target_token_account
    let out_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.target_token.to_account_info(),
            from: ctx.accounts.sale_target_token_account.to_account_info(),
            to: ctx.accounts.user_target_token_account.to_account_info(),
            authority: sale.to_account_info(),
        },
        seeds,
    );
    transfer_checked(out_cpi_ctx, amount_out, ctx.accounts.target_token.decimals)?;


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

    sale.already_sold += amount_out;

    Ok(())
}
