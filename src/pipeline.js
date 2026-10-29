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
import { availableParallelism } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { insertNote, deleteNote as deleteNoteRow, removeVector, getNote, NOTES_DIR } from './db.js';

export const MODELS = {
    asr: process.env.SAUTI_ASR ?? 'WHISPER_SMALL_Q8_0',
    llm: process.env.SAUTI_LLM ?? 'QWEN3_600M_INST_Q4',
};

const THREADS = Math.max(4, Number(process.env.SAUTI_THREADS) || availableParallelism() || 4);

const warm = {
    asr: { key: null, modelId: null },
    llm: { key: null, modelId: null },
};

async function warmLoad(slot, key, loader) {
    if (warm[slot].modelId && warm[slot].key === key) {
        return { modelId: warm[slot].modelId, loadMs: 0 };
    }
    if (warm[slot].modelId) {
        await unloadModel({ modelId: warm[slot].modelId }).catch(() => {});
        warm[slot] = { key: null, modelId: null };
    }
    const loaded = await loader();
    warm[slot] = { key, modelId: loaded.modelId };
    return loaded;
}

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

/** Stage 2: transcript → typed note + short summary + tasks. */
export async function summarize(modelId, transcript) {
    const SYSTEM = `Turn spoken words into a structured note.

TITLE:
NOTE:
SUMMARY:
TASKS:

TITLE = a short name for this recording
NOTE = cleaned up, as if typed: short headings and bullets when that helps, otherwise a clear first-person note
SUMMARY = one or two sentences, not a copy of NOTE
TASKS = real to-dos if mentioned, else none
Facts only. Never copy these instructions.`;
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
    if (!parsed.title || isPromptLeak(parsed.title)) {
        parsed.title = titleFromText(parsed.body || transcript);
    }
    if (!parsed.body || isPromptLeak(parsed.body)) {
        parsed.body = (!parsed.summary || isPromptLeak(parsed.summary))
            ? transcript.slice(0, 280)
            : parsed.summary;
    }
    parsed.summary = isPromptLeak(parsed.summary) ? '' : dedupeSummary(parsed.body, parsed.summary);
    parsed.actions = parsed.actions.filter((a) => !containedIn(a, parsed.body));
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
                    body: String(j.note ?? j.body ?? '').trim(),
                    summary: String(j.summary ?? '').trim(),
                    actions: cleanActions(Array.isArray(j.actions) ? j.actions : Array.isArray(j.tasks) ? j.tasks : []),
                };
            }
        } catch { /* malformed JSON: try field-level regex below */ }
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
                body: '',
                summary: (summary?.[1] ?? '').replace(/^["':\s]+/, '').trim(),
                actions: cleanActions(actions),
            };
        }
    }
    // 2) Plain-text headings: TITLE / SUMMARY / ACTIONS | ACTION ITEMS.
    const grab = (head) => {
        const m = text.match(new RegExp(`${head}\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(TITLE|NOTE|BODY|SUMMARY|TASKS|ACTIONS?\\s*ITEMS?)\\b|$)`, 'i'));
        return m ? m[1].trim() : '';
    };
    const title = grab('TITLE').replace(/\*\*/g, '').split('\n')[0].trim();
    const body = (grab('NOTE') || grab('BODY')).replace(/\*\*/g, '').trim();
    const summary = grab('SUMMARY').replace(/\*\*/g, '').trim();
    const actionsRaw = (grab('TASKS') || grab('ACTION ITEMS')).replace(/\*\*/g, '').trim();
    return { title: cleanTitle(title), body, summary, actions: cleanActions(actionsRaw.split('\n')) };
}

/** Titles carry JSON debris when models break format; clean and cap. */
function isPromptLeak(text) {
    return /title case|all caps|2-6 words|max \d+ words|not all caps|short title|first person|do not copy|one sentence/i.test(text);
}

function titleFromText(text) {
    const line = String(text).split(/\n/).map((s) => s.replace(/^[-*#\s]+/, '').trim()).find(Boolean) || '';
    const words = line.replace(/[^\w\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (words.length < 2) return 'Voice note';
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function cleanTitle(t) {
    let title = String(t).trim();
    title = title.replace(/^["'{:\s]+/, '').replace(/["'}\s]+$/, '');
    title = title.split(/"actions"|"summary"|"\s*,/)[0].trim();
    title = title.replace(/\*\*/g, '');
    title = title.split(/\s+/).slice(0, 8).join(' ');
    if (isPromptLeak(title)) return '';
    if (title.length > 3 && title === title.toUpperCase() && /[A-Z]/.test(title)) {
        title = title.toLowerCase().replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
    }
    return title;
}

function norm(s) {
    return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function containedIn(needle, hay) {
    const n = norm(needle);
    const h = norm(hay);
    if (!n || n.length < 12) return false;
    return h.includes(n.slice(0, Math.min(48, n.length)));
}

function dedupeSummary(body, summary) {
    const b = norm(body);
    const s = norm(summary);
    if (!s) return '';
    if (s === b || b.includes(s) || s.includes(b.slice(0, 80))) return '';
    return summary.replace(/\s+/g, ' ').trim();
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

/** Delete a note from the DB (vector cascades) and drop leftover files. */
export async function deleteNote(id) {
    const safe = String(id);
    if (!/^[0-9T-]+Z$/.test(safe)) throw new Error(`invalid note id: ${safe}`);
    const removed = deleteNoteRow(safe);
    try { removeVector(safe); } catch { /* cascade already dropped it */ }
    for (const ext of ['md', 'json']) {
        try { await unlink(join(NOTES_DIR, `${safe}.${ext}`)); } catch { /* leftover or never written */ }
    }
    return removed;
}

function writeMarkdown(note) {
    return [
        `# ${note.title}`,
        '',
        `*${new Date(note.createdAt).toISOString()} · ${note.audioFile}*`,
        '',
        note.body || '',
        '',
        ...(note.summary ? ['## Summary', note.summary, ''] : []),
        ...(note.actions.length ? ['## Tasks', ...note.actions.map((a) => `- ${a}`), ''] : []),
        '## Transcript',
        note.transcript,
        '',
        '---',
        `_models: asr=${note.models?.asr ?? ''}, llm=${note.models?.llm ?? ''}. timings: asr=${((note.timing?.transcribeMs ?? 0) / 1000).toFixed(1)}s, llm=${((note.timing?.llmMs ?? 0) / 1000).toFixed(1)}s_`,
    ].join('\n');
}

export async function updateNote(id, patch) {
    const safe = String(id);
    if (!/^[0-9T-]+Z$/.test(safe)) throw new Error(`invalid note id: ${safe}`);
    const existing = getNote(safe);
    if (!existing) return null;
    const note = {
        ...existing,
        title: patch.title != null ? String(patch.title).trim() || existing.title : existing.title,
        body: patch.body != null ? String(patch.body) : existing.body,
        summary: patch.summary != null ? String(patch.summary).trim() : existing.summary,
        actions: Array.isArray(patch.actions)
            ? patch.actions.map((a) => String(a).trim()).filter(Boolean)
            : existing.actions,
        transcript: patch.transcript != null ? String(patch.transcript) : existing.transcript,
    };
    await writeFile(join(NOTES_DIR, `${safe}.md`), writeMarkdown(note));
    insertNote(note);
    try { removeVector(safe); } catch { /* reindex will rebuild */ }
    return note;
}

/** Save a note: one row in the DB + a human-readable markdown export next to it. Returns the note id. */
export async function saveNote(note) {
    note.id = new Date(note.createdAt).toISOString().replace(/[:.]/g, '-');
    await writeFile(join(NOTES_DIR, `${note.id}.md`), writeMarkdown(note));
    insertNote(note);
    return note.id;
}

/** Full run: transcribe + summarize + persist. Returns the saved note. */
export async function processAudio(audioPath, { language = 'en', durationSec = null } = {}) {
    const asrConstant = await sdkConstant(MODELS.asr);
    const note = {
        id: null,
        createdAt: Date.now(),
        audioFile: audioPath,
        language,
        durationSec,
        models: { ...MODELS },
        transcript: '',
        title: '',
        body: '',
        summary: '',
        actions: [],
        timing: { loadAsrMs: 0, transcribeMs: 0, loadLlmMs: 0, llmMs: 0, tokensPerSec: 0 },
    };

    const asr = await warmLoad('asr', `${MODELS.asr}:${language}`, () => timedLoad(asrConstant, 'whisper', {
        language, translate: false, strategy: 'greedy', temperature: 0, n_threads: THREADS,
    }));
    note.timing.loadAsrMs = asr.loadMs;
    const asrOut = await transcribeFile(asr.modelId, audioPath);
    note.transcript = asrOut.transcript;
    note.timing.transcribeMs = asrOut.inferMs;

    await writeStructuredNotes(note);
    note.id = await saveNote(note);
    return note;
}

async function writeStructuredNotes(note) {
    const llmConstant = await sdkConstant(MODELS.llm);
    const llm = await warmLoad('llm', MODELS.llm, () => timedLoad(llmConstant));
    note.timing.loadLlmMs = llm.loadMs;
    const notes = await summarize(llm.modelId, note.transcript);
    Object.assign(note, { title: notes.title, body: notes.body, summary: notes.summary, actions: notes.actions });
    note.timing.llmMs = notes.genMs;
    note.timing.tokensPerSec = notes.tokensPerSec;
}

/** Re-run structuring on a saved transcript (after the user fixes ASR errors). */
export async function rebuildFromTranscript(id) {
    const existing = getNote(String(id));
    if (!existing) return null;
    if (!String(existing.transcript || '').trim()) throw new Error('no transcript to rebuild from');
    const note = { ...existing, timing: { ...(existing.timing || {}) } };
    await writeStructuredNotes(note);
    await writeFile(join(NOTES_DIR, `${note.id}.md`), writeMarkdown(note));
    insertNote(note);
    try { removeVector(note.id); } catch { /* reindex will rebuild */ }
    return note;
}
