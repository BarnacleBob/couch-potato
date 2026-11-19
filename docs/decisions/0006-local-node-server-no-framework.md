---
status: accepted
date: 2026-11-19
decision-makers: barnaclebob
---

# Single-file Node server and plain HTML page, Docker optional

## Context and Problem Statement

YouTube's feeds and pages can't be fetched from a browser (CORS), and the API key must not live in the page, so we need a small backend. What shape should the app take?

## Considered Options

* One `server.mjs` (Node built-ins + Anthropic SDK) and one `public/index.html` (no framework, no build)
* A full framework (Next.js, Express + React, …)
* Python backend

## Decision Outcome

Chosen option: "one Node file and one HTML file", because the app is small, it runs with `node server.mjs`, and anyone (or any agent) can read the whole thing quickly. Docker (`docker compose up`) is offered as the easy way to run it, with `data/` and `stations/` mounted from the checkout.

### Consequences

* Good, because there's only one dependency, no build step and no bundler.
* Good, because the server binds to `127.0.0.1` by default, and Docker opts in to `0.0.0.0` via `HOST`.
* Bad, because both files will get long as features grow. Split them when that hurts, and record it here.
* Bad, because there's no hot reload: restart the server after backend edits.
