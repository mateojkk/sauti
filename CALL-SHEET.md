# Sauti call sheet — ONE take, ≈2 min 15 s

**Now running:** the Electron window is on your screen, 2 notes in the rail, models cached on disk.
**Right before rolling:** disconnect the network (unplug/airplane). Sauti keeps working — that is the entire premise. Post a sticky note over your monitor rack saying **"NETWORK OFF"** so it's memorable on camera.

*Cheat map:*
- LEFT rail — search bar + **Ask**, note cards (title · duration · gist · day)
- CENTER — hero "Talk. Get notes."
- BOTTOM recbar — **Record** (or **R**) → timer (**click it to finish**) · **Upload** · **EN** pill
- Never: browser, DevTools, terminal. Only the Sauti window + (once) the system Wi-Fi menu.

---

## SHOT 1 — HOOK — 0:00–0:12
**On screen:** idle hero. One second of stillness before you talk.
**Say:**
> Most voice-notes apps ship your voice to someone else's API. Sauti runs the whole pipeline on this laptop — speech-to-text, a writing model, even search — with nothing in the cloud. Watch.

## SHOT 2 — RECORD — 0:12–0:50
**Do:** click **Record** (or R).
**Speak into the mic:** (say *Sauti* slowly — small Whisper garbles brand words if rushed; that's fine, Shot 3 turns it into the feature)
> Okay, three things for later. First: the idea — a full voice-notes pipeline from the cloud, pulled down to run locally with QVAC. Second: the product — I talk, Sauti writes a real note: title, body, summary and tasks. Third: upload this to DoraHacks before five. Done.

**Do:** click the **timer** to finish. Progress bar runs ~30 s — keep talking over it, do not apologize:
> That progress bar is Whisper and a small Qwen running on this CPU right now. Wi-Fi is still off.

## SHOT 3 — FIX + REWRITE (the feature) — +60 s
**On screen:** the new card lands in the rail → click it → note view.
**Expect garbled brand words in the transcript** ("Sauti", "QVAC", "DoraHacks"). That's the moment — do NOT reshoot:
**Do:** click **Fix transcript** → replace exactly three fragments:
1. `run localeo QVAC` (or whatever it made of "run locally with QVAC") → `run locally with QVAC`
2. `SoundT-Rise erynotes` (or whatever) → `Sauti writes a real note`
3. `their ARCs` (or whatever) → `DoraHacks`
Scan the rest once; fix anything obviously wrong; **save** → click **Rewrite notes** (bar ~15 s):
**Say:**
> Small offline models miss product names — of course they do. So I fix the transcript instead of re-recording, and the note rewrites itself out of the corrected text. Title, body, tasks — all local.
**Do:** scroll the rebuilt note → pause on **Tasks** → click **Copy** once. Optional: play 2 s of audio first, then pause.

## SHOT 4 — SEARCH — +30 s
**Do:** click the search bar (or **/**) → type `life is not easy` → click **Ask**.
**Say:**
> That phrase isn't copied from any note — this is embedding search running on the same disk, in my own words. Ends up, I still get the note back.
**Do:** click the top hit (it *is* the right note — verified: score 0.66 vs 0.21 for second place; visually clear). Spare query if you want a second one: `the three things`.

## SHOT 5 — CLOSE — last 10 s
**Do:** flash the system network menu, still disconnected (1 s).
**Say:**
> Talk. Get notes. Cloud to pocket. That's Sauti.
**Cut.**

---

## Safety
- **Do not switch to large-v3-turbo for the live take** — tested on the exact same audio: it still garbles "Sauti" AND took 1 m 44 s on this machine (turbo + Chromium swapping in 8 GB). Small + Fix transcript is the play. Turbo stays documented as the accuracy upgrade path in the README.
- Title/body odd even after Fix → Rewrite? Rewriting runs the local LLM again — it usually improves; if one task line reads oddly, say the honest line: "small model hiccups, and I still own the recording to check against."
- Live write-up slow on camera? Fill the gap with Shot 2's CPU line; 30 s of bar is *the point*, not a defect.
- Record button misbehaves on camera: click **Upload**, drop `test-audio/recordings/1793313947119-recording.wav`, and continue with the same script (32 s note we validated at ~30 s pipeline time).
- Re-record only if YOUR delivery was unintelligible — not because the model paraphrased you.
