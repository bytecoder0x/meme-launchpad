use anchor_lang::{
    prelude::*,
    solana_program::program::{invoke, invoke_signed},
    system_program,
};
use anchor_spl::{
    token_2022,
    token_interface::{
        freeze_account, FreezeAccount,
        default_account_state, spl_token_2022::instruction::AuthorityType, thaw_account,
        ThawAccount, Token2022,
    },
};
use spl_token_2022::{
    extension::ExtensionType,
    state::{AccountState, Mint},
};

#[account]
pub struct TokenAuthority {}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateTokenParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
}

#[allow(clippy::too_many_arguments)]
pub fn _create_token<'a>(
    signer: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    authotity_bump: u8,
    system_program: AccountInfo<'a>,
    token_program: AccountInfo<'a>,
    rent: AccountInfo<'a>,
    params: CreateTokenParams,
) -> Result<()> {
    // calculate the space need for the mint account with the desired extensions
    let space = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MetadataPointer])
        .unwrap();

    let meta_data_space = 250;

    let lamports_required = (Rent::get()?).minimum_balance(space + meta_data_space);

    msg!(
        "Create Mint and metadata account size and cost: {} lamports: {}",
        space as u64,
        lamports_required
    );

    system_program::create_account(
        CpiContext::new(
            token_program.to_account_info(),
            system_program::CreateAccount {
                from: signer.to_account_info(),
                to: mint.to_account_info(),
            },
        ),
        lamports_required,
        space as u64,
        &token_program.key(),
    )?;

    // Assign the mint to the token program
    system_program::assign(
        CpiContext::new(
            token_program.to_account_info(),
            system_program::Assign {
                account_to_assign: mint.to_account_info(),
            },
        ),
        &token_2022::ID,
    )?;

    // Initialize the metadata pointer (Need to do this before initializing the mint)
    let init_meta_data_pointer_ix =
        spl_token_2022::extension::metadata_pointer::instruction::initialize(
            &Token2022::id(),
            &mint.key(),
            Some(authority.key()),
            Some(mint.key()),
        )
        .unwrap();

    invoke(
        &init_meta_data_pointer_ix,
        &[mint.to_account_info(), authority.to_account_info()],
    )?;

    // let default_account_state_ix =
    // spl_token_2022::extension::default_account_state::instruction::initialize_default_account_state(
    //     &Token2022::id(),
    //      &mint.key(),
    //     &AccountState::Frozen
    // ).unwrap();

    // invoke(
    //     &default_account_state_ix,
    //     &[mint.to_account_info()],
    // )?;

    // Initialize the mint cpi
    let mint_cpi_ix = CpiContext::new(
        token_program.to_account_info(),
        token_2022::InitializeMint2 {
            mint: mint.to_account_info(),
        },
    );

    token_2022::initialize_mint2(
        mint_cpi_ix,
        params.decimals,
        &authority.key(),
        Some(&authority.key()),
    )
    .unwrap();

    // We use a PDA as a mint authority for the metadata account because
    // we want to be able to update the NFT from the program.
    let seeds = b"authority";
    let signer: &[&[&[u8]]] = &[&[seeds, &[authotity_bump]]];

    msg!("Init metadata {0}", authority.to_account_info().key);

    // Init the metadata account
    let init_token_meta_data_ix = &spl_token_metadata_interface::instruction::initialize(
        &spl_token_2022::id(),
        &mint.key(),
        authority.to_account_info().key,
        &mint.key(),
        authority.to_account_info().key,
        params.name,
        params.symbol,
        params.uri,
    );

    invoke_signed(
        init_token_meta_data_ix,
        &[
            mint.to_account_info().clone(),
            authority.to_account_info().clone(),
        ],
        signer,
    )?;

    Ok(())
}

pub fn _mint_token<'a>(
    token_program: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    token_account: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    authotity_bump: u8,
    amount: &u64,
) -> Result<()> {
    let signer: &[&[&[u8]]] = &[&[b"authority", &[authotity_bump]]];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token_2022::MintTo {
                mint: mint.to_account_info(),
                to: token_account.to_account_info(),
                authority: authority.to_account_info(),
            },
            signer,
        ),
        *amount,
    )?;

    Ok(())
}

pub fn _freeze_mint<'a>(
    token_program: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    authotity_bump: u8,
) -> Result<()> {
    let signer: &[&[&[u8]]] = &[&[b"authority", &[authotity_bump]]];
    // Freeze the mint authority so no more tokens can be minted to make it an NFT
    token_2022::set_authority(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token_2022::SetAuthority {
                current_authority: authority.to_account_info(),
                account_or_mint: mint.to_account_info(),
            },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    Ok(())
}

pub fn _freeze_account<'a>(
    account: AccountInfo<'a>,
    token_program: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    authotity_bump: u8,
) -> Result<()> {
    let authority_signer: &[&[&[u8]]] = &[&[b"authority", &[authotity_bump]]];
    
    let cpi = CpiContext::new_with_signer(
        token_program.to_account_info(),
        FreezeAccount {
            account : account.to_account_info(),
            mint : mint.to_account_info(),
            authority : authority.to_account_info()
        },
        authority_signer
    );
    freeze_account(cpi)?;

    Ok(())
}