# Sauti demo script

Target: about 90 seconds on camera, network off after models are already on disk.

Warm the app once with the internet on (`npm start`, open http://localhost:8787, record a throwaway 10 seconds so Whisper and Qwen are cached). Then disconnect Wi‑Fi / ethernet. Start recording the video. Do not open DevTools.

If transcribe takes a while, keep talking to camera over the progress bar. Do not apologize for it. That wait is the point: the laptop is doing the cloud job.

## Shot 0. Setup (not in the video)

1. `QVAC_CONFIG_PATH=./qvac.config.json npm start`
2. Browser at http://localhost:8787, window large, dark UI fully visible (rail + idle + recbar).
3. Airplane mode or unplug the network. Confirm the page still loads (localhost).
4. Mic unmuted. EN on the recbar. No other tabs fighting for the mic.

## Shot 1. Hook (0:00–0:12)

**On screen:** idle. “Talk. Get notes.”

**Say:**
> Most voice notes still ship your audio to someone else's API. Sauti is the same workflow, Otter-style, except the speech-to-text, the writing, and the search all run on this machine. No keys. No upload. Watch.

**Do:** hover the recbar. Do not click yet.

## Shot 2. Record (0:12–0:45)

**Do:** press R (or Record). Pause is visible. Speak clearly, a little slower than usual.

**Say into the mic (this is the note):**
> Okay, capturing this so I don't have to type it later. Cloud to Pocket means taking a hosted pipeline and running it locally with QVAC. The product is I talk, then it transcribes and writes a real note with title, body, summary, and tasks, not a raw dump. Follow-ups I actually have: record the disconnected demo, then submit on DoraHacks. That's it.

**Do:** click the timer (Done). Let the progress bar run. Stay on the window.

**Say over the wait, to camera:**
> That bar is Whisper and a small Qwen, on device. Nothing left the laptop.

## Shot 3. The note (when it opens)

**On screen:** the saved note. Scroll the body, summary, tasks, then the transcript. Play one second of audio if it helps, then pause.

**Say:**
> Same recording, now a note I can actually use. Title, structured body, a gist, and tasks. Transcript is underneath if I need to check a word.

**If a word is wrong:**
1. Click **Fix transcript**.
2. Change one obvious error.
3. Save.
4. Click **Rewrite notes**.
5. Point at the updated body.

**Say (only if you do that):**
> Whisper missed a word. I fix the transcript, rewrite, and the note updates. I don't re-record.

**If the transcript is fine:** skip the edit. Click **Copy** once so they see the action.

## Shot 4. Search (about 0:70)

**Do:** Back. Click the search box (or /). Type a phrase from the note, e.g. `dora` or `qvac`. Click **Ask**.

**Say:**
> Search is embeddings on the same disk, not a remote index. Ask in my own words, get the note back.

**Do:** click the hit. Land on the note again.

## Shot 5. Close (last 8 seconds)

**On screen:** the note, recbar still there. Optional: flash the system network menu still disconnected.

**Say:**
> Talk. Get notes. Cloud to pocket. That's Sauti.

Cut.

## Backup if live ASR is too slow

Do not fake the network. Do:

1. `node cli.js process test-audio/sample-en-16k.wav` before you roll, so a note already exists.
2. On camera: open that note, scroll it, search it.
3. Then do a *short* live recording (15 seconds) so they still see Record → progress → new note.

## What not to say

- Do not claim a Swahili translation of the name.
- Do not say it is instant. It is local, which can be slower than a GPU cloud.
- Do not say it needs the internet. Models are already here.

## B-roll if you need a second take

- Recbar: Record → Pause → Resume → Done.
- Sidebar filling with two notes.
- `sauti.db` in the project folder (one second, then back to the UI).
- Terminal: `node cli.js list` under the same notes.
