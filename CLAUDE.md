# Couch Potato

Lean-back YouTube "stations" for the corner of the screen. A small Node server pulls channel uploads from YouTube's public RSS feeds, and Claude picks what plays next. The player page embeds YouTube's IFrame player. See README.md for the user-facing overview.

## Running it

Needs an Anthropic API key in `.env` (copy `.env.example`). Never print, log or commit `.env`.

**Docker (preferred):**

```bash
docker compose up -d --build     # build + start on http://localhost:8787
docker compose logs -f           # the server log (see "Logs" below)
docker compose restart           # pick up .env changes
docker compose down              # stop
```

The compose file mounts `./data` (personal state) and `./stations` (presets) into the container. It reads `.env`, and `TZ` in `.env` sets the container's timezone.

**Without Docker:** `npm install`, then `node server.mjs` (or `start.bat` on Windows, which also opens the browser). It listens on `127.0.0.1:8787` unless `HOST`/`PORT` are set.

Only one of the two can run at a time, since both use port 8787. Check `docker ps` before starting a local server.

There's no build step and no hot reload: **restart the server after editing `server.mjs`**. Edits to `public/index.html` only need a page reload, except in Docker, where the page is baked into the image, so rebuild (`docker compose up -d --build`).

## Layout

- `server.mjs`: the whole backend. HTTP routes are in the `routes` object at the bottom.
- `public/index.html`: the whole frontend (inline CSS and JS, no framework, no build).
- `stations/*.json`: station presets (`name`, `order`, `vibe`, `minMinutes`, `maxMinutes`, `useSubscriptions`, `picksPerCall`, `seedChannels`). Committed and shared. The Settings panel writes to these files.
- `data/`: gitignored, personal. Contains `durations.json` (video length cache, shared across stations), `subscriptions.csv` (Google Takeout export), and `<station>/lineup.json` and `<station>/history.json`.

## How a pick works

`pickNext()` in `server.mjs` runs these steps:

1. Pool: each lineup channel's RSS feed, cached for 1 hour per station. It uses the `UULF` playlist feed (uploads without Shorts) and falls back to the channel feed.
2. Drop anything resting in history: 30 days after it played or was skipped, 1 day after a "passed" (no-feedback skip), and forever if unplayable.
3. Look up lengths (RSS has none) by scraping `"lengthSeconds"` from the watch page, cached in `durations.json`.
4. Filter to the station's length range, cap at 3 per channel, and keep at most 90 candidates.
5. One Claude call returns structured JSON picks with short reasons, and ids not in the candidate list get dropped.

Lineup building (`buildLineup()`) asks Claude to keep matching subscriptions and suggest channels by @handle. It then resolves each handle against YouTube and drops any that don't exist.

## Claude API usage

- Uses the `@anthropic-ai/sdk` package, through `client.beta.messages.create` with `output_config.format` (JSON schema) and `effort` (`low` for picks, `medium` for lineups).
- Server-side refusal fallbacks are on (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`).
- The model comes from `CLAUDE_MODEL` in `.env` (default `claude-opus-5-5`).
- Every call logs its tokens and timing. Check the log after changing prompts.

## Logs

The server log is the main debugging tool. Every step logs with a tag (`pool`, `len`, `pick`, `ai`, `lineup`, `event`, `config`, `error`) and the station id. Browser-side errors are posted to `/api/clientlog`, so they show up in the server log too. When adding a feature, log what it decides and why, in the same style.

## Testing

There are no automated tests. To verify a change:

1. Restart (or rebuild) the server and watch the log.
2. Hit the API directly. For example, POST `/api/next` with `{"station":"game-shows"}` gives a pick without the UI.
3. For UI changes, load http://localhost:8787 and use the page. Mute the player while testing.

Don't leave test events in a user's `data/<station>/history.json`. They affect future picks.

## Gotchas

- **Keyboard focus:** clicking the video moves focus into YouTube's iframe, which swallows key presses. A `window` blur handler hands focus back to the page. Keep it, or shortcuts break.
- **Captions:** the embed follows the viewer's YouTube account setting. `applyCaptions()` re-applies the CC choice on each `PLAYING` event and again a few seconds later.
- **YouTube throttling:** parallel watch-page fetches throttle above about 4 at once (see `fillDurations`). Failed lookups aren't cached and get retried later.
- **Embed errors:** player error 101/150 means the video can't be embedded. It's logged as `unplayable` and auto-skipped.
- **RSS limit:** feeds only list the 15 newest uploads per channel. A deep back catalog would need the YouTube Data API.
- **Windows:** in a shell opened before Node or Git was installed, `node`/`git` may not be on PATH. Use `C:\Program Files\nodejs\node.exe` and `C:\Program Files\Git\cmd\git.exe`.

## Decisions (ADRs)

Architecture decisions are recorded as [MADR](https://adr.github.io/madr/) files in `docs/decisions/`. Read them before changing how something fundamental works, such as where videos come from, how stations are stored, or how picks are made.

- When you make a decision that's hard to reverse or that a new contributor would question, add `NNNN-short-title.md` (next number) from `adr-template.md`, in the same commit as the change.
- Don't edit an accepted ADR's decision. Write a new one and mark the old one `superseded by ADR-NNNN`.

## Conventions

- Keep it dependency-light: Node built-ins plus the Anthropic SDK. No frontend framework or build step.
- Commit each feature on its own.
