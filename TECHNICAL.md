# txline-mm — Technical Documentation

## Core idea
An autonomous in-play market-making agent on TxLINE's de-margined consensus odds for the
2026 World Cup. It quotes a two-sided market around fair value and manages risk; it does not
attempt to predict outcomes or beat the consensus, which is zero-EV by construction against a
sharp de-margined line. Edge claim: none. Value: spread capture from uninformed flow plus
measured risk control, with cryptographically auditable pricing.

## TxLINE endpoints used
Auth & subscription:
- `POST /auth/guest/start` — anonymous guest JWT (30-day)
- on-chain `subscribe` instruction (program `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`,
  service level 12, free World Cup tier, 0 TxL tokens) → txSig
- `POST /api/token/activate` — bind txSig + wallet signature → API token

Data:
- `GET /api/fixtures/snapshot` — fixture discovery
- `GET /api/odds/snapshot/{fixtureId}?asOf=<ms>` — point-in-time odds snapshot
- `GET /api/odds/updates/{epochDay}/{hour}/{interval}` — historical 5-min odds blocks (replay)
- `GET /api/odds/stream` — live SSE odds (real-time ingestion)
- `GET /api/scores/historical/{fixtureId}` — full score sequence (settlement / results)
- `GET /api/scores/stream` — live SSE scores

On-chain verification:
- Daily Merkle-root PDAs `daily_batch_roots` (odds) and `daily_scores_roots` (scores) —
  the auditability layer; every MessageId resolves to a daily root.

Fair value is derived from the Stable Price **de-margined `Pct`** field; raw `Prices`
(decimal odds × 1000) are retained for verification.

## Architecture
- **FeedSource** — single interface emitting `{type:'odds'|'score', ts, data}`. Three
  implementations are fully interchangeable: `LiveFeed` (SSE), `ReplayFeed` (historical API),
  `FileReplayFeed` (captured JSON). The engine is identical across live and replay, which is
  what makes the demo reproducible after the tournament.
- **FairBook** — maintains current/previous fair probabilities per market and a repricing
  (|Δfair|) signal; tracks match state from the scores feed.
- **Quoter** — pure function: bid = p−δ, ask = p+δ around fair (probability space). Because
  the consensus is already de-margined, the symmetric half-spread δ is the entire maker margin.
- **RiskEngine** — net position per outcome, position limits, net-exposure cap, linear
  inventory skew, and reprice protection: on a detected jump (or goal) it widens/pulls quotes
  for a cooldown to avoid adverse selection.
- **ExecSim** — simulated taker flow (Poisson arrivals; takers perceive current fair + noise).
  Adverse selection emerges because the maker quotes off latency-lagged fair while takers act
  on current fair. Venue-agnostic and explicitly a simulation; deterministic given a seed.
- **Settlement (0–1 shares model)** — each outcome is a share paying 1 if it occurs, 0
  otherwise; realized P&L = cash + Σ(position × result), decomposed into spread captured vs
  inventory P&L. Results derive from full-game Stats keys (1/2 = goals).

## Technical / business highlights
- **On-chain-verifiable pricing** — auditable, not trusted; novel use of the Merkle layer.
- **Honest measurement** — 100-seed ablation on a real mainnet match (Jordan 1–3 Argentina):
  protection ΔrealizedPnl = −0.57 (wins 20% of seeds, within noise), costs ~0.85 spread, but
  cuts p95 exposure ~13% (16.39 → 14.21). Risk control, not alpha. No parameters were tuned to
  chase a result; cross-match significance is future work.
- **Production-shaped** — deterministic logic, configurable spread/limits/latency, a risk
  dashboard, and one-command reproduction.

## Reproduce
```bash
npm install
npm run run -- 17588325 --seeds 100 --quote-latency 1000   # ablation + dashboard JSON
cd dashboard && npm install && npm run dev                 # view the dashboard
```
Live ingestion check: `npm run live` (connects to the TxLINE SSE stream on mainnet).
