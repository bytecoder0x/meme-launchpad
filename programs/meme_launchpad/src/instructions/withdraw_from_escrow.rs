use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{
    freeze_account, thaw_account, transfer_checked, FreezeAccount, Mint, ThawAccount, TokenAccount, TokenInterface, TransferChecked
}};

use crate::{error::MemeLaunchpadError, state::{sale::Sale, token::TokenAuthority}};

#[derive(Accounts)]
pub struct WithdrawFromEscrow<'info> {
    #[account(mut)]
    pub receiver: Signer<'info>,

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
        seeds = [receiver.key().as_ref(), sale.key().as_ref()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,

    #[account(mut)]
    pub escrow_target_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = receiver,
        associated_token::mint = target_token,
        associated_token::authority = receiver,
    )]
    pub receiver_target_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
}

pub fn withdraw_from_escrow(ctx: Context<WithdrawFromEscrow>) -> Result<()> {
    require!(
        ctx.accounts.sale.sale_success,
        MemeLaunchpadError::SaleIsNotSuccess
    );

    let receiver = ctx.accounts.receiver.key();
    let sale = ctx.accounts.sale.key();

    let escrow_signer: &[&[&[u8]]] = &[&[receiver.as_ref(), sale.as_ref(), &[ctx.bumps.escrow_account]]];
    let authority_signer: &[&[&[u8]]] = &[&[b"authority", &[ctx.bumps.authority]]];

    if ctx.accounts.receiver_target_token_account.is_frozen() {
        let thaw_cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            ThawAccount {
                account : ctx.accounts.receiver_target_token_account.to_account_info(),
                mint : ctx.accounts.target_token.to_account_info(),
                authority : ctx.accounts.authority.to_account_info()
            },
            authority_signer
        );
        thaw_account(thaw_cpi_context)?;    
    }

    let transfer_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.target_token.to_account_info(),
            from: ctx.accounts.escrow_target_token_account.to_account_info(),
            to: ctx.accounts.receiver_target_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        },
        escrow_signer
    );
    let amount_to_transfer = ctx.accounts.escrow_target_token_account.amount;

    transfer_checked(transfer_cpi_ctx, amount_to_transfer, ctx.accounts.target_token.decimals)?;

    let froze_cpi_context_receiver = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        FreezeAccount {
            account : ctx.accounts.receiver_target_token_account.to_account_info(),
            mint : ctx.accounts.target_token.to_account_info(),
            authority : ctx.accounts.authority.to_account_info()
        },
        authority_signer
    );
    freeze_account(froze_cpi_context_receiver)?;

    Ok(())
}
