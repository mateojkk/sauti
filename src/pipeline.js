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
    asr: process.env.SAUTI_ASR ?? 'WHISPER_LARGE_V3_TURBO',
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

/** Stage 2: clean the transcript into a typed note. Not a recap, not a theme essay. */
export async function summarize(modelId, transcript) {
    const SYSTEM = `Type up this voice recording as a real note. Keep the speaker's claims and order. Fix punctuation. Drop um/uh.

TITLE a few of their words, not a magazine headline
NOTE structured from what they said:
- paragraphs when they talked in prose
- a short ## heading when the topic shifts
- - bullets when they listed items
Do not write a recap. Do not write "this note highlights". Do not invent a moral or a Summary section.`;
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
    if (!parsed.title || isPromptLeak(parsed.title) || isLabelHeading(parsed.title) || isJunkBody(parsed.title) || isFragmentTitle(parsed.title) || isEssayTitle(parsed.title)) {
        parsed.title = titleFromText(transcript);
    }
    if (!parsed.body || isPromptLeak(parsed.body) || isJunkBody(parsed.body) || isEditorial(parsed.body) || !followsTranscript(parsed.body, transcript)) {
        parsed.body = tidySpoken(transcript);
    }
    parsed.body = parsed.body.replace(/\u2014/g, ', ');
    parsed.summary = '';
    parsed.actions = [];
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
        const m = text.match(new RegExp(`(?:^|\\n)\\s*\\**${head}\\s*\\**\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n[^\\w\\n]*(?:TITLE|NOTE|BODY|SUMMARY|TASKS|ACTIONS?\\s*ITEMS?)\\b|$)`, 'i'));
        return m ? m[1].trim() : '';
    };
    const title = grab('TITLE').replace(/\*\*/g, '').split('\n')[0].trim();
    const body = (grab('NOTE') || grab('BODY')).replace(/\*\*/g, '')
        .split('\n')
        .filter((ln) => !/^\s*(TITLE|NOTE|BODY|SUMMARY|TASKS|ACTIONS?|ACTION\s+ITEMS?)\s*:?\s*$/i.test(ln) && !/^\s*(SUMMARY|TASKS|TITLE|BODY|NOTE)\s*:/i.test(ln))
        .join('\n').trim();
    const summary = grab('SUMMARY').replace(/\*\*/g, '').trim();
    const actionsRaw = (grab('TASKS') || grab('ACTION ITEMS')).replace(/\*\*/g, '').trim();
    return { title: cleanTitle(title), body, summary, actions: cleanActions(actionsRaw.split('\n')) };
}

/** Titles carry JSON debris when models break format; clean and cap. */
function isPromptLeak(text) {
    return /title case|all caps|2-6 words|max \d+ words|not all caps|short title|first person|do not copy|one sentence/i.test(text);
}

function isLabelHeading(text) {
    return /^(NOTE|TITLE|SUMMARY|TASKS|BODY)\b/i.test(String(text).trim());
}

function isEssayTitle(text) {
    return /^(the )?(power|importance|art|beauty|value|magic|gift) of\b/i.test(String(text).trim());
}

function isEditorial(text) {
    return /this note highlights|the importance of|profound impact|make a (big|real|profound) difference|simple acts of kindness/i.test(text);
}

const STOP = new Set('the a an and or of to in on for with is are was were be been being it this that those these can will would could should about from as at by not'.split(' '));

function contentTokens(s) {
    return String(s).toLowerCase().replace(/[^\w\s']/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function followsTranscript(body, transcript) {
    const b = contentTokens(body);
    const t = new Set(contentTokens(transcript));
    if (b.length < 6) return true;
    return b.filter((w) => t.has(w)).length / b.length >= 0.4;
}

/** Tiny models often emit a numbered skeleton instead of a note. */
function isJunkBody(text) {
    const t = String(text).trim();
    if (!t) return true;
    if (isLabelHeading(t)) return true;
    const ordinals = t.match(/\b\d+\s*(st|nd|rd|th)\s*:/gi) || [];
    if (ordinals.length >= 3) return true;
    const labeled = t.match(/\b(first|second|third|1st|2nd|3rd|\d+th)\s*:/gi) || [];
    if (labeled.length >= 3) return true;
    const nums = t.match(/(?:^|\n)\s*\d+[.)]\s/g) || [];
    if (nums.length >= 6) return true;
    const words = t.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 24) {
        const tri = new Map();
        for (let i = 0; i < words.length - 2; i++) {
            const k = words.slice(i, i + 3).join(' ');
            const n = (tri.get(k) || 0) + 1;
            if (n >= 3) return true;
            tri.set(k, n);
        }
    }
    return false;
}

function tidySpoken(transcript) {
    return String(transcript).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function titleFromText(text) {
    let line = String(text).replace(/\s+/g, ' ').trim();
    line = line.replace(/^(okay|ok|um+|uh+|so|well|alright)[,.\s]+/i, '');
    line = line.replace(/^[^.]{0,80}don't have to type it later[,.\s]*/i, '');
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

/** Mid-sentence echoes the model copies back (", body, summary and tax.", "title, body, tasks").
    These are never real note titles — reject and speak from the transcript instead. */
function isFragmentTitle(t) {
    const s = String(t).trim();
    if (!s) return true;
    if (/^[,.;:–—\-\s]/.test(s)) return true;                                  // starts with punctuation
    if (/^(and|or|with|but)\b/i.test(s)) return true;                          // starts with a conjunction
    if (/\b(summary|body|tasks|transcript)\b/i.test(s) && (/and\b|,/i.test(s))) return true; // template echo list
    if (/[,;:]$/.test(s)) return true;                                        // truncated mid-phrase
    if (s.split(/\s+/).length < 2) return true;
    return false;
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

/** Human-readable markdown rendering of a note — file export + .md sidecar use this.
 *  Export mode: no internal metadata, and no Transcript section when the body
 *  already came from this exact speech (the transcript IS the note). */
export function noteToMarkdown(note, { includeMeta = true } = {}) {
    const body = (note.body || '').trim();
    const transcript = (note.transcript || '').trim();
    const same = norm(body) === norm(transcript) && body !== '';
    return [
        `# ${note.title}`,
        ...(includeMeta ? ['', `*${new Date(note.createdAt).toISOString()} · ${note.audioFile}*`, ''] : ['']),
        body,
        '',
        ...(note.summary ? ['## Summary', note.summary, ''] : []),
        ...(note.actions.length ? ['## Tasks', ...note.actions.map((a) => `- ${a}`), ''] : []),
        ...(!same && transcript ? ['## Transcript', transcript, ''] : []),
        ...(includeMeta ? [
            '---',
            `_models: asr=${note.models?.asr ?? ''}, llm=${note.models?.llm ?? ''}. timings: asr=${((note.timing?.transcribeMs ?? 0) / 1000).toFixed(1)}s, llm=${((note.timing?.llmMs ?? 0) / 1000).toFixed(1)}s_`,
        ] : []),
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
    // Fixing the transcript fixes the note: the body IS the corrected speech.
    if (patch.transcript != null && patch.body == null) note.body = tidySpoken(note.transcript);
    await writeFile(join(NOTES_DIR, `${safe}.md`), noteToMarkdown(note));
    insertNote(note);
    try { removeVector(safe); } catch { /* reindex will rebuild */ }
    return note;
}

/** Save a note: one row in the DB + a human-readable markdown export next to it. Returns the note id. */
export async function saveNote(note) {
    note.id = new Date(note.createdAt).toISOString().replace(/[:.]/g, '-');
    await writeFile(join(NOTES_DIR, `${note.id}.md`), noteToMarkdown(note));
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

    await writeStructuredNotes(note, { verbatimBody: true });
    note.id = await saveNote(note);
    return note;
}

/** The transcript IS the note: a fresh recording shows the spoken words (tidied),
 *  and the model only contributes the title and summary. Paraphrasing happens solely
 *  when the user explicitly asks for it via the "Rewrite notes" button. */
async function writeStructuredNotes(note, { verbatimBody = false } = {}) {
    const llmConstant = await sdkConstant(MODELS.llm);
    const llm = await warmLoad('llm', MODELS.llm, () => timedLoad(llmConstant));
    note.timing.loadLlmMs = llm.loadMs;
    const notes = await summarize(llm.modelId, note.transcript);
    Object.assign(note, {
        title: notes.title,
        body: verbatimBody ? tidySpoken(note.transcript) : notes.body,
        summary: notes.summary,
        actions: notes.actions,
    });
    note.summary = dedupeSummary(note.body, note.summary);
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
    await writeFile(join(NOTES_DIR, `${note.id}.md`), noteToMarkdown(note));
    insertNote(note);
    try { removeVector(note.id); } catch { /* reindex will rebuild */ }
    return note;
}
