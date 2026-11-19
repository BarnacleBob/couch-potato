---
status: accepted
date: 2026-11-19
decision-makers: barnaclebob
---

# Get videos from YouTube RSS feeds instead of the Data API

## Context and Problem Statement

The app needs a list of candidate videos from each channel in a station's lineup. Where should that list come from?

## Decision Drivers

* Zero setup beyond an Anthropic key
* No quotas to manage
* Must leave out Shorts

## Considered Options

* Public RSS feeds (`feeds/videos.xml`)
* YouTube Data API v3
* Scraping channel pages / yt-dlp

## Decision Outcome

Chosen option: "Public RSS feeds", because they need no key or quota, and the `UULF<channel>` playlist feed lists uploads without Shorts.

### Consequences

* Good, because setup is just an Anthropic key.
* Bad, because each feed only lists the **15 newest** uploads, so older episodes and classic music videos are unreachable.
* Bad, because feeds don't include video length, so lengths are looked up separately (see ADR-0004).

## Pros and Cons of the Options

### YouTube Data API v3

* Good, because it reaches full back catalogs and includes durations.
* Bad, because every user needs a Google Cloud API key, and there's a daily quota.

### Scraping / yt-dlp

* Good, because it reaches everything.
* Bad, because it's brittle and heavy.

## More Information

Revisit when the 15-video limit hurts, especially for music stations. The Data API could be an optional add-on when a key is present.
