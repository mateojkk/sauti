# Sauti, offline voice notes

*"Sauti" = voice in Swahili.*

Sauti takes a cloud AI workflow (record audio → cloud speech-to-text → cloud LLM →
summaries on a hosted dashboard, the Otter.ai / Wispr pattern) and runs **the whole
pipeline on your own device** with [QVAC](https://qvac.tether.io), Tether's local AI SDK.
No API keys, no uploads, no internet after setup.

**AI Yako hackathon entry. Track: Cloud to Pocket.**

## Status

- [x] QVAC SDK validated on target hardware (Node.js, Linux x64)
- [x] Speech-to-text (Whisper Q8_0 tiers; EN + multilingual)
- [x] Local LLM meeting notes (Qwen3-600M-instruct, JSON /no_think): title, 2-sentence summary, action items
- [x] Notes saved to disk (`notes/*.md` + `.json`, with per-stage timings) + delete
- [x] Semantic search over past notes (embeddinggemma-300M, local vectors, 4/4 retrieval accuracy)
- [x] Local web UI: record (browser PCM→16 kHz WAV) or upload → note; list; view; search. Zero external assets.
- [ ] ASR model-tier decision on real-user voice (base vs small vs large-v3-turbo)
- [ ] Demo video (recorded with internet disconnected)
- [ ] DoraHacks submission

## Quickstart

```bash
npm install
QVAC_CONFIG_PATH=./qvac.config.json node quickstart.js   # proves the SDK + model run
```
