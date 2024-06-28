use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self, DefaultAccountStateUpdate,  Mint,  TokenAccount,
        TokenInterface,
    },
};
use spl_token_2022::state::AccountState;

use crate::{
    error::MemeLaunchpadError,
    state::{sale::Sale, token::TokenAuthority},
};

use crate::state::raydium::{
    create_pool_fee_reveiver,
    raydium_cp_swap::{self, program::RaydiumCpSwap, accounts::AmmConfig, ID as RAYDIUM_ID},
};

#[derive(Accounts)]
pub struct CloseSale<'info> {
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

    /// CHECK: creator lp ATA token account, init by cp-swap
    #[account(mut)]
    pub creator_lp_token: UncheckedAccount<'info>,

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

    pub target_token: InterfaceAccount<'info, Mint>,

    pub payment_token: InterfaceAccount<'info, Mint>,

    /// Spl token program or token program 2022
    pub target_token_program: Interface<'info, TokenInterface>,

    /// Spl token program or token program 2022
    pub payment_token_program: Interface<'info, TokenInterface>,

    /// Radiym cp swap program
    pub cp_swap_program: Program<'info, RaydiumCpSwap>,

    /// Program to create an ATA for receiving position NFT
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// To create a new program account
    pub system_program: Program<'info, System>,

    /// Sysvar for program account
    pub rent: Sysvar<'info, Rent>,
}

pub fn close_sale(ctx: Context<CloseSale>) -> Result<()> {
    let sale_for_ctx = ctx.accounts.sale.to_account_info();
    let sale = &mut ctx.accounts.sale;
    let curtime = sale.get_time()?;

    // require!(sale.is_ended(curtime), MemeLaunchpadError::SaleEnded); // ??
    require!(
        sale.is_ready_to_close(curtime),
        MemeLaunchpadError::SaleNotReadyToClose
    );

    token_interface::default_account_state_update(
        CpiContext::new(
            ctx.accounts.target_token_program.to_account_info(),
            DefaultAccountStateUpdate {
                token_program_id: ctx.accounts.target_token_program.to_account_info(),
                mint: ctx.accounts.target_token.to_account_info(),
                freeze_authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        &AccountState::Initialized,
    )?;

    let is_target_token_less = ctx.accounts.target_token.key() < ctx.accounts.payment_token.key();

    let target_token_key = ctx.accounts.target_token.key();
    let payment_token_key = ctx.accounts.payment_token.key();
    let amm_config_key = ctx.accounts.amm_config.key();
    let seed = "pool".as_bytes();

    let pool_state_seeds = if is_target_token_less {
        [
            seed,
            amm_config_key.as_ref(),
            target_token_key.as_ref(),
            payment_token_key.as_ref(),
        ]
    } else {
        [
            seed,
            amm_config_key.as_ref(),
            payment_token_key.as_ref(),
            target_token_key.as_ref(),
        ]
    };

    let (expected_pool_state, pool_state_bump) =
        Pubkey::find_program_address(&pool_state_seeds, &raydium_cp_swap::ID_CONST);

    if expected_pool_state != ctx.accounts.pool_state.key() {
        return Err(MemeLaunchpadError::InvalidPoolState.into());
    }

    let cpi_accounts = raydium_cp_swap::cpi::accounts::Initialize {
        creator: sale_for_ctx,
        amm_config: ctx.accounts.amm_config.to_account_info(),
        authority: ctx.accounts.raydium_authority.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        token_0_mint: if is_target_token_less {
            ctx.accounts.target_token.to_account_info()
        } else {
            ctx.accounts.payment_token.to_account_info()
        },
        token_1_mint: if !is_target_token_less {
            ctx.accounts.target_token.to_account_info()
        } else {
            ctx.accounts.payment_token.to_account_info()
        },
        lp_mint: ctx.accounts.lp_mint.to_account_info(),
        creator_token_0: if is_target_token_less {
            ctx.accounts.sale_target_token_account.to_account_info()
        } else {
            ctx.accounts.sale_payment_token_account.to_account_info()
        },
        creator_token_1: if !is_target_token_less {
            ctx.accounts.sale_target_token_account.to_account_info()
        } else {
            ctx.accounts.sale_payment_token_account.to_account_info()
        },
        creator_lp_token: ctx.accounts.creator_lp_token.to_account_info(),
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
        create_pool_fee: ctx.accounts.create_pool_fee.to_account_info(),
        observation_state: ctx.accounts.observation_state.to_account_info(),
        token_program: ctx.accounts.target_token_program.to_account_info(),
        token_0_program: if is_target_token_less {
            ctx.accounts.target_token_program.to_account_info()
        } else {
            ctx.accounts.payment_token_program.to_account_info()
        },
        token_1_program: if !is_target_token_less {
            ctx.accounts.target_token_program.to_account_info()
        } else {
            ctx.accounts.payment_token_program.to_account_info()
        },
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };

    let init_amount_0 = if is_target_token_less {
        sale.liq_amount
    } else {
        ctx.accounts.sale_payment_token_account.amount
    };
    let init_amount_1 = if !is_target_token_less {
        sale.liq_amount
    } else {
        ctx.accounts.sale_payment_token_account.amount
    };

    let cpi_context = CpiContext::new(ctx.accounts.cp_swap_program.to_account_info(), cpi_accounts);
    raydium_cp_swap::cpi::initialize(
        cpi_context,
        init_amount_0,
        init_amount_1,
        sale.common.close_time as u64,
    );

    Ok(())
}
