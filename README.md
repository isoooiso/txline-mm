# txline-mm

**On-chain-verifiable in-play market maker for the 2026 World Cup, built on TxLINE's de-margined consensus odds.**

Submission for the TxODDS × Superteam Earn World Cup hackathon — *Trading Tools & Agents* track.

---

## What it is

`txline-mm` is an autonomous in-play market-making agent. It treats TxLINE's **Stable Price** —
the vig-removed consensus probability — as fair value, quotes a two-sided market around it, and
manages inventory and tail risk as the match moves, pulling quotes around goals and sharp
repricings. Every price the agent acts on is backed by a TxLINE `MessageId` anchored on-chain in
a daily Merkle root, so its pricing is **cryptographically auditable**, not merely trusted.

It makes **no claim to predict matches or beat the consensus** — betting at a sharp de-margined
line is zero expected value by construction. Instead it does what a real trading desk does: it
earns the quoted spread from uninformed flow while controlling risk.

## The honest result

Risk controls were measured across **100 simulation seeds on a real mainnet match**
(Jordan 1–3 Argentina), with no parameter tuned to chase a favorable outcome:

| Metric | Protection OFF | Protection ON |
|---|---|---|
| Realized P&L (mean) | 5.90 | 5.33 |
| Spread captured (mean) | 6.23 | 5.39 |
| Max exposure **p95** | **16.39** | **14.21** |

**Protection does not add return** (Δ = −0.57, within noise, wins 20% of seeds) and costs a
little spread — but it **cuts worst-case (p95) exposure by ~13%**. That is the textbook role of
risk management: it bounds the tail, it doesn't manufacture alpha. Cross-match statistical
significance is explicitly left as future work.

## Architecture

A single **`FeedSource`** interface emits `{type:'odds'|'score', ts, data}`. Three
implementations are fully interchangeable:

- `LiveFeed` — TxLINE SSE (real-time ingestion)
- `ReplayFeed` — historical API
- `FileReplayFeed` — captured match JSON

The engine is **identical** across live and replay, which makes the whole result reproducible
after the tournament with no live API dependency.

| Component | Role |
|---|---|
| `FairBook` | Current/previous fair probabilities per market + repricing signal |
| `Quoter` | Pure: `bid = p−δ`, `ask = p+δ` around de-margined fair |
| `RiskEngine` | Position limits, net-exposure cap, inventory skew, reprice protection |
| `ExecSim` | Simulated Poisson taker flow with latency-driven adverse selection (seeded) |
| `Settlement` | 0–1 shares model; P&L split into spread captured vs inventory |

Fair value comes from the de-margined `Pct` field; raw `Prices` (decimal odds × 1000) are kept
for verification. On-chain auditability uses the `daily_batch_roots` (odds) and
`daily_scores_roots` (scores) Merkle-root PDAs.

## Quick start

```bash
# 1. install
npm install

# 2. configure (copy the template, fill in your values)
cp .env.example .env
#   TXLINE_NETWORK=mainnet
#   TXLINE_RPC_URL=...
#   WALLET_SECRET_KEY=...   (a funded wallet; ~0.01 SOL for the free-tier subscribe tx)

# 3. one-time: subscribe (free World Cup tier) + activate API token
npm run bootstrap

# 4. run the ablation on the captured match -> writes dashboard JSON
npm run run -- 17588325 --seeds 100 --quote-latency 1000

# 5. view the dashboard
cd dashboard && npm install && npm run dev
```

**Live ingestion check:** `npm run live` connects to the TxLINE SSE stream on mainnet.

> The repo ships with `fixtures/17588325.json` (the captured Jordan–Argentina match) and its
> dashboard data, so steps 4–5 reproduce the full result **without** API credentials.

## TxLINE endpoints used

`/auth/guest/start` · on-chain `subscribe` (service level 12, free) · `/api/token/activate` ·
`/api/fixtures/snapshot` · `/api/odds/snapshot/{id}` · `/api/odds/updates/{day}/{hour}/{interval}` ·
`/api/odds/stream` · `/api/scores/historical/{id}` · `/api/scores/stream`

See [`TECHNICAL.md`](./TECHNICAL.md) for full detail.

## Links

- **Demo video:** [link]
- **Live dashboard:** [link]
- **Technical docs:** [`TECHNICAL.md`](./TECHNICAL.md)

## A note on rigor

This submission is built to be defensible, not flattering. The protection logic does not improve
returns on this match, and that is reported as-is rather than tuned away. The value proposition is
verifiable pricing and measured risk control — not invented edge over a consensus that cannot be
beaten by construction.

## License

MIT
