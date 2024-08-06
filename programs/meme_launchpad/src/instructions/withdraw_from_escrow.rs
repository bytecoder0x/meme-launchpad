use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{
    approve, freeze_account, thaw_account, transfer_checked, Approve, FreezeAccount, Mint, ThawAccount, TokenAccount, TokenInterface, TransferChecked
}};

use vesting::{
    cpi::{accounts::InitializeVestingAccount, create_vesting}, 
    instructions::VestingParams, 
    program::Vesting 
};

use crate::{error::MemeLaunchpadError, state::{sale::Sale, token::{Escrow, TokenAuthority}}};

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
    #[account(mut)]
    pub vesting: AccountInfo<'info>,

    /// CHECK:
    #[account(mut)]
    pub vesting_target_token_account: AccountInfo<'info>,

    /// CHECK:
    #[account(
        mut,
        seeds = [receiver.key().as_ref(), sale.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

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
    pub vesting_program: Program<'info, Vesting>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
    rent: Sysvar<'info, Rent>,
}

pub fn withdraw_from_escrow(ctx: Context<WithdrawFromEscrow>) -> Result<()> {
    let sale = &ctx.accounts.sale;

    require!(
        sale.sale_success,
        MemeLaunchpadError::SaleIsNotSuccess
    );

    let receiver_key = ctx.accounts.receiver.key();
    let sale_key = sale.key();

    let escrow_signer: &[&[&[u8]]] = &[&[receiver_key.as_ref(), sale_key.as_ref(), &[ctx.bumps.escrow]]];
    let authority_signer: &[&[&[u8]]] = &[&[b"authority", &[ctx.bumps.authority]]];

    let amount_to_transfer = ctx.accounts.escrow_target_token_account.amount;
    let vesting_percentage = ctx.accounts.sale.vesting.percentage as u64;

    let vesting_amount = amount_to_transfer
        .checked_mul(vesting_percentage)
        .and_then(|x| x.checked_div(100_00))
        .ok_or(MemeLaunchpadError::MathOverflow)?;

    let receiver_amount = amount_to_transfer
        .checked_sub(vesting_amount)
        .ok_or(MemeLaunchpadError::MathOverflow)?;

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

    msg!("transfer target to user");
    let transfer_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            mint: ctx.accounts.target_token.to_account_info(),
            from: ctx.accounts.escrow_target_token_account.to_account_info(),
            to: ctx.accounts.receiver_target_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        escrow_signer
    );

    transfer_checked(transfer_cpi_ctx, receiver_amount, ctx.accounts.target_token.decimals)?;

    let approve_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Approve {
            to: ctx.accounts.escrow_target_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
            delegate: ctx.accounts.vesting.to_account_info(),
        },
        escrow_signer
    );

    approve(approve_cpi_ctx, vesting_amount)?;

    let vesting_params = VestingParams {
        start_date: sale.get_start_time() as u32,
        duration: sale.vesting.duration,
        amount: vesting_amount,
        vesting_type: sale.vesting.vesting_model.clone(),
    };

    msg!("transfer target to vesting");
    let vesting_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.vesting_program.to_account_info(),
               InitializeVestingAccount {
            vesting: ctx.accounts.vesting.to_account_info(),
            sale_token_account: ctx.accounts.escrow_target_token_account.to_account_info(),
            vesting_token_account: ctx.accounts.vesting_target_token_account.to_account_info(),
            user: ctx.accounts.receiver.to_account_info(),
            target_token: ctx.accounts.target_token.to_account_info(),
            signer: ctx.accounts.receiver.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        },
        escrow_signer
    );

    create_vesting(vesting_cpi_ctx, vesting_params)?;

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
