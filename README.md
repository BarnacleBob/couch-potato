# 🛋️ Couch Potato

Lean-back YouTube for the corner of your screen. You pick a **station**, and Claude picks what plays next instead of the YouTube algorithm.

## Setup

1. Install [Node.js](https://nodejs.org/) LTS.
2. `npm install`
3. Copy `.env.example` to `.env` and paste in your Anthropic API key.
4. Run `start.bat` (or `node server.mjs`), then open http://localhost:8787.

Open it in the browser where you're logged into YouTube Premium, so the embeds play without ads.

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
- **History** (`data/<station>/history.json`): finished, skipped (with how long you watched), liked, or unplayable. Nothing replays within 30 days.

The server console logs every step: feed fetches, length lookups, the filter funnel, each Claude call with tokens and timing, and every pick with its reason.

## Controls

- Hover the video for the bar.
- **1-9** switch stations. **N** skips.
- 👍 means "more like this". 🚫 removes the channel from the current station.

## Known limits

- RSS feeds only list each channel's **15 most recent** uploads. Big back catalogs (classic music videos especially) would need a YouTube Data API key; that's a good next feature.
