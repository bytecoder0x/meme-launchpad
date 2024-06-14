
use anchor_lang::prelude::*;

declare_id!("6xX32V5PW4Q46qPbpHCYzFyUPXaRvPKnBsse2NimayRs");

#[program]
pub mod my_anchor_app {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
