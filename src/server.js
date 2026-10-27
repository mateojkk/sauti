/**
 * Sauti local server — serves the UI and the pipeline API on localhost only.
 * No external assets, no API keys, no outbound calls: it runs with the
 * network fully disconnected (judging requirement).
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { processAudio } from './pipeline.js';
import { buildIndex, search } from './search.js';

const PORT = 8787;
const PUBLIC = 'public';
const RECORDINGS = 'test-audio/recordings';
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

/** One model job at a time — 8 GB laptop. */
let busy = null;
function withQueue(fn) {
    const run = async () => {
        try { return await fn(); } finally { busy = null; }
    };
    busy = run();
    return busy;
}

const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
        if (url.pathname === '/api/notes' && req.method === 'GET') {
            const { readdir } = await import('node:fs/promises');
            const files = (await readdir('notes').catch(() => [])).filter((f) => f.endsWith('.json') && f !== 'vectors.json').sort().reverse();
            const notes = [];
            for (const f of files) {
                const n = JSON.parse(await readFile(join('notes', f), 'utf8'));
                notes.push({ id: n.id, title: n.title, summary: n.summary, actions: n.actions, createdAt: n.createdAt, language: n.language });
            }
            return json(res, 200, { notes });
        }

        if (url.pathname.startsWith('/api/note/') && req.method === 'GET') {
            const id = url.pathname.split('/').pop();
            const note = JSON.parse(await readFile(join('notes', `${id}.json`), 'utf8'));
            return json(res, 200, { note });
        }

        if (url.pathname === '/api/process' && req.method === 'POST') {
            const lang = url.searchParams.get('lang') ?? 'en';
            const name = url.searchParams.get('name') ?? 'upload.wav';
            if (busy) return json(res, 503, { error: 'Sauti is processing another note — one moment' });
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            if (chunks.length === 0) return json(res, 400, { error: 'empty body' });
            const audio = Buffer.concat(chunks);
            await mkdir(RECORDINGS, { recursive: true });
            const file = join(RECORDINGS, `${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`);
            await writeFile(file, audio);
            const note = await withQueue(() => processAudio(file, { language: lang }));
            await buildIndex().catch((e) => console.error('reindex failed:', e.message));
            return json(res, 200, { note });
        }

        if (url.pathname === '/api/search' && req.method === 'POST') {
            const { query, k } = await new Promise((resolve, reject) => {
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
            });
            if (busy) return json(res, 503, { error: 'Sauti is busy' });
            const results = await withQueue(() => search(String(query ?? ''), { k: Number(k) || 5 }));
            return json(res, 200, { results });
        }

        // Static files.
        let path = url.pathname === '/' ? '/index.html' : url.pathname;
        const file = join(PUBLIC, path);
        if (existsSync(file) && extname(file)) {
            const data = await readFile(file);
            res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
            return res.end(data);
        }
        return json(res, 404, { error: 'not found' });
    } catch (error) {
        console.error('✖', error);
        return json(res, 500, { error: String(error?.message ?? error) });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`▸ Sauti running at http://localhost:${PORT} (offline-capable)`);
});
