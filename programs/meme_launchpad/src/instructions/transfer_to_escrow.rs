use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{
    freeze_account, thaw_account, transfer_checked, FreezeAccount, Mint, ThawAccount, TokenAccount, TokenInterface, TransferChecked
}};

use crate::state::{sale::Sale, token::TokenAuthority};


#[derive(Accounts)]
pub struct TransferToEscrow<'info> {
    #[account(mut,
        address = sale.free_wallet
    )]
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

    #[account(
        mut,
        constraint = signer_target_token_account.mint == sale.token.key(),
        constraint = signer_target_token_account.owner == signer.key()
    )]
    pub signer_target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(
        init_if_needed,
        payer = signer,
        seeds = [receiver.key().as_ref(), sale.key().as_ref()],
        bump,
        space = 8
    )]
    pub escrow_account: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = target_token,
        associated_token::authority = escrow_account,
    )]
    pub escrow_target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: 
    pub receiver: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
}

pub fn transfer_to_escrow(ctx: Context<TransferToEscrow>, amount: u64) -> Result<()> {
    let authority_signer: &[&[&[u8]]] = &[&[b"authority", &[ctx.bumps.authority]]];

    let thaw_cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ThawAccount {
            account : ctx.accounts.signer_target_token_account.to_account_info(),
            mint : ctx.accounts.target_token.to_account_info(),
            authority : ctx.accounts.authority.to_account_info()
        },
        authority_signer
    );
    thaw_account(thaw_cpi_context)?;

    let transfer_cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.target_token.to_account_info(),
            from: ctx.accounts.signer_target_token_account.to_account_info(),
            to: ctx.accounts.escrow_target_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        },
    );

    transfer_checked(transfer_cpi_ctx, amount, ctx.accounts.target_token.decimals)?;

    let froze_cpi_context_free = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        FreezeAccount {
            account : ctx.accounts.signer_target_token_account.to_account_info(),
            mint : ctx.accounts.target_token.to_account_info(),
            authority : ctx.accounts.authority.to_account_info()
        },
        authority_signer
    );
    freeze_account(froze_cpi_context_free)?;

    // if ctx.accounts.receiver_target_token_account.is_frozen() {
    //     let thaw_cpi_context = CpiContext::new_with_signer(
    //         ctx.accounts.token_program.to_account_info(),
    //         ThawAccount {
    //             account : ctx.accounts.receiver_target_token_account.to_account_info(),
    //             mint : ctx.accounts.target_token.to_account_info(),
    //             authority : ctx.accounts.authority.to_account_info()
    //         },
    //         authority_signer
    //     );
    //     thaw_account(thaw_cpi_context)?;    
    // }

    // let in_cpi_ctx = CpiContext::new(
    //     ctx.accounts.token_program.to_account_info(),
    //     TransferChecked {
    //         mint: ctx.accounts.target_token.to_account_info(),
    //         from: ctx.accounts.signer_target_token_account.to_account_info(),
    //         to: ctx.accounts.receiver_target_token_account.to_account_info(),
    //         authority: ctx.accounts.signer.to_account_info(),
    //     },
    // );

    // transfer_checked(in_cpi_ctx, amount, ctx.accounts.target_token.decimals)?;

    
    // let froze_cpi_context_receiver = CpiContext::new_with_signer(
    //     ctx.accounts.token_program.to_account_info(),
    //     FreezeAccount {
    //         account : ctx.accounts.receiver_target_token_account.to_account_info(),
    //         mint : ctx.accounts.target_token.to_account_info(),
    //         authority : ctx.accounts.authority.to_account_info()
    //     },
    //     authority_signer
    // );
    // freeze_account(froze_cpi_context_receiver)?;

    Ok(())
}
