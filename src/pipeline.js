/**
 * Sauti core pipeline: audio → transcript → structured note.
 *
 * Every stage records its wall-clock time and the model used, so each saved
 * note doubles as a benchmark data point for the Cloud-to-Pocket write-up
 * (quality / speed / memory tradeoffs vs the cloud original).
 */
import {
    loadModel,
    transcribe,
    completion,
    unloadModel,
} from '@qvac/sdk';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { removeVector } from './search.js';

export const MODELS = {
    asr: process.env.SAUTI_ASR ?? 'WHISPER_LARGE_V3_TURBO', // 1.6 GB; base/small faster but weaker
    llm: process.env.SAUTI_LLM ?? 'QWEN3_600M_INST_Q4',     // 382 MB; SAUTI_LLM to override
};

const NOTES_DIR = 'notes';

/** Map a constant name to the SDK export at runtime (keeps models swappable). */
async function sdkConstant(name) {
    const sdk = await import('@qvac/sdk');
    if (!sdk[name]) throw new Error(`Unknown QVAC model constant: ${name}`);
    return sdk[name];
}

/** Load a model, timing it; caller owns unload. */
export async function timedLoad(modelSrc, modelType, modelConfig = {}, onProgress) {
    const t0 = Date.now();
    const modelId = await loadModel({ modelSrc, ...(modelType ? { modelType } : {}), ...(Object.keys(modelConfig).length ? { modelConfig } : {}), onProgress });
    return { modelId, loadMs: Date.now() - t0 };
}

/** Stage 1: speech → text. */
export async function transcribeFile(modelId, audioPath) {
    const t0 = Date.now();
    const text = await transcribe({ modelId, audioChunk: audioPath });
    return { transcript: text.trim(), inferMs: Date.now() - t0 };
}

/** Stage 2: transcript → { title, summary, actions } via the local LLM. */
export async function summarize(modelId, transcript) {
    const SYSTEM = `You convert meeting transcripts into notes. Output exactly three plain-text sections and nothing else:
TITLE: short title, max 8 words
SUMMARY: two sentences
ACTION ITEMS: one line per task someone must do, format "who: what they must do"
Rules: use only names and tasks actually spoken in the transcript — never invent people. Before writing ACTION ITEMS, check the transcript for unfinished work, bugs, deadlines, demos, follow-ups, renewals and appointments. Include EVERY task mentioned. Only if there is truly nothing, write "no tasks". No markdown bold.`;
    const history = [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Transcript:\n${transcript}\n\nNotes: /no_think` },
    ];
    const t0 = Date.now();
    const result = completion({ modelId, history, stream: true });
    let out = '';
    let tokens = 0;
    for await (const token of result.tokenStream) {
        out += token;
        tokens++;
    }
    const genMs = Date.now() - t0;
    const cleaned = stripThinking(out);
    const parsed = parseNotes(cleaned);
    // Small-model guardrails: cap the title, drop empty summary, never blank.
    parsed.title = parsed.title.split(/\s+/).slice(0, 8).join(' ');
    if (!parsed.title) parsed.title = 'Voice note';
    if (!parsed.summary) parsed.summary = transcript.slice(0, 140);
    return { ...parsed, genMs, tokens, tokensPerSec: +(tokens / (genMs / 1000)).toFixed(1) };
}

const THINK_OPEN = '<' + 'think>';
const THINK_CLOSE = '<' + '/think>';

export function stripThinking(text) {
    const start = text.indexOf(THINK_OPEN);
    if (start === -1) return text.trim();
    const end = text.indexOf(THINK_CLOSE, start);
    return (end === -1 ? text.slice(start + THINK_OPEN.length) : text.slice(end + THINK_CLOSE.length)).trim();
}

/** Accepts the model's output: JSON if present, else plain-text sections. */
export function parseNotes(text) {
    // 1) JSON path: first '{' to last '}'.
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s !== -1 && e > s) {
        try {
            const j = JSON.parse(text.slice(s, e + 1));
            if (j && typeof j.title === 'string') {
                return {
                    title: cleanTitle(j.title),
                    summary: String(j.summary ?? '').trim(),
                    actions: cleanActions(Array.isArray(j.actions) ? j.actions : []),
                };
            }
        } catch { /* malformed JSON — try field-level regex below */ }
    }
    // 1b) Malformed-JSON rescue: pull fields by regex, tolerate broken quotes.
    if (s !== -1 && /"title"|"summary"|"actions"/i.test(text)) {
        const title = text.match(/"title"\s*:\s*"([\s\S]*?)"\s*,\s*"summary"/i)
            ?? text.match(/"title"\s*:\s*"([^"]+)"/i);
        const summary = text.match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"actions"/i)
            ?? text.match(/"summary"\s*:\s*"([^"]+)"/i);
        const actionsBlock = text.match(/"actions"\s*:\s*\[([^\]]*)\]/i);
        if (title || summary) {
            const actions = actionsBlock
                ? actionsBlock[1].split(/",\s*"?|\["?/).map((x) => x.replace(/^"|"$/g, '').trim()).filter(Boolean)
                : [];
            return {
                title: cleanTitle(title?.[1] ?? ''),
                summary: (summary?.[1] ?? '').replace(/^["':\s]+/, '').trim(),
                actions: cleanActions(actions),
            };
        }
    }
    // 2) Plain-text headings: TITLE / SUMMARY / ACTIONS | ACTION ITEMS.
    const grab = (head) => {
        const m = text.match(new RegExp(`${head}\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(TITLE|SUMMARY|ACTIONS?\\s*ITEMS?)\\b|$)`, 'i'));
        return m ? m[1].trim() : '';
    };
    const title = grab('TITLE').replace(/\*\*/g, '').split('\n')[0].trim();
    const summary = grab('SUMMARY').replace(/\*\*/g, '').trim();
    const actionsRaw = grab('ACTION ITEMS').replace(/\*\*/g, '').trim();
    return { title: cleanTitle(title), summary, actions: cleanActions(actionsRaw.split('\n')) };
}

/** Titles carry JSON debris when models break format; clean and cap. */
function cleanTitle(t) {
    let title = String(t).trim();
    title = title.replace(/^["'{:\s]+/, '').replace(/["'}\s]+$/, '');
    title = title.split(/"actions"|"summary"|"\s*,/)[0].trim();
    title = title.replace(/\*\*/g, '');
    return title.split(/\s+/).slice(0, 8).join(' ');
}

/** Normalize action lines: drop template echoes, "none", bullets. */
function cleanActions(actions) {
    const lines = actions
        .map((a) => String(a).replace(/^[-*\d.\s"']+/, '').trim())
        .filter(Boolean)
        .filter((a) => !/^(the\s+)?person\s*:/i.test(a) && !/^<who>/i.test(a) && !/^(none|no tasks?)\b/i.test(a) && !/["']\s*:/.test(a));
    // Merge the model's split "Who: X" / "What: Y" pairs into "X: Y",
    // split mid-line enumerators ("...home. 2. Call..."), then dedupe.
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
        const who = lines[i].match(/^who\s*:\s*(.+)$/i);
        const what = lines[i + 1]?.match(/^what\s*:\s*(.+)$/i);
        if (who && what) {
            merged.push(`${who[1]}: ${what[1]}`);
            i++;
        } else {
            merged.push(lines[i].replace(/^(who|what|name)\s*:\s*/i, '').trim());
        }
    }
    const pieces = [];
    for (const raw of merged) {
        for (const piece of raw.split(/\s+\d+[.)]\s+/)) {
            const t = piece.trim();
            if (t) pieces.push(t);
        }
    }
    const seen = new Set();
    return pieces.filter((p) => {
        const key = p.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Delete a note's markdown, JSON and search vector. */
export async function deleteNote(id) {
    const safe = String(id);
    if (!/^[0-9T-]+Z$/.test(safe)) throw new Error(`invalid note id: ${safe}`);
    let removed = false;
    for (const ext of ['md', 'json']) {
        try {
            await unlink(join(NOTES_DIR, `${safe}.${ext}`));
            removed = true;
        } catch { /* already gone */ }
    }
    await removeVector(safe).catch(() => false);
    return removed;
}

/** Save a note as markdown + index entry. Returns the note id. */
export async function saveNote(note) {
    await mkdir(NOTES_DIR, { recursive: true });
    note.id = new Date(note.createdAt).toISOString().replace(/[:.]/g, '-');
    const id = note.id;
    const md = [
        `# ${note.title}`,
        '',
        `*${new Date(note.createdAt).toISOString()} — ${note.audioFile}*`,
        '',
        '## Summary',
        note.summary,
        '',
        '## Actions',
        ...(note.actions.length ? note.actions.map((a) => `- ${a}`) : ['- none']),
        '',
        '## Transcript',
        note.transcript,
        '',
        '---',
        `_models: asr=${note.models.asr}, llm=${note.models.llm} — timings: asr=${(note.timing.transcribeMs / 1000).toFixed(1)}s, llm=${(note.timing.llmMs / 1000).toFixed(1)}s_`,
    ].join('\n');
    await writeFile(join(NOTES_DIR, `${id}.md`), md);
    await writeFile(join(NOTES_DIR, `${id}.json`), JSON.stringify(note, null, 2));
    return id;
}

/** Full run: transcribe + summarize + persist. Returns the saved note. */
export async function processAudio(audioPath, { language = 'en', durationSec = null } = {}) {
    const asrConstant = await sdkConstant(MODELS.asr);
    const llmConstant = await sdkConstant(MODELS.llm);
    const note = {
        id: null,
        createdAt: Date.now(),
        audioFile: audioPath,
        language,
        durationSec,
        models: { ...MODELS },
        transcript: '',
        title: '',
        summary: '',
        actions: [],
        timing: { loadAsrMs: 0, transcribeMs: 0, loadLlmMs: 0, llmMs: 0, tokensPerSec: 0 },
    };

    const asr = await timedLoad(asrConstant, 'whisper', { language, translate: false, strategy: 'greedy', temperature: 0, n_threads: 4 });
    note.timing.loadAsrMs = asr.loadMs;
    const asrOut = await transcribeFile(asr.modelId, audioPath);
    note.transcript = asrOut.transcript;
    note.timing.transcribeMs = asrOut.inferMs;
    await unloadModel({ modelId: asr.modelId });

    const llm = await timedLoad(llmConstant);
    note.timing.loadLlmMs = llm.loadMs;
    const notes = await summarize(llm.modelId, note.transcript);
    Object.assign(note, { title: notes.title, summary: notes.summary, actions: notes.actions });
    note.timing.llmMs = notes.genMs;
    note.timing.tokensPerSec = notes.tokensPerSec;
    await unloadModel({ modelId: llm.modelId });

    note.id = await saveNote(note);
    return note;
}
