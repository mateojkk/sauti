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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MODELS = {
    asr: 'WHISPER_BASE_Q8_0',          // 82 MB, multilingual (sw supported, weak)
    llm: process.env.SAUTI_LLM ?? 'QWEN3_600M_INST_Q4', // 382 MB; SAUTI_LLM to override
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
    const SYSTEM = `You convert meeting transcripts into notes. Reply with ONLY a JSON object, no other text, in this exact shape:
{"title": "short title, max 8 words", "summary": "two sentences", "actions": ["Maria: fix the sync bugs", "Joseph: demo the dashboard"]}
Before writing actions, check the transcript for unfinished work, bugs, deadlines, demos, follow-ups and renewals. Include EVERY task mentioned in actions. Use [] if there are none.`;
    const history = [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Transcript:\n${transcript}\n\nJSON: /no_think` },
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
    // Small-model guardrails: cap the title, drop empty summary.
    parsed.title = parsed.title.split(/\s+/).slice(0, 8).join(' ');
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

/** Accepts strict JSON (preferred) and falls back to plain-text headings. */
export function parseNotes(text) {
    // JSON path: first '{' to last '}'.
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s !== -1 && e > s) {
        try {
            const j = JSON.parse(text.slice(s, e + 1));
            if (j && typeof j.title === 'string') {
                return {
                    title: j.title.trim(),
                    summary: String(j.summary ?? '').trim(),
                    actions: Array.isArray(j.actions)
                        ? j.actions.map((a) => String(a).trim()).filter(Boolean).map((a) => a.replace(/^person\s*:\s*/i, '').trim()).filter(Boolean)
                        : [],
                };
            }
        } catch { /* fall through to plain-text parsing */ }
    }
    const grab = (head) => {
        const m = text.match(new RegExp(`${head}\\s*:?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(TITLE|SUMMARY|ACTIONS)\\b|$)`, 'i'));
        return m ? m[1].trim() : '';
    };
    const title = grab('TITLE').replace(/\*\*/g, '').split('\n')[0].trim();
    const summary = grab('SUMMARY').replace(/\*\*/g, '').trim();
    const actionsRaw = grab('ACTIONS').replace(/\*\*/g, '').trim();
    const actions = actionsRaw
        .split('\n')
        .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
        .filter((l) => l && !/^none$/i.test(l));
    return { title, summary, actions };
}

/** Save a note as markdown + index entry. Returns the note id. */
export async function saveNote(note) {
    await mkdir(NOTES_DIR, { recursive: true });
    const id = new Date(note.createdAt).toISOString().replace(/[:.]/g, '-');
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
export async function processAudio(audioPath, { language = 'en' } = {}) {
    const asrConstant = await sdkConstant(MODELS.asr);
    const llmConstant = await sdkConstant(MODELS.llm);
    const note = {
        id: null,
        createdAt: Date.now(),
        audioFile: audioPath,
        language,
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
