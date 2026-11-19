// Couch Potato — local server.
// Each "station" (stations/*.json) is a preset: a vibe, a video length range and seed channels.
// The server pulls channel uploads from YouTube's public RSS feeds and asks Claude to pick what plays next.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, ".env")); } catch {}

const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const DATA = path.join(here, "data");          // personal: history, lineups, subscriptions, caches (gitignored)
const STATIONS = path.join(here, "stations");  // shared: station presets (committed)
const PUBLIC = path.join(here, "public");
await fs.mkdir(DATA, { recursive: true });
await fs.mkdir(STATIONS, { recursive: true });

// ---------- logging ----------
const ansi = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const c = { dim: ansi(2), bold: ansi(1), red: ansi(31), green: ansi(32), yellow: ansi(33), blue: ansi(34), magenta: ansi(35), cyan: ansi(36) };
const tagColor = { http: c.dim, pool: c.blue, len: c.blue, pick: c.green, ai: c.magenta, lineup: c.cyan, event: c.yellow, config: c.cyan, error: c.red };
function log(tag, ...msg) {
  const t = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${c.dim(t)} ${(tagColor[tag] || ((s) => s))(tag.padEnd(6))} ${msg.join(" ")}`);
}
const stationLog = (id) => (tag, ...msg) => log(tag, c.dim(`[${id}]`), ...msg);
const indent = (lines) => lines.map((l) => `${" ".repeat(16)}${l}`).join("\n");
const fmtLen = (s) => (!s ? "?" : s < 600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${Math.round(s / 60)}m`);
const ms = (t0) => `${Date.now() - t0}ms`;

// ---------- JSON files ----------
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

// ---------- stations ----------
const STATION_DEFAULTS = { vibe: "", minMinutes: 10, maxMinutes: 180, useSubscriptions: true, picksPerCall: 3, seedChannels: [] };
const validId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "station";

async function listStations() {
  const files = (await fs.readdir(STATIONS)).filter((f) => f.endsWith(".json"));
  const all = await Promise.all(files.map(async (f) => {
    const id = f.slice(0, -5);
    return validId(id) ? { ...STATION_DEFAULTS, name: id, ...(await readJson(path.join(STATIONS, f), {})), id } : null;
  }));
  return all.filter(Boolean).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
}
async function getStation(id) {
  if (!validId(id)) throw new Error(`Bad station id "${id}".`);
  const s = await readJson(path.join(STATIONS, `${id}.json`), null);
  if (!s) throw new Error(`No station "${id}". Check the stations/ folder.`);
  return { ...STATION_DEFAULTS, name: id, ...s, id };
}
async function saveStation(station) {
  const { id, ...rest } = station;
  await writeJson(path.join(STATIONS, `${id}.json`), rest);
}

// Per-station personal data lives in data/<station>/.
const stationFile = (id, name) => path.join(DATA, id, name);
async function getLineup(station) {
  const file = stationFile(station.id, "lineup.json");
  let lineup = await readJson(file, null);
  if (!lineup) {
    lineup = station.seedChannels.map((ch) => ({ ...ch, source: "preset" }));
    await writeJson(file, lineup);
    if (lineup.length) stationLog(station.id)("lineup", `new lineup seeded with ${lineup.length} preset channels`);
  }
  return lineup;
}
const saveLineup = (id, lineup) => writeJson(stationFile(id, "lineup.json"), lineup);
const getHistory = (id) => readJson(stationFile(id, "history.json"), []);

// ---------- Claude ----------
let client;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("No ANTHROPIC_API_KEY. Paste your key into couch-potato/.env and restart the server.");
  }
  client ??= new Anthropic();
  return client;
}

async function askJson({ L, label, system, user, schema, effort, maxTokens = 8000 }) {
  L("ai", `${label}: asking ${MODEL} (effort ${effort}, prompt ~${Math.round((system.length + user.length) / 4)} tokens)…`);
  const t0 = Date.now();
  const res = await claude().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  const u = res.usage || {};
  L("ai", `${label}: done in ${ms(t0)} · ${u.input_tokens ?? "?"} in / ${u.output_tokens ?? "?"} out tokens · stop: ${res.stop_reason}` +
    (res.model && res.model !== MODEL ? c.yellow(` · served by fallback ${res.model}`) : ""));
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens).");
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no text.");
  return JSON.parse(text);
}

// ---------- YouTube (public, no API key) ----------
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
async function getText(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" } });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
const decode = (s = "") => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseFeed(xml) {
  return xml.split("<entry>").slice(1).map((e) => ({
    videoId: e.match(/<yt:videoId>([^<]+)/)?.[1],
    title: decode(e.match(/<title>([^<]*)<\/title>/)?.[1]),
    channelTitle: decode(e.match(/<author>\s*<name>([^<]*)/)?.[1]),
    published: e.match(/<published>([^<]+)/)?.[1],
    views: Number(e.match(/<media:statistics views="(\d+)"/)?.[1] || 0),
    desc: decode(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] || "").replace(/\s+/g, " ").slice(0, 220),
  })).filter((v) => v.videoId);
}

// Regular uploads only: the "UULF" playlist excludes Shorts and lives.
async function fetchChannelVideos(ch, L) {
  let xml = await getText(`https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${ch.id.slice(2)}`);
  let vids = xml ? parseFeed(xml) : [];
  let via = "uploads feed";
  if (!vids.length) {
    xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
    vids = xml ? parseFeed(xml).filter((v) => !/#shorts?\b/i.test(v.title)) : [];
    via = "all-uploads feed (fallback)";
  }
  L("pool", `  ${ch.title}: ${vids.length ? `${vids.length} videos via ${via}` : c.red("no videos (feed unavailable)")}`);
  return vids.map((v) => ({ ...v, channelId: ch.id, channelTitle: v.channelTitle || ch.title }));
}

// Accepts @handle, a channel URL, or a UC… id. Returns {id,title} or null.
async function resolveChannel(input) {
  input = input.trim();
  const direct = input.match(/(UC[\w-]{22})/);
  let url;
  if (direct) url = `https://www.youtube.com/channel/${direct[1]}`;
  else if (/^https?:\/\//.test(input)) url = input;
  else url = `https://www.youtube.com/${input.startsWith("@") ? input : "@" + input.replace(/\s+/g, "")}`;
  const html = await getText(url);
  if (!html) return null;
  const id = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1]
    || html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] || direct?.[1];
  if (!id) return null;
  const title = decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || input);
  return { id, title };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Video length isn't in the RSS feed, so read it from the watch page once and cache it (shared by all stations).
const DURATIONS = path.join(DATA, "durations.json");
const durations = await readJson(DURATIONS, {}); // videoId -> seconds (0 = page had no length)
let durationsDirty = false;
const inflight = new Map(); // videoId -> Promise<boolean>, so concurrent lookups share one fetch
function lookupLength(videoId) {
  if (!inflight.has(videoId)) {
    inflight.set(videoId, getText(`https://www.youtube.com/watch?v=${videoId}`).then((html) => {
      if (!html) return false; // network/ratelimit: try again next time
      durations[videoId] = Number(html.match(/"lengthSeconds":"(\d+)"/)?.[1] || 0);
      durationsDirty = true;
      return true;
    }).finally(() => inflight.delete(videoId)));
  }
  return inflight.get(videoId);
}
async function fillDurations(videos, why, L) {
  const missing = videos.filter((v) => !(v.videoId in durations));
  if (missing.length) {
    L("len", `${why}: looking up ${missing.length} video lengths (${videos.length - missing.length} already cached)…`);
    const t0 = Date.now();
    let failed = 0;
    await mapLimit(missing, 4, async (v) => { if (!(await lookupLength(v.videoId))) failed++; }); // more than this and YouTube throttles
    L("len", `${why}: done in ${ms(t0)}` + (failed ? c.red(` · ${failed} lookups failed (will retry later)`) : ""));
    if (durationsDirty) { durationsDirty = false; await writeJson(DURATIONS, durations); }
  }
  for (const v of videos) v.durationSec = durations[v.videoId];
}

// ---------- candidate pools (one per station) ----------
const pools = new Map(); // stationId -> {at, key, videos}
async function getPool(station, force = false) {
  const L = stationLog(station.id);
  const lineup = (await getLineup(station)).filter((ch) => !ch.banned);
  const key = lineup.map((ch) => ch.id).join(",");
  const pool = pools.get(station.id) || { at: 0, key: "", videos: [] };
  const age = Date.now() - pool.at;
  if (!force && pool.key === key && age < 60 * 60 * 1000) {
    L("pool", `using cached pool: ${pool.videos.length} videos, ${Math.round(age / 60000)} min old`);
    return pool.videos;
  }
  const reason = force ? "manual refresh" : pool.at === 0 ? "first load" : pool.key !== key ? "lineup changed" : "cache expired";
  L("pool", `fetching feeds for ${lineup.length} channels (${reason})…`);
  const t0 = Date.now();
  const lists = await mapLimit(lineup, 8, (ch) => fetchChannelVideos(ch, L));
  const fresh = { at: Date.now(), key, videos: lists.flat() };
  pools.set(station.id, fresh);
  L("pool", c.bold(`pool ready: ${fresh.videos.length} videos from ${lineup.length} channels in ${ms(t0)}`));
  // Look up lengths for the whole pool in the background so later picks are instant.
  fillDurations(fresh.videos, "background", L).catch((e) => L("error", `background length lookup: ${e.message}`));
  return fresh.videos;
}
const invalidatePool = (id) => pools.delete(id);

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
async function getSubs() {
  try {
    const rows = parseCsv(await fs.readFile(path.join(DATA, "subscriptions.csv"), "utf8"));
    return rows.map((r) => ({ id: r.find((x) => /^UC[\w-]{22}$/.test(x.trim()))?.trim(), title: r[2] || r[r.length - 1] }))
      .filter((s) => s.id);
  } catch { return []; }
}

// ---------- AI: build lineup ----------
async function buildLineup(station) {
  const L = stationLog(station.id);
  const subs = station.useSubscriptions ? await getSubs() : [];
  const lineup = await getLineup(station);
  const known = new Set(lineup.map((ch) => ch.id));
  const banned = lineup.filter((ch) => ch.banned).map((ch) => ch.title);
  L("lineup", c.bold(`building lineup for "${station.name}": ${station.useSubscriptions ? `${subs.length} subscriptions` : "subscriptions not used"}, ${lineup.length} channels already known, ${banned.length} removed by you`));

  const result = await askJson({
    L,
    label: "lineup",
    effort: "medium",
    maxTokens: 16000,
    system: `You program "${station.name}", a personal, always-on TV station built from YouTube channels.\n\nThe station's vibe:\n${station.vibe}\n\nVideos on this station run ${station.minMinutes}-${station.maxMinutes} minutes.`,
    user: [
      station.useSubscriptions
        ? `The viewer subscribes to these channels (id | title). Many are things they want to watch attentively, not for this station. Keep only those that clearly fit the vibe.\n${subs.length ? subs.map((s) => `${s.id} | ${s.title}`).join("\n") : "(no subscriptions imported)"}`
        : `This station doesn't use the viewer's subscriptions, so return an empty keep_subscription_ids list.`,
      ``,
      `Suggest 30 real YouTube channels for this station that you are confident exist and that regularly upload videos fitting the vibe and length range (for music, official artist or VEVO channels count). Give each as its @handle.`,
      station.useSubscriptions && subs.length ? `Lean on what the viewer's subscriptions say about their taste.` : "",
      banned.length ? `The viewer removed these, so don't suggest them or anything like them: ${banned.join(", ")}` : "",
      lineup.length ? `Already in the lineup (don't re-suggest): ${lineup.map((ch) => ch.title).join(", ")}` : "",
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["keep_subscription_ids", "suggestions"],
      properties: {
        keep_subscription_ids: { type: "array", items: { type: "string" } },
        suggestions: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["handle", "name", "why"],
            properties: { handle: { type: "string" }, name: { type: "string" }, why: { type: "string" } },
          },
        },
      },
    },
  });

  const subById = new Map(subs.map((s) => [s.id, s]));
  let added = 0; const failed = [];
  if (station.useSubscriptions) L("lineup", `Claude kept ${result.keep_subscription_ids.length} of ${subs.length} subscriptions:`);
  for (const id of result.keep_subscription_ids) {
    const s = subById.get(id);
    if (!s) { L("lineup", c.red(`  ? ${id} isn't in your subscriptions, ignored`)); continue; }
    if (known.has(id)) { L("lineup", c.dim(`  = ${s.title} (already in lineup)`)); continue; }
    lineup.push({ id, title: s.title, source: "sub" }); known.add(id); added++;
    L("lineup", `  + ${s.title}`);
  }
  L("lineup", `Claude suggested ${result.suggestions.length} channels, checking each handle on YouTube…`);
  const resolved = await mapLimit(result.suggestions, 6, async (s) => ({ s, ch: await resolveChannel(s.handle) }));
  for (const { s, ch } of resolved) {
    if (!ch) { failed.push(s.handle); L("lineup", c.red(`  x ${s.handle} (${s.name}): not found on YouTube, dropped`)); continue; }
    if (known.has(ch.id)) { L("lineup", c.dim(`  = ${ch.title} (already in lineup)`)); continue; }
    lineup.push({ id: ch.id, title: ch.title, source: "ai", why: s.why }); known.add(ch.id); added++;
    L("lineup", `  + ${ch.title} ${c.dim(`(${s.handle}) ${s.why}`)}`);
  }
  await saveLineup(station.id, lineup);
  invalidatePool(station.id);
  L("lineup", c.bold(`lineup saved: +${added} channels, ${lineup.filter((ch) => !ch.banned).length} active total, ${failed.length} handles not found`));
  return { added, keptSubs: result.keep_subscription_ids.length, suggested: result.suggestions.length, unresolved: failed };
}

// ---------- AI: pick next ----------
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function pickNext(station, exclude = []) {
  const L = stationLog(station.id);
  const t0 = Date.now();
  const { minMinutes, maxMinutes } = station;
  const count = station.picksPerCall;
  const history = await getHistory(station.id);
  L("pick", c.bold(`picking next ${count}`) + c.dim(` (excluding ${exclude.length} already queued, ${history.length} plays in history)`));
  const videos = await getPool(station);
  if (!videos.length) throw new Error(`"${station.name}" has no channels yet. Open Settings and build its lineup.`);

  const monthAgo = Date.now() - 30 * 864e5;
  const seen = new Set([...exclude, ...history.filter((h) => h.outcome === "unplayable" || h.at > monthAgo).map((h) => h.videoId)]);
  const capPerChannel = (list, max) => {
    const per = new Map();
    return list.filter((v) => { const n = per.get(v.channelId) || 0; if (n >= max) return false; per.set(v.channelId, n + 1); return true; });
  };
  // Sample wide, look up lengths, then keep only videos in the station's length range.
  const fresh = videos.filter((v) => !seen.has(v.videoId));
  const sample = shuffle(fresh).slice(0, 200);
  L("pick", `${videos.length} in pool → ${fresh.length} not played in 30 days → sampled ${sample.length}`);
  await fillDurations(sample, "pick", L);
  const inRange = (v) => v.durationSec >= minMinutes * 60 && v.durationSec <= maxMinutes * 60;
  const tooShort = sample.filter((v) => v.durationSec && v.durationSec < minMinutes * 60).length;
  const tooLong = sample.filter((v) => v.durationSec > maxMinutes * 60).length;
  const unknown = sample.filter((v) => !v.durationSec).length;
  const fits = sample.filter(inRange);
  const candidates = capPerChannel(fits, 3).slice(0, 90);
  L("pick", `length filter ${minMinutes}-${maxMinutes} min: ${fits.length} kept, ${tooShort} too short, ${tooLong} too long, ${unknown} unknown`);
  L("pick", `sending ${candidates.length} candidates from ${new Set(candidates.map((v) => v.channelId)).size} channels to Claude (max 3 per channel)`);
  if (!candidates.length) throw new Error(`Nothing new between ${minMinutes} and ${maxMinutes} minutes left on "${station.name}". Add channels or change the length range in Settings.`);

  const stats = new Map();
  for (const h of history.slice(-400)) {
    const s = stats.get(h.channelTitle) || { finished: 0, skipped: 0, liked: 0 };
    if (h.outcome in s) s[h.outcome]++;
    stats.set(h.channelTitle, s);
  }
  const recent = history.slice(-25).map((h) => {
    const what = h.outcome === "skipped" ? `SKIPPED after ${fmtLen(h.watchedSec)}`
      : h.outcome === "finished" ? `watched to the end (${fmtLen(h.durationSec)})`
      : h.outcome === "liked" ? "LIKED" : h.outcome;
    return `- "${h.title}" (${h.channelTitle}): ${what}`;
  });
  const now = new Date().toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });

  const result = await askJson({
    L,
    label: "pick",
    effort: "low",
    system: `You are the programming director of "${station.name}", a personal, always-on TV station. The viewer has it playing in a corner of their screen while they work. Keep a steady, pleasant flow: hold the mood, vary channels and topics so it doesn't get repetitive, and learn from skips and likes. A skip early in a video means "wrong for this station". Avoid partial excerpts, trailers, livestreams and clickbait unless the vibe asks for them.\n\nThe station's vibe:\n${station.vibe}`,
    user: [
      `It's ${now}.`,
      `Recently played (oldest first):`, recent.length ? recent.join("\n") : "(nothing yet: this is the first pick)",
      ``,
      `Channel track record (finished / skipped / liked):`,
      [...stats].filter(([, s]) => s.finished + s.skipped + s.liked).map(([k, s]) => `- ${k}: ${s.finished}/${s.skipped}/${s.liked}`).join("\n") || "(none yet)",
      ``,
      `Candidates (videoId | channel | title | length | published | views | description):`,
      candidates.map((v) => `${v.videoId} | ${v.channelTitle} | ${v.title} | ${fmtLen(v.durationSec)} | ${v.published?.slice(0, 10)} | ${v.views} | ${v.desc}`).join("\n"),
      ``,
      `Pick the next ${count} to play, in order. Give each a short, friendly reason (max 12 words) the viewer will see.`,
    ].join("\n"),
    schema: {
      type: "object", additionalProperties: false, required: ["picks"],
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["videoId", "reason"],
            properties: { videoId: { type: "string" }, reason: { type: "string" } },
          },
        },
      },
    },
  });

  const byId = new Map(candidates.map((v) => [v.videoId, v]));
  const bad = result.picks.filter((p) => !byId.has(p.videoId));
  if (bad.length) L("pick", c.red(`Claude returned ${bad.length} id(s) not in the candidates, ignored: ${bad.map((p) => p.videoId).join(", ")}`));
  let picks = result.picks.filter((p) => byId.has(p.videoId)).map((p) => ({ ...byId.get(p.videoId), reason: p.reason }));
  if (!picks.length) {
    picks = [{ ...candidates[0], reason: "Random pick (AI's choices didn't match the pool)" }];
    L("pick", c.red("no usable picks from Claude, falling back to a random candidate"));
  }
  L("pick", c.bold(`queued ${picks.length} in ${ms(t0)}:`) + "\n" + indent(picks.flatMap((p, i) => [
    `${i + 1}. [${fmtLen(p.durationSec)}] ${p.title} ${c.dim(`— ${p.channelTitle}`)}`,
    `   ${c.green(`"${p.reason}"`)}`,
  ])));
  return picks;
}

// ---------- HTTP ----------
async function body(req) {
  let s = ""; for await (const chunk of req) s += chunk; return s;
}
function send(res, code, data, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

const outcomeText = {
  finished: c.green("finished"), skipped: c.yellow("SKIPPED"), liked: c.magenta("LIKED"),
  unplayable: c.red("unplayable (embedding blocked or removed)"),
};
const num = (x, d) => (x !== "" && x != null && Number.isFinite(+x) && +x >= 0 ? +x : d);

// Every route gets (body, rawBody, query). Station routes take ?station= or body.station.
const routes = {
  "GET /api/stations": async () => ({
    stations: (await listStations()).map(({ id, name, minMinutes, maxMinutes }) => ({ id, name, minMinutes, maxMinutes })),
  }),
  "GET /api/state": async (_, __, q) => {
    const station = await getStation(q.get("station"));
    return {
      station, lineup: await getLineup(station), model: MODEL,
      hasKey: !!process.env.ANTHROPIC_API_KEY?.trim(),
      subsCount: (await getSubs()).length, poolSize: pools.get(station.id)?.videos.length || 0,
    };
  },
  "POST /api/station": async (b) => {
    const s = await getStation(b.station);
    const next = {
      ...s,
      name: String(b.name || s.name).slice(0, 60),
      vibe: String(b.vibe ?? s.vibe),
      minMinutes: num(b.minMinutes, s.minMinutes),
      maxMinutes: num(b.maxMinutes, s.maxMinutes),
      useSubscriptions: b.useSubscriptions === undefined ? s.useSubscriptions : !!b.useSubscriptions,
    };
    next.picksPerCall = next.maxMinutes <= 15 ? 5 : 3; // short videos burn through the queue faster
    await saveStation(next);
    stationLog(s.id)("config", `saved "${next.name}": length ${next.minMinutes}-${next.maxMinutes} min, subscriptions ${next.useSubscriptions ? "on" : "off"}, vibe ${next.vibe === s.vibe ? "unchanged" : "updated"}`);
    return { ok: true };
  },
  "POST /api/station/create": async (b) => {
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) throw new Error("Give the station a name.");
    let id = slug(name), n = 2;
    while (await readJson(path.join(STATIONS, `${id}.json`), null)) id = `${slug(name)}-${n++}`;
    const order = (await listStations()).length + 1;
    await saveStation({ ...STATION_DEFAULTS, id, name, order, vibe: `Describe what "${name}" should play: the mood, the kinds of videos, what to avoid.` });
    log("config", `created station "${name}" (stations/${id}.json)`);
    return { id };
  },
  "POST /api/subs": async (_, raw) => {
    await fs.writeFile(path.join(DATA, "subscriptions.csv"), raw);
    const n = (await getSubs()).length;
    log("lineup", `imported subscriptions.csv: ${n} channels`);
    return { count: n };
  },
  "POST /api/lineup/build": async (b) => buildLineup(await getStation(b.station)),
  "POST /api/lineup/add": async (b) => {
    const station = await getStation(b.station);
    const L = stationLog(station.id);
    L("lineup", `adding "${b.input}"…`);
    const ch = await resolveChannel(String(b.input || ""));
    if (!ch) throw new Error("Couldn't find that channel.");
    const lineup = await getLineup(station);
    const existing = lineup.find((x) => x.id === ch.id);
    if (existing) existing.banned = false; else lineup.push({ ...ch, source: "manual" });
    await saveLineup(station.id, lineup); invalidatePool(station.id);
    L("lineup", `  + ${ch.title} (${ch.id})`);
    return ch;
  },
  "POST /api/lineup/remove": async (b) => {
    const station = await getStation(b.station);
    const lineup = await getLineup(station);
    const ch = lineup.find((x) => x.id === b.id);
    if (ch) ch.banned = true;
    await saveLineup(station.id, lineup); invalidatePool(station.id);
    stationLog(station.id)("lineup", c.red(`  - removed ${ch?.title || b.id}; it won't be picked or re-suggested here`));
    return { ok: true };
  },
  "POST /api/pool/refresh": async (b) => ({ size: (await getPool(await getStation(b.station), true)).length }),
  "POST /api/next": async (b) => ({ picks: await pickNext(await getStation(b.station), b.exclude || []) }),
  "POST /api/event": async (b) => {
    const station = await getStation(b.station);
    const L = stationLog(station.id);
    const { station: _, ...event } = b;
    if (b.outcome === "started") {
      L("event", `▶ ${c.bold(b.title)} ${c.dim(`— ${b.channelTitle} [${fmtLen(b.durationSec)}]`)}`);
      return { ok: true };
    }
    if (b.outcome === "tuned") {
      L("event", c.bold(`📺 tuned to "${station.name}"`));
      return { ok: true };
    }
    const history = await getHistory(station.id);
    history.push({ ...event, at: Date.now() });
    await writeJson(stationFile(station.id, "history.json"), history.slice(-3000));
    const watched = b.outcome === "liked" ? "" : c.dim(` after ${fmtLen(b.watchedSec)} of ${fmtLen(b.durationSec)}`);
    L("event", `${outcomeText[b.outcome] || b.outcome}: ${b.title} ${c.dim(`— ${b.channelTitle}`)}${watched}`);
    return { ok: true };
  },
  // The page reports its own errors here so they show up in this console too.
  "POST /api/clientlog": async (b) => { log("error", `[browser] ${b.message}`); return { ok: true }; },
};

const quiet = new Set(["/api/event", "/api/clientlog", "/api/stations", "/api/state"]); // log themselves or are noisy
http.createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) {
      const raw = req.method === "POST" ? await body(req) : "";
      let parsed = {}; try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
      const result = await route(parsed, raw, url.searchParams);
      if (!quiet.has(url.pathname)) log("http", c.dim(`${req.method} ${url.pathname} 200 ${ms(t0)}`));
      return send(res, 200, result);
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      log("http", c.dim(`GET / (page load)`));
      return send(res, 200, await fs.readFile(path.join(PUBLIC, "index.html")), "text/html; charset=utf-8");
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    const msg = err instanceof Anthropic.AuthenticationError ? "Anthropic rejected the API key in .env."
      : err instanceof Anthropic.RateLimitError ? "Rate limited by the Anthropic API. Try again in a minute."
      : err instanceof Anthropic.APIError ? `Anthropic API error ${err.status}: ${err.message}`
      : err.message;
    log("error", `${req.method} ${url.pathname} failed after ${ms(t0)}: ${msg}`);
    if (!(err instanceof Anthropic.APIError) && err.stack) console.error(c.dim(err.stack.split("\n").slice(1, 4).join("\n")));
    send(res, 500, { error: msg });
  }
}).listen(PORT, "127.0.0.1", async () => {
  const stations = await listStations();
  console.log(c.bold(`\n🛋️  Couch Potato on http://localhost:${PORT}`));
  console.log(c.dim(`  model ${MODEL} · API key ${process.env.ANTHROPIC_API_KEY?.trim() ? "set" : c.red("MISSING")} · ${Object.keys(durations).length} video lengths cached`));
  for (const [i, s] of stations.entries()) {
    const lineup = (await readJson(stationFile(s.id, "lineup.json"), s.seedChannels)).filter((ch) => !ch.banned);
    const plays = (await getHistory(s.id)).length;
    console.log(c.dim(`  ${i + 1}. ${s.name} (${s.id}): ${lineup.length} channels, ${plays} plays, ${s.minMinutes}-${s.maxMinutes} min`));
  }
  if (!stations.length) console.log(c.red("  no stations found in stations/"));
  console.log("");
});
