# meme-launchpad

Anchor workspace with two Solana programs for launching meme tokens.

- `meme_launchpad` - creates a token and a sale for it. Users can buy tokens
  (also multi buy), sale has min and max cap, free tokens and refunds. After
  a successful sale the program creates a liquidity pool on Raydium (CP-Swap).
- `vesting` - vesting of bought tokens (simple, linear and discrete types),
  called from the launchpad program.

## Requirements

- anchor 0.30.1
- solana 1.18.17
- node with yarn

## Build

```
anchor build
```

## Test

```
yarn install
anchor test
```

Tests run on a local validator. The Raydium CP-Swap program and its accounts
are preloaded from dumps in `tests/dumps` (see `Anchor.toml`).
