use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint,
    TokenAccount,
    TokenInterface,
    ThawAccount,
    thaw_account,
};

use crate::{
    error::MemeLaunchpadError,
    state::{sale::Sale, token::TokenAuthority},
};

#[derive(Accounts)]
pub struct ThawToken<'info> {
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

    /// CHECK:
    #[account(
        mut,
        constraint = user_target_token_account.mint == sale.token.key(),
        constraint = user_target_token_account.owner == signer.key()
    )]
    pub user_target_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn thaw_token(ctx: Context<ThawToken>) -> Result<()> {

    let curtime = ctx.accounts.sale.get_time()?;
    require!(
        ctx.accounts.sale.is_ready_to_close(curtime),
        MemeLaunchpadError::SaleNotReadyToClose
    );
    
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

    Ok(())
}
