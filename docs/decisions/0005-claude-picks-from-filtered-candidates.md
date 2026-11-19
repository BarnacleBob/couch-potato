---
status: accepted
date: 2026-11-19
decision-makers: barnaclebob
---

# Claude picks from a pre-filtered candidate list

## Context and Problem Statement

The point of the app is that an AI, not YouTube's algorithm, decides what plays next. How much should be left to the model, and how should it learn from the viewer?

## Decision Drivers

* Picks must be playable videos that actually exist in the lineup
* Cost and latency per pick
* The viewer controls what counts as feedback

## Considered Options

* Code filters candidates, then one Claude call picks a few in order
* Give Claude tools to search and browse YouTube itself
* No AI: random/weighted rotation

## Decision Outcome

Chosen option: "code filters, Claude picks". Code handles the hard rules (lineup, length range, no repeats for 30 days, max 3 per channel, ~90 candidates). Claude handles taste: mood, variety, time of day, and the viewer's recent finishes, skips (with reasons) and likes. The output is a JSON-schema structured list of video ids, and any id not in the candidates is dropped.

### Consequences

* Good, because each pick is a single cheap, fast call (~3 s, ~1-12k input tokens).
* Good, because Claude can't hallucinate a video.
* Good, because "just skip" (`passed`) gives the viewer a skip that is never shown to Claude.
* Bad, because Claude only sees a sample of the pool per pick, not everything.

## More Information

Effort is `low` for picks and `medium` for lineup building. The model is set by `CLAUDE_MODEL` in `.env`, and server-side refusal fallbacks are on.
