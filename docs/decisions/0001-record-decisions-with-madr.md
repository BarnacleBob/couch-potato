---
status: accepted
date: 2026-11-19
decision-makers: barnaclebob
---

# Record architecture decisions with MADR

## Context and Problem Statement

Couch Potato started as a solo experiment, and a second person may start working on it. Early design choices were made in chat and only exist in the code. How do we keep the reasoning behind decisions visible to new contributors (and to coding agents)?

## Considered Options

* Markdown Architectural Decision Records (MADR) in `docs/decisions/`
* Notes in the README / CLAUDE.md only
* No written record

## Decision Outcome

Chosen option: "MADR in `docs/decisions/`", because it's plain Markdown in the repo, reviewed in the same pull requests as the code, and a well-known format.

### Consequences

* Good, because the "why" lives next to the code and survives chat history.
* Good, because CLAUDE.md can point agents at it.
* Bad, because it's a small extra step per significant decision.

## More Information

* Format: <https://adr.github.io/madr/>. Copy `adr-template.md` to start one.
* Files are named `NNNN-short-title.md`, numbered in order. Don't renumber or delete old ones; mark them `superseded by ADR-NNNN` instead.
* Write one for decisions that are hard to reverse or that a new contributor would otherwise question. Not for small tweaks.
