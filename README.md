# Sauti

Talk instead of type. Sauti records on this machine, transcribes with Whisper, and turns the transcript into a structured note (title, body, summary, tasks). Search is local too.

The cloud pattern (record → speech-to-text → LLM → dashboard) runs entirely on-device with [QVAC](https://qvac.tether.io). No API keys, no uploads, no internet after the first model download.

**AI Yako hackathon entry. Track: Cloud to Pocket.**

## Requirements

- Node.js 22.17+ (QVAC SDK requirement; uses the built-in `node:sqlite`)
- Linux x64 (validated). A few GB of disk for Whisper + Qwen + embeddings
- A microphone, or a WAV/MP3/M4A file to upload

## Run

```bash
npm install
QVAC_CONFIG_PATH=./qvac.config.json npm start
```

Open [http://localhost:8787](http://localhost:8787). First transcribe downloads models; later runs stay local.

Optional desktop window:

```bash
QVAC_CONFIG_PATH=./qvac.config.json npm run app
```

Prove the SDK once:

```bash
QVAC_CONFIG_PATH=./qvac.config.json node quickstart.js
```

## Use

- **R** starts and finishes a recording. **P** pauses. Esc cancels.
- Click the timer when you are done. Sauti transcribes, writes the note, and indexes it.
- **Fix transcript** if Whisper missed a word. **Rewrite notes** rebuilds title, body, summary, and tasks from that text.
- **Copy** puts the structured note on the clipboard.
- **Ask** in the sidebar is semantic search over your notes.

Notes live in `sauti.db` (WAL). Markdown exports land in `notes/`. Recordings are written under `test-audio/recordings/` and are not committed.

## CLI

```bash
node cli.js process path/to/audio.wav
node cli.js list
node cli.js show <id>
node cli.js delete <id>
node cli.js reindex [--force]
node cli.js search "what did I say about uploads" [--k 5]
```

## Models

Defaults (override with env):

| Stage | Default | Env |
| --- | --- | --- |
| Speech to text | Whisper small Q8_0 | `SAUTI_ASR` (e.g. `WHISPER_LARGE_V3_TURBO`) |
| Structured note | Qwen3 600M instruct Q4 | `SAUTI_LLM` |
| Search | embeddinggemma 300M | (wired in `src/search.js`) |

`SAUTI_THREADS` caps CPU threads. `SAUTI_DB` points at another SQLite file if you want.

## Layout

```
src/server.js      localhost UI + API
src/pipeline.js    audio → transcript → note
src/db.js          SQLite + one-time JSON import
src/search.js      on-device embeddings
public/            record, library, note view
cli.js             same pipeline from the terminal
```

## Status

- [x] On-device ASR + LLM + embeddings via QVAC
- [x] SQLite notes (auto-create, WAL, migrate leftover `notes/*.json`)
- [x] Local UI: record/pause/upload, structured note, transcript edit, rewrite, search
- [x] CLI process / list / search / delete
- [ ] ASR tier on more real voice (small vs large-v3-turbo)
- [ ] Demo video with the network disconnected
- [ ] DoraHacks submission
