Sauti — DoraHacks submission text

Project name:        Sauti
Track:               Cloud to Pocket
Video:               (paste link after upload)
Repo:                (set public + push final commit before submitting)

──────────────────────────────────────────────────────────────────────────────
TAGLINE (one line)
──────────────────────────────────────────────────────────────────────────────
Talk. Get notes. The voice-notes workflow — speech-to-text, writing, search —
runs entirely on your laptop with QVAC. No API keys, no uploads, no cloud.

──────────────────────────────────────────────────────────────────────────────
DESCRIPTION (paste into the project description field)
──────────────────────────────────────────────────────────────────────────────

## The problem

Voice notes are how the world already talks to itself — but every mainstream
voice-notes product ships your audio to someone else's API. On metered mobile
data, a "fun" voice note costs money; on a privacy question, it costs the
content itself. The cloud did the transcription, the summarizing, the search —
and kept the paper trail.

## What Sauti is

Sauti is the same workflow — record → speech-to-text → LLM → structured,
searchable notes — with the cloud removed. Talk, and in about half a minute you
have a real note on your own laptop: title, structured body, summary, action
items, and the full transcript underneath. Recordings stay playable. Notes are
stored in a local SQLite database and exported as human-readable Markdown.
Search is semantic (embeddings on the same disk), so "ask in your own words"
returns the right note even when keywords don't literally match.

You can also fix a word Whisper missed: edit the transcript, hit Rewrite, and
Sauti rebuilds the note from that text — no re-recording.

## How we use QVAC

QVAC (Tether's local-AI SDK) runs every model in-process on the laptop:

- **Whisper small Q8_0** for speech-to-text (`SAUTI_ASR` env switch overridable,
  e.g. to `WHISPER_LARGE_V3_TURBO` for maximum accuracy at ~3× the latency)
- **Qwen3-600M instruct Q4** turns each transcript into title / structured body
  / summary — `/no_think` for speed; a small local model can't afford
  to philosophize
- **embeddinggemma-300M** with its task-select prompt templates for semantic
  search (documents embedded as "title: … | text: …", queries as
  "task: search result | query: …")

Models are pulled once from the QVAC registry (~2.4 GB total) via the SDK's
normal download path; every run after that is fully offline. The server binds
localhost only, and the UI is a static page with zero third-party assets
(even the font — Inter Light/Medium — is shipped locally, 2 × 24 KB).

## Stack (and why it's judge-runnable)

- **Node.js 22** + `@qvac/sdk` v0.22 for all three models
- **SQLite via built-in `node:sqlite`** — a real storage engine with zero
  native dependencies to compile; `sauti.db` + WAL, one `notes` table and one
  `vectors` table. Legacy JSON auto-migrates on first open
- **Vanilla JS/CSS local UI** (record/pause/upload rail, note view with
  transcript fix + rewrite, semantic search bar) — no framework, no build step
- **Electron shell** (`npm run app`) for a real desktop window, same code path
- **CLI** for the same pipeline from a terminal (`node cli.js process/list/
  search/delete/show`)

Setup: `npm install`, then
`QVAC_CONFIG_PATH=./qvac.config.json npm start`, open
http://localhost:8787, disconnect the network, record.

## Demonstrated end-to-end test

32-second spoken note → transcribed, structured, indexed, searchable in ~30 s
wall time on a 2018 dual-core i5-8265U / 8 GB RAM / Fedora. Search for "dora"
ranks the note about the demo submission first. Delete removes the note, its
vector, and its file cleanly.

## Honest limits

- Local inference is slower than a GPU cloud — that's what this track accepts
- English-first: the ASR language selector includes Swahili, but we only claim
  what we demo (English); selection of other models via env override
- Small model, not large: near-real-time transcribe was chosen over max
  accuracy; quality at whisper-large-v3-turbo (~1.6 GB, RTF ≈ 1.0 on this
  laptop) was validated and is the documented upgrade path

## Disclosures

- QVAC SDK `@qvac/sdk` v0.22.0 (npm); models WHISPER_SMALL_Q8_0 (x1.bin),
  QWEN3_600M_INST_Q4, EMBEDDINGGEMMA_300M_Q4_0 — downloaded from the QVAC
  model registry once, cached under `~/.qvac/models/` before the demo
- Node v22.23.4, npm 10.9.9
- Network use: (a) the one-time model download during setup, (b) nothing at
  runtime. The demo video is recorded with the network interface down; the
  app has an on-screen indicator that turns green the moment it notices no
  internet
- The demo machine ships with three real recordings by the author; the repo
  itself ships with an empty database, so a fresh clone records from zero
- Everything runs locally; no telemetry, no keys, no accounts

──────────────────────────────────────────────────────────────────────────────
SPEAKER NOTES FOR ANY FIELDS YOU TYPE BY HAND
──────────────────────────────────────────────────────────────────────────────
Keep the song the same: one recorder, one laptop, one database. If a judge
asks "why not just call the Whisper API?" — because the answer defines this
track: the API works when the network is billing you for it. Sauti works when
airplane mode is on.
