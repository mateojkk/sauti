/**
 * Semantic search over saved notes, fully local.
 *
 * Embeds each note (title + summary + transcript) once with the local
 * embeddings model and caches vectors in notes/vectors.json. A query is
 * embedded the same way and ranked by cosine similarity. Nothing leaves
 * the device.
 */
import { loadModel, embed, unloadModel } from '@qvac/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const EMBED_MODEL = 'EMBEDDINGGEMMA_300M_Q4_0';
const NOTES_DIR = 'notes';
export const VECTORS_FILE = join(NOTES_DIR, 'vectors.json');

function cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

/** Note text used for the embedding (kept short for speed). */
export function noteText(note) {
    const body = `${note.summary}. ${note.transcript}`.slice(0, 1800);
    return `title: ${note.title} | text: ${body}`;
}

/** Query text — embeddinggemma expects the task instruction prefix. */
export function queryText(query) {
    return `task: search result | query: ${query}`;
}

async function loadVectors() {
    try {
        return JSON.parse(await readFile(VECTORS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

/** Drop one note's vector from the index (used when a note is deleted). */
export async function removeVector(id) {
    const vectors = await loadVectors();
    if (!(id in vectors)) return false;
    delete vectors[id];
    await writeFile(VECTORS_FILE, JSON.stringify(vectors));
    return true;
}

/**
 * (Re)build the vector index for all notes. Returns { indexed, total }.
 * `force` re-embeds even notes that already have vectors.
 */
export async function buildIndex({ force = false } = {}) {
    const sdk = await import('@qvac/sdk');
    const constant = sdk[EMBED_MODEL];
    if (!constant) throw new Error(`Unknown embedding constant: ${EMBED_MODEL}`);

    const noteFiles = (await readdir(NOTES_DIR).catch(() => []))
        .filter((f) => f.endsWith('.json') && f !== 'vectors.json');
    if (noteFiles.length === 0) return { indexed: 0, total: 0 };

    const vectors = force ? {} : await loadVectors();
    const todo = [];
    for (const f of noteFiles) {
        const note = JSON.parse(await readFile(join(NOTES_DIR, f), 'utf8'));
        if (force || !vectors[note.id]) {
            todo.push({ id: note.id, text: noteText(note) });
        }
    }

    let indexed = 0;
    if (todo.length > 0) {
        const t0 = Date.now();
        const { modelId, loadMs } = await timedLoadEmbeddings(constant);
        try {
            const { embedding } = await embed({
                modelId,
                text: todo.map((t) => t.text),
            });
            todo.forEach((t, i) => {
                vectors[t.id] = embedding[i];
            });
            indexed = todo.length;
            console.error(`▸ Embedded ${indexed} note(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s (model load ${(loadMs / 1000).toFixed(1)}s)`);
        } finally {
            await unloadModel({ modelId });
        }
        await writeFile(VECTORS_FILE, JSON.stringify(vectors));
    }
    return { indexed, total: Object.keys(vectors).length };
}

async function timedLoadEmbeddings(constant) {
    const t0 = Date.now();
    const modelId = await loadModel({ modelSrc: constant });
    return { modelId, loadMs: Date.now() - t0 };
}

/** Embed a query and return the top-k notes ranked by cosine similarity. */
export async function search(query, { k = 5 } = {}) {
    const sdk = await import('@qvac/sdk');
    const constant = sdk[EMBED_MODEL];
    if (!constant) throw new Error(`Unknown embedding constant: ${EMBED_MODEL}`);

    const vectors = await loadVectors();
    const entries = Object.entries(vectors).filter(([id]) => id && id !== 'null');
    if (entries.length === 0) return [];

    const { modelId } = await timedLoadEmbeddings(constant);
    try {
        const { embedding } = await embed({ modelId, text: queryText(query) });
        const q = embedding;
        const ranked = entries
            .map(([id, vec]) => ({ id, score: cosineSimilarity(q, vec) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        // Attach note metadata for display.
        for (const r of ranked) {
            try {
                const note = JSON.parse(await readFile(join(NOTES_DIR, `${r.id}.json`), 'utf8'));
                r.title = note.title;
                r.summary = note.summary;
                r.createdAt = note.createdAt;
            } catch { /* note file gone; keep score-only */ }
        }
        return ranked;
    } finally {
        await unloadModel({ modelId });
    }
}
