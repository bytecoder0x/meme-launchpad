use anchor_lang::prelude::*;

use crate::state::{
    token::*,
    sale::*
};

use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token_interface::{TokenInterface, Mint},
};


#[derive(Accounts)]
pub struct CreateTokenAndSale<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    
    #[account(mut)]
    pub target_token: Signer<'info>,
  
    #[account(  
        init_if_needed,
        seeds = [b"authority".as_ref()],
        bump,
        space = 8,
        payer = signer,
    )]
    pub authority: Account<'info, TokenAuthority>,

    #[account(
        init,
        payer = signer,
        space = Sale::LEN,
        seeds = [b"sale", target_token.key().as_ref()],
        bump
    )]
    pub sale: Account<'info, Sale>,

    #[account(mut)]
    pub payment_token: InterfaceAccount<'info, Mint>,
    /// CHECK: 
    #[account(mut)]
    pub sale_target_token_account: AccountInfo<'info>,
    /// CHECK: 
    #[account(mut)]
    pub sale_payment_token_account: AccountInfo<'info>,

    /// CHECK:
    #[account(mut)] 
    pub free_token_account: AccountInfo<'info>,

    /// CHECK:
    #[account(mut)]
    pub free_account: AccountInfo<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,

}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateTokenAndSaleParams {
    pub free_amount: u64,
    pub create_token_params: CreateTokenParams,
    pub create_sale_params: CreateSaleParams,
}

pub fn create_token_and_sale(
    ctx: Context<CreateTokenAndSale>,
    params: CreateTokenAndSaleParams,
) -> Result<()> {

    let mint = ctx.accounts.target_token.to_account_info();
    let target_ata = ctx.accounts.sale_target_token_account.to_account_info();
    let amount_for_sale = params.create_sale_params.sale_amount.checked_add(params.create_sale_params.liq_amount).unwrap();
    
    let _  = _create_token(
        ctx.accounts.signer.to_account_info(), 
        mint.clone(),
        ctx.accounts.authority.to_account_info(), 
        ctx.bumps.authority, 
        ctx.accounts.system_program.to_account_info(), 
        ctx.accounts.token_program.to_account_info(), 
        ctx.accounts.rent.to_account_info(), 
        params.create_token_params
    );

    let _ =_create_sale(
        &mut ctx.accounts.sale,
        ctx.accounts.signer.to_account_info(), 
        ctx.accounts.target_token.to_account_info(),
        target_ata.clone(),
        ctx.accounts.sale_payment_token_account.to_account_info(),
        ctx.accounts.payment_token.to_account_info(), 
        ctx.bumps.sale,
        ctx.accounts.associated_token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        params.create_sale_params,
        ctx.accounts.free_account.key()
    );
    
    msg!("Creating payment associated token account");
    
    // Create the associated token account
    let _ = associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: ctx.accounts.signer.to_account_info(),
            associated_token: ctx.accounts.free_token_account.to_account_info(),
            authority: ctx.accounts.free_account.to_account_info(),
            mint: ctx.accounts.target_token.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ));
   

    // Mint tokens for sale 
    _mint_token(
        ctx.accounts.token_program.to_account_info(),
        mint.clone(),
        target_ata.clone(),
        ctx.accounts.authority.to_account_info(),
        ctx.bumps.authority,
        &amount_for_sale
    )?;

    // Mint tokens for free account
    _mint_token(
        ctx.accounts.token_program.to_account_info(),
        mint.clone(),
        ctx.accounts.free_token_account.clone(),
        ctx.accounts.authority.to_account_info(),
        ctx.bumps.authority,
        &params.free_amount
    )?;

    // Freeze mint
    _freeze_mint(
        ctx.accounts.token_program.to_account_info(),
        mint.clone(),
        ctx.accounts.authority.to_account_info(),
        ctx.bumps.authority
    )?;

    _freeze_account(
        ctx.accounts.free_token_account.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        mint.clone(),
        ctx.accounts.authority.to_account_info(),
        ctx.bumps.authority
    )?;

    Ok(())
}