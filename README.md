# Sauti — offline voice notes

*"Sauti" = voice in Swahili.*

Sauti takes a cloud AI workflow — record audio → cloud speech-to-text → cloud LLM →
summaries on a hosted dashboard (the Otter.ai / Wispr pattern) — and runs **the whole
pipeline on your own device** with [QVAC](https://qvac.tether.io), Tether's local AI SDK.
No API keys, no uploads, no internet after setup.

**AI Yako hackathon entry — track: Cloud to Pocket.**

## Status

- [x] QVAC SDK validated on target hardware (Node.js, Linux x64)
- [x] Whisper ASR validated (EN; 15.4 s audio transcribed in 1.7 s)
- [ ] Full pipeline (transcribe → summarize → note)
- [ ] Semantic search over past notes (local embeddings)
- [ ] Local web UI
- [ ] Cloud-vs-device tradeoff benchmarks
- [ ] Offline demo video

## Quickstart

```bash
npm install
QVAC_CONFIG_PATH=./qvac.config.json node quickstart.js   # proves the SDK + model run
```
