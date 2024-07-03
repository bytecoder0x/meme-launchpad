use anchor_lang::prelude::*;
use anchor_spl::{associated_token::{self, AssociatedToken}, token_interface::{
    approve, freeze_account, thaw_account, transfer_checked, Approve, FreezeAccount, Mint, ThawAccount, TokenAccount, TokenInterface, TransferChecked
}};

use vesting::{
    cpi::{accounts::InitializeVestingAccount, create_vesting}, instructions::VestingParams, program::Vesting 
    // instructions::VestingParams,
    // state::vesting::Vesting
};
// use vesting::state::vesting::Vesting;

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

    /// CHECK:
    #[account(mut)]
    pub vesting: AccountInfo<'info>,

    /// CHECK:
    #[account(mut)]
    pub vesting_target_token_account: AccountInfo<'info>,

    system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub vesting_program: Program<'info, Vesting>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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

    let vesting_amount_out = (amount_out * sale.vesting.percentage as u64) / 100_00;
    let user_amount_out = amount_out - vesting_amount_out;

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

    let approve_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Approve {
            to: ctx.accounts.sale_target_token_account.to_account_info(),
            authority: sale.to_account_info(),
            delegate: ctx.accounts.vesting.to_account_info(),
        },
        seeds
    );

    approve(approve_cpi_ctx, vesting_amount_out)?;

    let vesting_params = VestingParams {
        start_date: curtime as u32,
        duration: sale.vesting.duration,
        amount: vesting_amount_out,
        vesting_type: sale.vesting.vesting_model.clone(),
    };

    msg!("transfer target to vesting");
    // transfer vesting_amount from sale_target_token_account vesting_target_token_account
    let vesting_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.vesting_program.to_account_info(),
               InitializeVestingAccount {
            vesting: ctx.accounts.vesting.to_account_info(),
            sale_token_account: ctx.accounts.sale_target_token_account.to_account_info(),
            vesting_token_account: ctx.accounts.vesting_target_token_account.to_account_info(),
            user: ctx.accounts.signer.to_account_info(),
            target_token: ctx.accounts.target_token.to_account_info(),
            signer: ctx.accounts.signer.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        },
        seeds
    );

    create_vesting(vesting_cpi_ctx, vesting_params)?;

    msg!("transfer target");
    // transfer user_amount_out from sale_target_token_account to user_target_token_account
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
    transfer_checked(out_cpi_ctx, user_amount_out, ctx.accounts.target_token.decimals)?;

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
