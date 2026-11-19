# 🛋️ Couch Potato

Lean-back YouTube for the corner of your screen. You pick a **station**, and Claude picks what plays next instead of the YouTube algorithm.

## Setup

Copy `.env.example` to `.env` and paste in your Anthropic API key (and set `TZ` if you're not on US Eastern time).

**With Docker:**

```bash
docker compose up -d --build
```

Then open http://localhost:8787. `docker compose logs -f` shows what it's doing.

**Without Docker:**

1. Install [Node.js](https://nodejs.org/) LTS.
2. Run `npm install`.
3. Run `start.bat` (or `node server.mjs`), then open http://localhost:8787.

Open it in the browser where you're logged into YouTube Premium, so the embeds play without ads.

**Sharing with a friend (Docker):** set `BIND_IP` in `.env` to your Tailscale IP (`tailscale ip -4`) and `LOCK_SETTINGS=1` for watch-only, then `docker compose up -d`. They open `http://<your-machine>.<tailnet>.ts.net:8787` (your MagicDNS name). **Use the name, not the IP**: YouTube refuses many music-label embeds on pages opened by a bare IP. Their skips and likes land in your history.

## Stations

Each station is a file in [`stations/`](stations/):

```json
{
  "name": "Music Television",
  "order": 2,
  "vibe": "Wall-to-wall music videos ...",
  "minMinutes": 2,
  "maxMinutes": 10,
  "useSubscriptions": false,
  "picksPerCall": 5,
  "seedChannels": [{ "id": "UC...", "title": "Some Channel" }]
}
```

- **vibe**: plain-English description that Claude reads before every pick and when it builds the lineup.
- **minMinutes / maxMinutes**: hard length filter. This is how clips stay off a full-episode station.
- **useSubscriptions**: whether lineup building starts from your YouTube subscriptions.
- **seedChannels**: channels every new copy of the station starts with.

You can edit stations in the Settings panel, which writes to these files. **Commit station files to share them.** Everything personal stays in `data/`, which is gitignored: lineups, watch history, subscriptions, and cached video lengths.

## How it works

- **Lineup** (`data/<station>/lineup.json`): Claude keeps the subscriptions that fit the vibe (when `useSubscriptions` is on) and suggests more channels by @handle. Each handle is checked against YouTube, and any that don't resolve are dropped.
- **Pool**: up to 15 of the latest uploads per channel, from YouTube's public RSS feeds (the `UULF` playlist, which leaves out Shorts). No YouTube API key needed.
- **Length filter**: the feed doesn't include video length, so it's read from each video's page once and cached in `data/durations.json`.
- **Picks**: Claude sees about 90 candidates that fit the length range (max 3 per channel), your recent plays, skips and likes on that station, and the time of day.
- **History** (`data/<station>/history.json`): finished, skipped (with how long you watched and your reason), liked, passed (skipped without feedback, never shown to Claude), or unplayable. Nothing replays within 30 days, except passed videos, which can come back after a day.

The server console logs every step: feed fetches, length lookups, the filter funnel, each Claude call with tokens and timing, and every pick with its reason.

## Controls

The control strip sits under the video.

| Key | Button | What it does |
|---|---|---|
| **1-9** | station dropdown | Switch stations |
| **S** | Skip ⏭ | Skip with a reason ("Not in the mood", "Wrong for this station", or your own). Claude learns from it. |
| **N** | "Just skip" in the skip menu | Skip without teaching the station anything. The video can come back after a day. |
| **C** | CC | Captions on/off. Off by default, and remembered. |
| | 👍 | More like this |
| | 🚫 | Remove this channel from the current station |

## Known limits

- RSS feeds only list each channel's **15 most recent** uploads. Big back catalogs (classic music videos especially) would need a YouTube Data API key; that's a good next feature.
