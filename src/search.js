/**
 * Semantic search over saved notes, fully local.
 *
 * Embeds each note (title + summary + transcript) once with the local
 * embeddings model and caches vectors in SQLite. A query is embedded the
 * same way and ranked by cosine similarity. Nothing leaves the device.
 */
import { loadModel, embed, unloadModel } from '@qvac/sdk';
import {
    listNotes,
    getNote,
    loadVectors,
    saveVector,
    clearVectors,
    notesMissingVectors,
} from './db.js';

export const EMBED_MODEL = 'EMBEDDINGGEMMA_300M_Q4_0';

function cosineSimilarity(a, b) {
    let dot = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) dot += a[i] * b[i];
    return dot;
}

/** Note text used for the embedding (kept short for speed). */
export function noteText(note) {
    const body = `${note.body ?? ''} ${note.summary}. ${note.transcript}`.slice(0, 1800);
    return `title: ${note.title} | text: ${body}`;
}

/** Query text. embeddinggemma expects the task instruction prefix. */
export function queryText(query) {
    return `task: search result | query: ${query}`;
}

export { removeVector } from './db.js';

/**
 * (Re)build the vector index for notes missing embeddings.
 * `force` re-embeds every note.
 */
export async function buildIndex({ force = false } = {}) {
    const sdk = await import('@qvac/sdk');
    const constant = sdk[EMBED_MODEL];
    if (!constant) throw new Error(`Unknown embedding constant: ${EMBED_MODEL}`);

    if (force) clearVectors();
    const todo = (force ? listNotes() : notesMissingVectors()).map((note) => ({
        id: note.id,
        text: noteText(note),
    }));
    if (todo.length === 0) {
        return { indexed: 0, total: Object.keys(loadVectors()).length };
    }

    const t0 = Date.now();
    const { modelId, loadMs } = await timedLoadEmbeddings(constant);
    try {
        const { embedding } = await embed({
            modelId,
            text: todo.map((t) => t.text),
        });
        todo.forEach((t, i) => saveVector(t.id, embedding[i]));
        console.error(`▸ Embedded ${todo.length} note(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s (model load ${(loadMs / 1000).toFixed(1)}s)`);
    } finally {
        await unloadModel({ modelId });
    }
    return { indexed: todo.length, total: Object.keys(loadVectors()).length };
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

    const vectors = loadVectors();
    const entries = Object.entries(vectors).filter(([id]) => id && id !== 'null');
    if (entries.length === 0) return [];

    const { modelId } = await timedLoadEmbeddings(constant);
    try {
        const { embedding } = await embed({ modelId, text: queryText(query) });
        const q = typeof embedding[0] === 'number' ? embedding : embedding[0];
        const ranked = [];
        const scored = entries
            .map(([id, vec]) => ({ id, score: cosineSimilarity(q, vec) }))
            .sort((a, b) => b.score - a.score);
        for (const r of scored) {
            const note = getNote(r.id);
            if (!note) continue;
            ranked.push({
                id: r.id,
                score: r.score,
                title: note.title,
                summary: note.summary || note.body,
                createdAt: note.createdAt,
            });
            if (ranked.length >= k) break;
        }
        return ranked;
    } finally {
        await unloadModel({ modelId });
    }
}
