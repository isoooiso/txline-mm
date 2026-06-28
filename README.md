# txline-mm — Slice 1: Data Layer

In-play market maker on the [TxLINE](https://txline-docs.txodds.com) consensus feed (World Cup 2026). This slice covers authentication, REST clients, SSE live streams, historical replay, and fair-value derivation from demargined `Pct` — no quoting or on-chain Merkle verification yet.

## Prerequisites

- Node.js 18+
- A Solana wallet with devnet SOL (for the free on-chain subscribe tx)
- `.env` configured from `.env.example`

## Setup

```bash
cp .env.example .env
# Edit .env: TXLINE_NETWORK, TXLINE_RPC_URL, WALLET_SECRET_KEY

npm install
npm run bootstrap   # guest JWT → on-chain subscribe → activate → .token.json
```

## Run order

| Script | Command | Purpose |
|--------|---------|---------|
| Bootstrap | `npm run bootstrap` | Obtain JWT + API token |
| Fixtures | `npm run fixtures` | List World Cup fixtures |
| Replay | `npm run replay -- <fixtureId>` | Merged odds+scores replay with fair lines |
| Live | `npm run live` | ~30s live SSE smoke test |

### Replay example

```bash
npm run fixtures
npm run replay -- 12345678
```

### Live smoke options

```bash
LIVE_SECONDS=30 LIVE_MAX_EVENTS=5 npm run live
```

## Architecture

```
FeedSource (interface)
├── LiveFeed   — dual SSE (/odds/stream, /scores/stream)
└── ReplayFeed — interval odds + historical/interval scores, timed playback
```

Fair value is derived from `Pct` (demargined implied probability), **not** from raw `Prices`.

## Environment

| Variable | Description |
|----------|-------------|
| `TXLINE_NETWORK` | `mainnet` or `devnet` |
| `TXLINE_RPC_URL` | Solana RPC endpoint |
| `WALLET_SECRET_KEY` | Base58 or JSON byte array |
| `WORLD_CUP_COMPETITION_ID` | Optional competition filter |

Tokens are persisted in `.token.json` after bootstrap.

## Network defaults

| Network | Base URL | Program ID |
|---------|----------|------------|
| mainnet | https://txline.txodds.com | `9ExbZj…` |
| devnet | https://txline-dev.txodds.com | `6pW64g…` |

See [TxLINE docs](https://txline-docs.txodds.com/documentation/quickstart.md) for subscription tiers and API details.
