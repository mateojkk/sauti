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
**Speak into the mic:**
> Okay, three things for later. First: the idea — a full voice-notes pipeline from the cloud, pulled down to run locally with QVAC. Second: the product — I talk, Sauti writes a real note: title, body, summary and tasks. Third: upload this to DoraHacks before five. Done.

**Do:** click the **timer** to finish. Progress bar runs — keep talking over it, do not apologize:
> That progress bar is Whisper and a small Qwen running on this CPU right now. Wi-Fi is still off.

## SHOT 3 — THE NOTE — +35 s
**On screen:** the new card pops into the rail → click it → note view.
**Do:** scroll the body slowly → pause on **Tasks** → (optional: play 2 s of audio) → click **Copy** once.
**Say:**
> One recording in — this note out. Title, body, tasks. It's one local SQLite file, and the audio is still here if I ever need the source.

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
- Title comes out ALL-CAPS or odd? It's honest small-model output — read past it, **do not reshoot the note for cosmetics**.
- Live write-up slow on camera? Fill the gap with the Shot 2 line about the CPU; 35 s of bar is *the point*, not a defect.
- Record button misbehaves on camera: click **Upload**, drop `test-audio/recordings/1793313947119-recording.wav`, and continue with the same script (it's the 32 s note we validated at 30 s pipeline time).
- Cleaning the corpus before the take is allowed and looks good on camera: open the morning dry-run note and delete it — the rail then shows yesterday's note + the one that lands mid-take.
- Post-take: re-record only if a phrase was unintelligible to YOU, not because the model paraphrased your words.
