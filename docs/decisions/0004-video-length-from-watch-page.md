---
status: accepted
date: 2026-11-19
decision-makers: barnaclebob
---

# Filter by video length, looked up from the watch page

## Context and Problem Statement

Full episodes and short clips often have near-identical titles (one channel had 9 clips in its last 15 uploads), so a game-show station played a 5-minute clip. RSS feeds don't include length. How do we keep clips off a full-episode station (and long videos off a music station)?

## Considered Options

* Read `lengthSeconds` from each video's watch page, cache it, and hard-filter by the station's length range
* Ask Claude to guess from titles
* Check length in the player after loading and auto-skip

## Decision Outcome

Chosen option: "read from the watch page and hard-filter", because titles can't tell clips apart and auto-skipping in the player looks broken. Lengths are cached forever in `data/durations.json`, and Claude also sees each candidate's length.

### Consequences

* Good, because clips never reach Claude.
* Bad, because it costs one page load (~1.4 MB) per new video, so a new station's first pick can take ~10-30 s.
* Bad, because more than ~4 parallel lookups get throttled by YouTube. Failed lookups retry later.
* Bad, because scraping can break if YouTube changes its page.
