use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, token::{Token, TokenAccount as SplTokenAccount}, token_interface::{burn, Burn, Mint, TokenAccount, TokenInterface}
};

use crate::{error::MemeLaunchpadError, state::{sale::Sale, token::TokenAuthority}};

use crate::state::raydium::{
    create_pool_fee_reveiver,
    raydium_cp_swap::{self, accounts::AmmConfig, program::RaydiumCpSwap, ID as RAYDIUM_ID},
};

#[derive(Accounts)]
pub struct IncreaseLiq<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// Which config the pool belongs to.
    pub amm_config: Box<Account<'info, AmmConfig>>,

    /// CHECK: pool vault and lp mint authority
    #[account(
        seeds = [
            "vault_and_lp_mint_auth_seed".as_bytes(),
        ],
        seeds::program = RAYDIUM_ID,
        bump,
    )]
    pub raydium_authority: UncheckedAccount<'info>,

    /// CHECK: Initialize an account to store the pool state, init by cp-swap
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,

    /// CHECK: pool lp mint, init by cp-swap
    #[account(
        mut,
        seeds = [
            "pool_lp_mint".as_bytes(),
            pool_state.key().as_ref(),
        ],
        seeds::program = RAYDIUM_ID,
        bump,
    )]
    pub lp_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = target_token,
        token::authority = sale.key(),
    )]
    pub sale_target_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// creator token1 account
    #[account(
        mut,
        token::mint = payment_token,
        token::authority = sale.key(),
    )]
    pub sale_payment_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = target_token,
        token::authority = signer.key(),
    )]
    pub user_target_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// creator token1 account
    #[account(
        mut,
        token::mint = payment_token,
        token::authority = signer.key(),
    )]
    pub user_payment_token_account: Box<InterfaceAccount<'info, TokenAccount>>,


    /// CHECK: creator lp ATA token account, init by cp-swap
    #[account(mut)]
    pub user_lp_token: UncheckedAccount<'info>,

    /// CHECK: creator lp ATA token account, init by cp-swap
    #[account(mut)]
    pub sale_lp_token: UncheckedAccount<'info>,

    /// CHECK: target token vault, init by cp-swap
    #[account(
        mut,
        seeds = [
            "pool_vault".as_bytes(),
            pool_state.key().as_ref(),
            target_token.key().as_ref()
        ],
        seeds::program = RAYDIUM_ID,
        bump,
    )]
    pub target_token_vault: UncheckedAccount<'info>,

    /// CHECK: payment token vault, init by cp-swap
    #[account(
        mut,
        seeds = [
            "pool_vault".as_bytes(),
            pool_state.key().as_ref(),
            payment_token.key().as_ref()
        ],
        seeds::program = RAYDIUM_ID,
        bump,
    )]
    pub payment_token_vault: UncheckedAccount<'info>,

    /// create pool fee account
    #[account(
        mut,
        address= create_pool_fee_reveiver::id(),
    )]
    pub create_pool_fee: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: an account to store oracle observations, init by cp-swap
    #[account(
        mut,
        seeds = [
            "observation".as_bytes(),
            pool_state.key().as_ref(),
        ],
        seeds::program = RAYDIUM_ID,
        bump,
    )]
    pub observation_state: UncheckedAccount<'info>,

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

    #[account(mut)]
    pub target_token: InterfaceAccount<'info, Mint>,

    pub payment_token: InterfaceAccount<'info, Mint>,

    /// Spl token program or token program 2022
    pub target_token_program: Interface<'info, TokenInterface>,

    /// Spl token program or token program 2022
    pub payment_token_program: Interface<'info, TokenInterface>,

    pub token_program: Program<'info, Token>,

    /// Radiym cp swap program
    pub cp_swap_program: Program<'info, RaydiumCpSwap>,

    /// Program to create an ATA for receiving position NFT
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// To create a new program account
    pub system_program: Program<'info, System>,

    /// Sysvar for program account
    pub rent: Sysvar<'info, Rent>,
}

pub fn increase_liq(ctx: Context<IncreaseLiq>) -> Result<()> {
    let target_key = ctx.accounts.target_token.key();
    let sale_seeds: &[&[&[u8]]] = &[&["sale".as_bytes(), target_key.as_ref(), &[ctx.bumps.sale]]];
    let sale = &ctx.accounts.sale;
    let is_target_token_less = ctx.accounts.target_token.key() < ctx.accounts.payment_token.key();
    let curtime = sale.get_time()?;
    let pool = get_pool(&ctx.accounts.pool_state.try_borrow_data()?)?;

    require!(pool.status == 0, MemeLaunchpadError::PoolNotInitialized);

    let (target_amount, payment_amount) = get_current_liquidity(
        &ctx.accounts.target_token_vault.try_borrow_data()?,
        &ctx.accounts.payment_token_vault.try_borrow_data()?,
    )?;
    let sale_price = &ctx.accounts.sale.get_sale_price(target_amount, curtime).unwrap();

    let tokens_amount_in = calculate_amount_in(
        target_amount as u128,
        payment_amount as u128,
        *sale_price as u128,
        ctx.accounts.target_token.decimals,
    ).unwrap();

    msg!("swap tokens to get the desired price");
    let cpi_swap_accounts = raydium_cp_swap::cpi::accounts::SwapBaseInput{
        payer: ctx.accounts.sale.to_account_info(),
        authority: ctx.accounts.raydium_authority.to_account_info(),
        amm_config: ctx.accounts.amm_config.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        input_token_account: ctx.accounts.sale_target_token_account.to_account_info(),
        output_token_account: ctx.accounts.sale_payment_token_account.to_account_info(),
        input_vault: ctx.accounts.target_token_vault.to_account_info(),
        output_vault: ctx.accounts.payment_token_vault.to_account_info(),
        input_token_program: ctx.accounts.target_token_program.to_account_info(),
        output_token_program: ctx.accounts.payment_token_program.to_account_info(),
        input_token_mint: ctx.accounts.target_token.to_account_info(),
        output_token_mint: ctx.accounts.payment_token.to_account_info(),
        observation_state: ctx.accounts.observation_state.to_account_info(),
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.cp_swap_program.to_account_info(),
        cpi_swap_accounts,
        sale_seeds,
    );

    let _ = raydium_cp_swap::cpi::swap_base_input(cpi_context, tokens_amount_in, 0);

    msg!("deposit of all liquidity from the sale into the pool");
    let cpi_deposit_accounts = raydium_cp_swap::cpi::accounts::Deposit {
        owner: ctx.accounts.sale.to_account_info(),
        authority: ctx.accounts.raydium_authority.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        owner_lp_token: ctx.accounts.sale_lp_token.to_account_info(),
        token_0_account: if is_target_token_less {
            ctx.accounts.sale_target_token_account.to_account_info()
        } else {
            ctx.accounts.sale_payment_token_account.to_account_info()
        },
        token_1_account: if !is_target_token_less {
            ctx.accounts.sale_target_token_account.to_account_info()
        } else {
            ctx.accounts.sale_payment_token_account.to_account_info()
        },
        token_0_vault: if is_target_token_less {
            ctx.accounts.target_token_vault.to_account_info()
        } else {
            ctx.accounts.payment_token_vault.to_account_info()
        },
        token_1_vault: if !is_target_token_less {
            ctx.accounts.target_token_vault.to_account_info()
        } else {
            ctx.accounts.payment_token_vault.to_account_info()
        },
        token_program: ctx.accounts.token_program.to_account_info(), 
        token_program_2022: ctx.accounts.target_token_program.to_account_info(),
        vault_0_mint: if is_target_token_less {
            ctx.accounts.target_token.to_account_info()
        } else {
            ctx.accounts.payment_token.to_account_info()
        },
        vault_1_mint: if !is_target_token_less {
            ctx.accounts.target_token.to_account_info()
        } else {
            ctx.accounts.payment_token.to_account_info()
        },
        lp_mint: ctx.accounts.lp_mint.to_account_info(),
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.cp_swap_program.to_account_info(),
        cpi_deposit_accounts,
        sale_seeds,
    );

    let lp_supply: u64;
    let vault_0: u64;
    let vault_1: u64;
    {
        let pool = get_pool(&ctx.accounts.pool_state.try_borrow_data()?)?;

        let (target_amount, payment_amount) = get_current_liquidity(
            &ctx.accounts.target_token_vault.try_borrow_data()?,
            &ctx.accounts.payment_token_vault.try_borrow_data()?,
        )?;
        lp_supply = pool.lp_supply;

        vault_0 = (if is_target_token_less {
            target_amount
        } else {
            payment_amount
        }).checked_sub(pool.protocol_fees_token_0 + pool.fund_fees_token_0).unwrap();

        vault_1 = (if !is_target_token_less {
            target_amount
        } else {
            payment_amount
        }).checked_sub(pool.protocol_fees_token_1 + pool.fund_fees_token_1).unwrap();
    }

    ctx.accounts.sale_payment_token_account.reload()?;
    ctx.accounts.sale_target_token_account.reload()?;

    let payment_limit = ctx.accounts.sale_payment_token_account.amount;
    let target_limit_update = ctx.accounts.sale_target_token_account.amount;

    let maximum_token_0_amount  = if is_target_token_less {
        target_limit_update
    } else {
        payment_limit
    };
    let maximum_token_1_amount = if !is_target_token_less {
        target_limit_update
    } else {
        payment_limit
    };

    let lp_amount = trading_tokens_to_lp_tokens(
        maximum_token_0_amount as u128,
        maximum_token_1_amount as u128,
        lp_supply as u128,
        vault_0 as u128,
        vault_1 as u128,     
    ).unwrap();

    let _ = raydium_cp_swap::cpi::deposit(
        cpi_context,
        lp_amount as u64,
        maximum_token_0_amount,
        maximum_token_1_amount
    );

    msg!("burn excess of the target token");
    let cpi_burn_target_token_accounts = Burn {
        mint: ctx.accounts.target_token.to_account_info(),
        from: ctx.accounts.sale_target_token_account.to_account_info(),
        authority: sale.to_account_info(),
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.target_token_program.to_account_info(),
        cpi_burn_target_token_accounts,
        sale_seeds,
    );

    ctx.accounts.sale_target_token_account.reload()?;
    let amount_to_burn = ctx.accounts.sale_target_token_account.amount;
    let _ = burn(cpi_context, amount_to_burn);

    msg!("burn excess of the lp token");
    let cpi_burn_lp_token_accounts = Burn {
        mint: ctx.accounts.lp_mint.to_account_info(),
        from: ctx.accounts.sale_lp_token.to_account_info(),
        authority: sale.to_account_info(),
    };

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_burn_lp_token_accounts,
        sale_seeds,
    );

    let amount_to_burn; 
    {
        let mut sale_lp_token_data: &[u8] = &ctx.accounts.sale_lp_token.try_borrow_data()?;
        amount_to_burn = SplTokenAccount::try_deserialize( &mut sale_lp_token_data)?.amount;
    }

    let _ = burn(cpi_context, amount_to_burn);

    Ok(())
}

pub fn trading_tokens_to_lp_tokens(
    token_0_amount: u128,
    token_1_amount: u128,
    lp_token_supply: u128,
    total_amount_in_pool_token_0: u128,
    total_amount_in_pool_token_1: u128,
) -> Option<u128> {
    let lp_token_amount_0 = token_0_amount
        .checked_mul(lp_token_supply)?
        .checked_div(total_amount_in_pool_token_0)?;
    let lp_token_amount_1 = token_1_amount
        .checked_mul(lp_token_supply)?
        .checked_div(total_amount_in_pool_token_1)?;
    
    Some(lp_token_amount_0.min(lp_token_amount_1))
}

pub fn get_pool(mut pool_data: &[u8]) -> Result<raydium_cp_swap::accounts::PoolState> {
    let pool = raydium_cp_swap::accounts::PoolState::try_deserialize(&mut pool_data)?;

    Ok(pool)
}

pub fn get_current_liquidity(target_data: &[u8], payment_data: &[u8]) -> Result<(u64, u64)> {
    let mut target_data = target_data;
    let mut payment_data = payment_data;

    let target_amount  = SplTokenAccount::try_deserialize(&mut target_data)?.amount;
    let payment_amount = SplTokenAccount::try_deserialize(&mut payment_data)?.amount;

    Ok((target_amount, payment_amount))
}

pub fn calculate_amount_in(
    token_liq_now: u128,
    usdc_liq_now: u128,
    target_price: u128,
    target_token_decimals: u8,
) -> Option<u64> {
    let sqrt_precision: u128 = 1_000_00;
    let target_token_precision = 10u128.checked_pow(target_token_decimals.into())?;

    let current_price = usdc_liq_now.checked_mul(target_token_precision)?
        .checked_div(token_liq_now)?;

    let intermediate_value = current_price.checked_mul(sqrt_precision.checked_pow(2)?)?
        .checked_div(target_price)?;

    let mul_to = sqrt(intermediate_value)?;

    let mut amount_in = token_liq_now.checked_mul(mul_to)?
        .checked_div(sqrt_precision)?
        .checked_sub(token_liq_now)?;

    amount_in = amount_in.checked_mul(99)?
        .checked_div(100)?;

    Some(amount_in as u64)
}

pub fn sqrt(value: u128) -> Option<u128> {
    if value == 0 {
        return Some(0);
    }
    if value <= 3 {
        return Some(1);
    }
    let mut z = value;
    let mut x = value / 2 + 1;
    while x < z {
        z = x;
        x = (value / x + x) / 2;
    }
    Some(z)
}