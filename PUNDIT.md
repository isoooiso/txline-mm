# AI Match Pundit ⚽📱

**A World Cup commentator in your pocket — a Telegram bot that follows a match for you and pings you, in plain fan language with voice, the moment anything matters.**

Submission for the TxODDS × Superteam Earn World Cup hackathon — *consumer / fan* track.
Shares a codebase with the market-maker submission; pundit code lives in [`src/pundit/`](./src/pundit/).

---

## What it does

You can't watch all 104 World Cup matches. This bot watches one for you. Driven by TxLINE's live
scores and odds feed, it sends a short, human alert — text **and** a spoken voice note — the instant
something a fan cares about happens:

- ⚽ **Goal** — score, scorer, and how the match has shifted ("Argentina now 83% to win, was 52%")
- 🟥 **Red card** — who's down a man and which side it favours
- 📈 **Big swing** — a sharp market move with no goal yet ("something's shifting")
- 🏟️ kickoff intro and 🏁 full-time wrap

No jargon, no decimals, no stats dumps. Win chances are spoken as plain percentages inside a sentence.
When the underdog scores, it reads as a comeback — not "1% to win".

## Why it's different

It doesn't repackage a raw feed. It interprets it like a commentator: the de-margined consensus
probability (TxLINE's `Pct`) becomes "big favourites" or "an uphill climb"; a goal by a dominant side
becomes "turning the screw"; a late goal by the trailing team becomes "pulling one back". The
phrasing adapts to the magnitude of what just happened, so it sounds like a person, not a terminal.

## How it works
TxLINE feed ──> FeedSource ──> PunditEventDetector ──> fan-language composer ──> Telegram (text + voice)

- **FeedSource** (shared engine): one interface, `LiveFeed` (TxLINE SSE) and `FileReplayFeed`
  (captured match) interchangeable — so the experience runs live or replays a finished match.
- **PunditEventDetector** (`src/pundit/events.ts`): detects goals/reds from `Stats` keys (1/2 = goals,
  5/6 = reds), big 1X2 swings from |Δ fair|, with goal-window suppression and cooldowns so it never
  spams. Win-probability before/after a goal is measured on **feed timestamps** (works at any replay speed).
- **Composer** (`src/pundit/compose.ts`): deterministic fan-language templates with phrasing chosen by
  magnitude and rotating variants so it never repeats a line. Optional Anthropic Haiku path for extra
  variety when `ANTHROPIC_API_KEY` is set.
- **Voice** (`src/pundit/tts.ts`): edge-tts, disk-cached so delivery is instant and offline-safe.
- **Telegram** (`src/pundit/telegram.ts`): send-only via the Bot API.

## TxLINE endpoints used

`/auth/guest/start` · on-chain `subscribe` (service level 12, free) · `/api/token/activate` ·
`/api/fixtures/snapshot` · `/api/odds/stream` (live odds) · `/api/scores/stream` (live scores) ·
`/api/odds/snapshot/{id}` and `/api/scores/historical/{id}` (match capture for replay).

Fair win probability = de-margined `Pct`. Goals/reds from full-game `Stats` keys.

## Run it

```bash
npm install

# 1. Telegram setup: create a bot via @BotFather, message it once, then
#    open https://api.telegram.org/bot<TOKEN>/getUpdates to find your chat id.
cp .env.example .env
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_CHAT_ID=...
#   VOICE_ENABLED=true            # optional voice notes (requires: pip install edge-tts)
#   EDGE_TTS_VOICE=en-US-GuyNeural
#   ANTHROPIC_API_KEY=...         # optional — falls back to deterministic templates

# 2. (optional) pre-generate voice cache for instant playback
npm run pundit-prewarm -- 17588325

# 3. replay a real captured match to your Telegram chat
npm run pundit -- 17588325 60     # 60x speed; lower number = faster

# TELEGRAM_CHAT_ID accepts a private chat id or a public channel username (e.g. @your_channel,
# with the bot added as a channel admin) — the latter is the public MVP.
```

The repo ships with `fixtures/17588325.json` (Jordan 1–3 Argentina), so the replay reproduces the
demo without capturing data yourself.

## Monetization path

A natural consumer product: free tier follows one match; premium unlocks multiple matches, a custom
team-focused feed, and personalized alert thresholds. The same engine powers a B2B white-label "fan
engagement" layer for sportsbooks and media apps.

## Note on scope

Deliberately small and complete: three alert types, kickoff, full-time, and voice — polished, not
sprawling. Fan accessibility over feature count.
