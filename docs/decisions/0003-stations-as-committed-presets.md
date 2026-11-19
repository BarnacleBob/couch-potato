---
status: accepted
date: 2026-11-19
decision-makers: barnaclebob
---

# Stations are committed JSON presets; personal data stays local

## Context and Problem Statement

Different viewers want different kinds of TV (daytime game shows, music videos, …), and two people share the repo. How do we support several "stations" and share them without sharing personal watch data?

## Considered Options

* One file per station in `stations/` (committed), with per-station data in `data/<station>/` (gitignored)
* All stations in one config file
* Stations stored only in local data

## Decision Outcome

Chosen option: "one file per station in `stations/`", because people can share and tweak stations through normal commits, and one file each keeps merge conflicts small. Each station's lineup and history stay personal under `data/<station>/`, along with `.env`, subscriptions and caches.

### Consequences

* Good, because new stations are just a new JSON file.
* Good, because each station learns separately (a skip on one doesn't affect another).
* Bad, because the Settings panel writes straight into the committed file, so two people tuning the same station will conflict. Prefer making your own station.
* Bad, because lineups aren't shared, so each person builds their own from the preset's seed channels.
