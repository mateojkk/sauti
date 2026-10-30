# AI Yako — QVAC / WDK / Pears Deep-Dive Notes

_Compiled Mon 26 Oct 2026 from docs.qvac.tether.io, docs.wdk.tether.io, HuggingFace, and the tetherto/qvac GitHub repo. QVAC SDK current release: **v0.22**._

---

## 1. What QVAC is

Open-source (Apache-2.0) local AI SDK by Tether. One API, ~19 AI task types, all on-device.
Two clients over the same worker:

| Client | Package | Runs on |
| --- | --- | --- |
| JS/TS | `@qvac/sdk` (npm) | Node.js, Bare, Expo (iOS/Android) |
| Python | `tetherto-qvac-sdk` (PyPI) | CPython, asyncio |

**AI capabilities:** text generation (llama.cpp), embeddings, RAG (out of the box), LoRA fine-tuning, multimodal (text+image chat), batch processing, image/video/music generation, world simulation, transcription (Whisper / NVIDIA Parakeet), TTS (GGML), **voice assistant pipeline** (mic → ASR → LLM → TTS in one loop), translation (Bergamot NMT + LLM-based), OCR, image classification, decisions (Laya), BCI, VLA.

**P2P capabilities:** fetch models from peers (distributed registry), blind relays (NAT traversal), RPC servers.

**Also:** QVAC CLI — runs an **OpenAI-compatible HTTP server** on a local model (drop-in for anything that speaks OpenAI API). `qvac doctor` validates the environment.

## 2. The killer finding for this hackathon

**TranslatePsy-AfriSLM** — Tether's own offline African MT models, published to the QVAC model registry:

- `TRANSLATEPSY_AFRISLM_0_8B_TRANSLATION_Q4_K_M` — **672 MB**
- `TRANSLATEPSY_AFRISLM_0_8B_TRANSLATION_Q8_0` — 1,082 MB
- `TRANSLATEPSY_AFRISLM_2B_*` (Q4 1.6GB / Q8 ~2.3GB), `AFRICAN_4B_TRANSLATION_Q4_K_M` — 2,867 MB

- Languages: **English + 19 Sub-Saharan African languages: Swahili**, Afrikaans, Amharic, Hausa, Igbo, Kinyarwanda, Lingala, Luganda, Malagasy, Nyanja, Oromo, Shona, Somali, Southern Sotho, Tswana, Wolof, Xhosa, Yoruba, Zulu.
- Based on Qwen3.5-0.8B, full-param SFT; EMNLP 2026 paper (arXiv 2608.18655); beats TranslateGemma-27B and Qwen3.5-122B-A10B on African MT benchmarks (SSA-COMET).
- Q4_K_M loses almost nothing (0.5886 vs 0.5944 Flores-200).
- **Apache-2.0** model license. Prompt format: language *names* in the prompt ("Translate the following English text into Swahili"), system prompt = professional translator, output only the translation.
- Caveat (state it in the repo): synthetic-training-data disclaimer; not validated for high-stakes domains.

The Bergamot NMT engine has 101 EN↔X pairs (~17–44 MB each) but **no Swahili** — Swahili must go through AfriSLM.

## 3. JS/TS quickstart facts

```bash
npm i @qvac/sdk          # Node >= v22.17 (bundling: ^22.21 || >=24.9), npm >= 10.9
```

`qvac.config.json` (project root or `QVAC_CONFIG_PATH`): `loggerLevel`, `loggerConsoleOutput`, `cacheDirectory` (absolute model cache path), `httpDownloadConcurrency`, `deviceDefaults` (force `llm.device: "cpu"` per device brand on Android), etc. JSON is the only config format that works in Expo.

Core flow: `loadModel({ modelSrc, onProgress }) → modelId` → `completion({ modelId, history, stream }) / translate(...) → tokenStream` → `unloadModel({ modelId })` → `close()`. Multiple models can be loaded simultaneously.

**On Bare:** use `@qvac/inference` instead of `@qvac/sdk`, register plugins explicitly:
`plugins([llmPlugin])` from `@qvac/inference/llamacpp-completion/plugin`. (`@qvac/bare-sdk` is deprecated.)

**On Expo/mobile:** `npm i react-native-bare-kit@^0.16.0` + `@qvac/sdk/expo-plugin` in app.json, `npx expo prebuild` after every install, run on a **physical device** (llamacpp does not run on emulators). Android minSdk 29, Android 12+, iOS 17+.

**Translation API:** `loadModel({ modelSrc: BERGAMOT_EN_ES, modelConfig: { engine: 'Bergamot', from: 'en', to: 'es' } })`, then `translate({ modelId, text, modelType: 'nmtcpp-translation', stream: true })`. LLM-based translation (AfriSLM) uses the llamacpp-completion engine with prompt-based directions.

Model sources: registry constant (auto-download from Tether's distributed registry), local path, or HTTP URL.

## 4. System requirements + this laptop's verdict

- Linux: Ubuntu 22+, **Vulkan ≥ 1.4 for GPU** (CPU fallback), `libatomic1` required, `libibverbs` optional.
- Windows: Vulkan required even for CPU. macOS 14+ arm64 (Metal). RAM ≥ 2 GB, recommended ≥ 4 GB; ~2 GB *available* at model load; ≥ 5 GB disk per model.
- `ffmpeg` needed for mic capture / transcription examples / audio decode.
- `qvac doctor` checks Node version, RAM, disk, Vulkan, tools (`--json` for machine output).

**This laptop (i5-8265U, 8 GB RAM, 218 GB free, Node v22.23.4, npm 10.9.9, Vulkan 1.4.341 present):** comfortably runs every ≤1.1 GB model; 2–2.9 GB models (Qwen3-4B, AfriSLM-4B) work with heavy apps closed; don't plan anything ≥5 GB. Free RAM currently ~2.4 GB → close browsers before loading models or expect swap.

## 5. Curated model menu (registry constants, `expectedSize`)

### Translation / text gen — small
| Constant | Size | Notes |
| --- | --- | --- |
| `TRANSLATEPSY_AFRISLM_0_8B_TRANSLATION_Q4_K_M` | 672 MB | EN ↔ 19 African langs incl. **Swahili** |
| `QWEN3_600M_INST_Q4` | 382 MB | smallest instruct chat model |
| `SMOLLM2_360M_INST_Q8` | 386 MB | |
| `LLAMA_3_2_1B_INST_Q4_0` | 773 MB | the official quickstart model |
| `LLAMA_TOOL_CALLING_1B_INST_Q4_K_M` | 808 MB | **tool/function calling** — for agentic finance |
| `QWEN3_1_7B_INST_Q4` | 1,057 MB | |
| `QWEN3_4B_INST_Q4_K_M` | 2,497 MB | best small quality |
| `BITNET_1B_BASE_TQ2_0` | 835 MB | 1.58-bit ternary (base, not instruct) |

### Speech
| Constant | Size | Notes |
| --- | --- | --- |
| `WHISPER_TINY/BASE_Q8_0` | 44/82 MB | multilingual ASR (incl. Swahili); `WHISPER_EN_*` = English-only |
| `WHISPER_SMALL_Q8_0` | 264 MB | better accuracy |
| `PARAKEET_0_6B_Q4_0` | 405 MB | fast English ASR |
| `PARAKEET_EOU_120M_V1_Q4_0` | 74 MB | tiny, end-of-utterance |
| `MOSS_TRANSCRIBE_DIARIZE_Q5_0` | 641 MB | ASR + **speaker diarization** |
| `VAD_SILERO_5_1_2` | 1 MB | voice activity detection |
| `TTS_EN_SUPERTONIC_Q4_0` | 132 MB | English TTS |
| CosyVoice3 parts (LLM Q4 795 MB + flow Q4 210 MB + hift 48 MB + tokenizer) | ~1.1 GB total | multilingual TTS pipeline |

### Multimodal / vision / OCR / embeddings / decisions
| Constant | Size | Notes |
| --- | --- | --- |
| `VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M` | 303 MB | QVAC's own tiny VLM |
| `SMOLVLM2_500M_MULTIMODAL_Q8_0` | 437 MB | |
| `QWEN3VL_2B_MULTIMODAL_Q4_K` | 1,107 MB | |
| `QWEN3_5_0_8B_MULTIMODAL_Q4_K_M` | 533 MB | newer Qwen3.5 vision |
| `OCR_0_6B_MULTIMODAL_Q4_K_M` | 397 MB | vision OCR |
| `OCR_CRAFT` + `OCR_LATIN` + `OCR_DOCTR*` | ~100 MB total | classic OCR pipeline |
| `EMBEDDINGGEMMA_300M_Q4_0` | 278 MB | embeddings → RAG |
| `GTE_LARGE_FP16` | 670 MB | |
| `LAYA_MULTILINGUAL_322M_Q8_0` | 348 MB | routing/classification decisions |

(Registry also carries huge models — GPT-OSS-120B, DeepSeek-V4-304B, Qwen3.8-177B — irrelevant for 8 GB hardware.)

## 6. WDK (finance track)

- Core: `@tetherto/wdk` + per-chain managers: `@tetherto/wdk-wallet-evm` (incl. ERC-4337), `-tron`, `-btc`, `-solana`, `-ton`, `-spark` (Lightning), `-aptos`; plus swap/bridge (Velora, LI.FI, 0x, USD₮0 bridge), lending (Aave/Morpho), fiat on/off-ramp (MoonPay/Transak), Smart Deposit Addresses.
- Works in **Node.js 20+ and Bare** — same runtime family as QVAC's Bare worker; WDK even ships `pear-wrk-wdk` (run WDK in a Pear worklet) and a worklet bundler.
- API sketch: `WDK.getRandomSeedPhrase()` → `new WDK(seed).registerWallet('ethereum', WalletManagerEvm, {provider})` → `getAccount(chain, 0)` → `getAddress()/getBalance()/quoteSendTransaction()/sendTransaction()` → `dispose()`.
- **Testnet:** Pimlico / Candide faucets for Sepolia test USD₮ (never demo with real funds — brief requires safe test environment for the offline portion).
- Tools: secret manager, encrypted backup, P2P address book, indexer API, failover provider.
- Network truth: balance checks, fee quotes and broadcasts need RPC/network → declare separately from the offline AI demo (the brief explicitly requires this split).

## 7. Pears / P2P

- Pear Runtime (`pear.hole`, docs.pears.com): ships P2P apps on Bare + Hypercore + Hyperswarm. QVAC itself runs on Bare — a Pear app can host the QVAC worker in-process.
- QVAC blind relays connect peers across NATs/firewalls; RPC servers let one device expose QVAC capabilities to another.
- The brief: "Pears is welcome for device-to-device features." Device-to-device without internet is a strong demo differentiator.

## 8. Track-by-track feasibility read

**Track 1 — Offline AI apps (700):** Suggested topic is *live translation*; AfriSLM + Whisper + TTS = voice translator with **Swahili**, ~1.5 GB of models, runs on this laptop and mid-range phones via Expo. Highest local-relevance score: demoing EN↔Swahili voice translation offline in Nairobi.

**Track 2 — Cloud to Pocket (900):** biggest prize per pool; e.g., move a cloud support-bot/RAG workflow to QVAC locally (embeddings 278 MB + Qwen3-1.7B 1.06 GB + built-in RAG). The QVAC OpenAI-compatible server makes "same workflow, no cloud" trivially demonstrable.

**Track 3 — Agentic finance + WDK (400):** smallest track prize but least crowded; `LLAMA_TOOL_CALLING_1B` (808 MB) + WDK. Offline part: AI parses/decides and drafts transactions on-device; network part: signing/broadcast via WDK on Sepolia testnet, declared separately.

**Submission logistics:** deadline Fri 30 Oct 17:00 EAT on DoraHacks; repo + demo video showing the core AI feature with internet disconnected; disclose SDK versions (`@qvac/sdk` v0.22.x), model names, download steps, device/OS/RAM, and any network-dependent features. Download models *before* the demo (`cacheDirectory` in qvac.config.json; `assessModelFit()` API pre-checks memory).

## 9. Open questions to resolve before choosing

- Does AfriSLM load as a plain `llamacpp-completion` model via registry constant (docs list `TRANSLATEPSY_AFRISLM_0_8B_TRANSLATION_Q4_K_M` under llamacpp-completion — verify `engine` field in `contract/models.json`)? → it did at compile time; confirm with `modelRegistrySearch('AFRISLM')` at build time.
- Swahili ASR: Whisper base/small handle Swahili with moderate WER — test with real audio early (Wed check-in).
- Expo phone target vs laptop-only demo: laptop is safer in 4 days; Expo adds build pipeline risk.
