// Embedding quality eval: raw text vs embeddinggemma prompt templates.
import { loadModel, embed, unloadModel, EMBEDDINGGEMMA_300M_Q4_0 } from '@qvac/sdk';
import { listNotes } from '../src/db.js';

const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const notes = listNotes().map((n) => ({
    title: n.title,
    text: `${n.title}. ${n.summary}. ${n.transcript}`.slice(0, 2000),
}));
const queries = ['dentist visit', 'football training schedule', 'renew the domain', 'cake recipe'];

const modelId = await loadModel({ modelSrc: EMBEDDINGGEMMA_300M_Q4_0 });
for (const mode of ['raw', 'prompted']) {
    const doc = (t, title) => (mode === 'raw' ? t : `title: ${title} | text: ${t}`);
    const q = (s) => (mode === 'raw' ? s : `task: search result | query: ${s}`);
    const docs = await embed({ modelId, text: notes.map((n) => doc(n.text, n.title)) });
    const qs = await embed({ modelId, text: queries.map(q) });
    console.log(`=== mode: ${mode} (dim ${docs.embedding[0].length}) ===`);
    for (let qi = 0; qi < queries.length; qi++) {
        const scores = notes.map((n, i) => ({ title: n.title.slice(0, 22), s: cos(qs.embedding[qi], docs.embedding[i]).toFixed(3) }));
        scores.sort((a, b) => b.s - a.s);
        console.log(queries[qi].padEnd(28), scores.map((x) => `${x.s} ${x.title}`).join(' | '));
    }
}
await unloadModel({ modelId });
