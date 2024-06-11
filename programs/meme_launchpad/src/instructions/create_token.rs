use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token:: AssociatedToken, 
    token_interface::Token2022,
};

use crate::state::token::{CreateTokenParams, _create_token, TokenAuthority};

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: We will create this one for the user
    #[account(mut)]
    pub token_account: AccountInfo<'info>,
    #[account(mut)]
    pub mint: Signer<'info>,
    #[account(  
        init_if_needed,
        seeds = [b"authority".as_ref()],
        bump,
        space = 8,
        payer = signer,
    )]
    pub authority: Account<'info, TokenAuthority>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub rent: Sysvar<'info, Rent>
}



pub fn create_token(
    ctx: Context<CreateToken>,
    params: CreateTokenParams
) -> Result<()>{
    _create_token(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.bumps.authority,
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        params
    );
    Ok(())
}

// pub fn create_token(
//     ctx: Context<CreateToken>,
//     data: CreateTokenParams
// ) -> Result<()> {
//     // calculate the space need for the mint account with the desired extensions
//     let space = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MetadataPointer])
//         .unwrap();

//     let meta_data_space = 250;

//     let lamports_required = (Rent::get()?).minimum_balance(space + meta_data_space);

//     msg!(
//         "Create Mint and metadata account size and cost: {} lamports: {}",
//         space as u64,
//         lamports_required
//     );

//     system_program::create_account(
//         CpiContext::new(
//             ctx.accounts.token_program.to_account_info(),
//             system_program::CreateAccount {
//                 from: ctx.accounts.signer.to_account_info(),
//                 to: ctx.accounts.mint.to_account_info(),
//             },
//         ),
//         lamports_required,
//         space as u64,
//         &ctx.accounts.token_program.key(),
//     )?;

//     // Assign the mint to the token program
//     system_program::assign(
//         CpiContext::new(
//             ctx.accounts.token_program.to_account_info(),
//             system_program::Assign {
//                 account_to_assign: ctx.accounts.mint.to_account_info(),
//             },
//         ),
//         &token_2022::ID,
//     )?;

//     // Initialize the metadata pointer (Need to do this before initializing the mint)
//     let init_meta_data_pointer_ix =
//         spl_token_2022::extension::metadata_pointer::instruction::initialize(
//             &Token2022::id(),
//             &ctx.accounts.mint.key(),
//             Some(ctx.accounts.authority.key()),
//             Some(ctx.accounts.mint.key()),
//         )
//         .unwrap();

//     invoke(
//         &init_meta_data_pointer_ix,
//         &[
//             ctx.accounts.mint.to_account_info(),
//             ctx.accounts.authority.to_account_info(),
//         ],
//     )?;

//     // Initialize the mint cpi
//     let mint_cpi_ix = CpiContext::new(
//         ctx.accounts.token_program.to_account_info(),
//         token_2022::InitializeMint2 {
//             mint: ctx.accounts.mint.to_account_info(),
//         },
//     );

//     token_2022::initialize_mint2(mint_cpi_ix, data.decimals, &ctx.accounts.authority.key(), None).unwrap();

//     // We use a PDA as a mint authority for the metadata account because
//     // we want to be able to update the NFT from the program.
//     let seeds = b"authority";
//     let bump = ctx.bumps.authority;
//     let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

//     msg!(
//         "Init metadata {0}",
//         ctx.accounts.authority.to_account_info().key
//     );

//     // Init the metadata account
//     let init_token_meta_data_ix = &spl_token_metadata_interface::instruction::initialize(
//         &spl_token_2022::id(),
//         &ctx.accounts.mint.key(),
//         ctx.accounts.authority.to_account_info().key,
//         &ctx.accounts.mint.key(),
//         ctx.accounts.authority.to_account_info().key,
//         data.name,
//         data.symbol,
//         data.uri
//     );

//     invoke_signed(
//         init_token_meta_data_ix,
//         &[
//             ctx.accounts.mint.to_account_info().clone(),
//             ctx.accounts.authority.to_account_info().clone(),
//         ],
//         signer,
//     )?;
    
   

//         Ok(())
//     }


// pub fn mint_token_and_froze(
//      ctx: Context<CreateToken>,
//      amount: u64
//      ) -> Result<()>{
//     let seeds = b"authority";
//     let bump = ctx.bumps.authority;
//     let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];


//  // Create the associated token account
//  associated_token::create(CpiContext::new(
//     ctx.accounts.associated_token_program.to_account_info(),
//     associated_token::Create {
//         payer: ctx.accounts.signer.to_account_info(),
//         associated_token: ctx.accounts.token_account.to_account_info(),
//         authority: ctx.accounts.signer.to_account_info(),
//         mint: ctx.accounts.mint.to_account_info(),
//         system_program: ctx.accounts.system_program.to_account_info(),
//         token_program: ctx.accounts.token_program.to_account_info(),
//     },
// ))?;

// // Mint one token to the associated token account of the player
// token_2022::mint_to(
//     CpiContext::new_with_signer(
//         ctx.accounts.token_program.to_account_info(),
//         token_2022::MintTo {
//             mint: ctx.accounts.mint.to_account_info(),
//             to: ctx.accounts.token_account.to_account_info(),
//             authority: ctx.accounts.authority.to_account_info(),
//         },
//         signer,
//     ),
//     amount,
// )?;

// // Freeze the mint authority so no more tokens can be minted to make it an NFT
//     token_2022::set_authority(
//         CpiContext::new_with_signer(
//             ctx.accounts.token_program.to_account_info(),
//             token_2022::SetAuthority {
//                 current_authority: ctx.accounts.authority.to_account_info(),
//                 account_or_mint: ctx.accounts.mint.to_account_info(),
//             },
//             signer,
//         ),
//         AuthorityType::MintTokens,
//         None,
//     )?;

//     Ok(())
// }