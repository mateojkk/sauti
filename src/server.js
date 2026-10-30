/**
 * Sauti local server. Serves the UI and the pipeline API on localhost only.
 * No external assets, no API keys, no outbound calls: it runs with the
 * network fully disconnected (judging requirement).
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { processAudio, deleteNote, updateNote, rebuildFromTranscript, noteToMarkdown } from './pipeline.js';
import { buildIndex, search } from './search.js';
import { listNotes, getNote } from './db.js';

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

/** One model job at a time on an 8 GB laptop. Later jobs wait instead of 503. */
let queue = Promise.resolve();
function enqueue(fn) {
    const job = queue.then(fn, fn);
    queue = job.then(() => undefined, () => undefined);
    return job;
}

const json = (res, code, obj) => {
    res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
        if (url.pathname === '/api/notes' && req.method === 'GET') {
            const notes = listNotes().map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                summary: n.summary,
                actions: n.actions,
                createdAt: n.createdAt,
                language: n.language,
                durationSec: n.durationSec ?? null,
            }));
            return json(res, 200, { notes });
        }

        if (/^\/api\/note\/[^/]+\/rebuild$/.test(url.pathname) && req.method === 'POST') {
            const id = url.pathname.split('/')[3];
            const note = await enqueue(() => rebuildFromTranscript(id));
            if (!note) return json(res, 404, { error: 'note not found' });
            enqueue(() => buildIndex()).catch((e) => console.error('reindex failed:', e.message));
            return json(res, 200, { note });
        }

        if (url.pathname.startsWith('/api/note/') && req.method === 'PUT') {
            const id = url.pathname.split('/').pop();
            const raw = await new Promise((resolve, reject) => {
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
            });
            const note = await updateNote(id, raw);
            if (!note) return json(res, 404, { error: 'note not found' });
            enqueue(() => buildIndex()).catch((e) => console.error('reindex failed:', e.message));
            return json(res, 200, { note });
        }

        if (url.pathname.startsWith('/api/note/') && req.method === 'DELETE') {
            const id = url.pathname.split('/').pop();
            const removed = await deleteNote(id);
            return json(res, removed ? 200 : 404, { removed });
        }

        if (url.pathname.startsWith('/api/note/') && url.pathname.endsWith('/md') && req.method === 'GET') {
            const id = url.pathname.split('/')[3];
            const note = getNote(id);
            if (!note) return json(res, 404, { error: 'no such note' });
            const md = noteToMarkdown(note);
            const body = Buffer.from(md, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Length': body.length });
            return res.end(body);
        }

        if (url.pathname.startsWith('/api/note/') && req.method === 'GET') {
            const id = url.pathname.split('/').pop();
            const note = getNote(id);
            if (!note) return json(res, 404, { error: 'note not found' });
            return json(res, 200, { note });
        }

        if (url.pathname === '/api/process' && req.method === 'POST') {
            const lang = url.searchParams.get('lang') ?? 'en';
            const name = url.searchParams.get('name') ?? 'upload.wav';
            const dur = Number(url.searchParams.get('dur')) || null; // recording length in seconds, when known
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            if (chunks.length === 0) return json(res, 400, { error: 'empty body' });
            const audio = Buffer.concat(chunks);
            await mkdir(RECORDINGS, { recursive: true });
            const file = join(RECORDINGS, `${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`);
            await writeFile(file, audio);
            const durationSec = dur ?? (file.endsWith('.wav') ? (audio.length - 44) / 32000 : null);
            const note = await enqueue(() => processAudio(file, { language: lang, durationSec }));
            enqueue(() => buildIndex()).catch((e) => console.error('reindex failed:', e.message));
            return json(res, 200, { note });
        }

        // Serve a note's original recording for playback in the modal.
        if (url.pathname.startsWith('/api/audio/') && req.method === 'GET') {
            const id = url.pathname.split('/').pop();
            if (!/^[0-9T-]+Z$/.test(id)) return json(res, 400, { error: 'bad id' });
            const note = getNote(id);
            if (!note) return json(res, 404, { error: 'note not found' });
            const file = note.audioFile ?? '';
            if (!file.startsWith(RECORDINGS) && !file.startsWith('test-audio/')) return json(res, 403, { error: 'not a Sauti recording' });
            if (!existsSync(file)) return json(res, 404, { error: 'audio file missing' });
            const ext = extname(file).toLowerCase();
            const type = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm' }[ext] ?? 'audio/wav';
            const data = await readFile(file);
            res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
            return res.end(data);
        }

        if (url.pathname === '/api/search' && req.method === 'POST') {
            const { query, k } = await new Promise((resolve, reject) => {
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
            });
            const results = await enqueue(() => search(String(query ?? ''), { k: Number(k) || 5 }));
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

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(PORT, '127.0.0.1', () => {
    console.log(`▸ Sauti running at http://localhost:${PORT} (offline-capable)`);
});
