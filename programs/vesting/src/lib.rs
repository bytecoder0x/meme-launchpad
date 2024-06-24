mod instructions;
mod state;

use {anchor_lang::prelude::*, instructions::*};

declare_id!("3HsdG1XceVgBUitEosBpP7EcwWs8yFfS3oN8Qzmv4a3P");

#[program]
pub mod vesting {

    use super::*;

    pub fn create_vesting(ctx: Context<InitializeVestingAccount>, data: VestingParams) -> Result<()> {
        instructions::initialize_vesting(ctx, data)
    }
}