#!/usr/bin/env node
// Sauti CLI.
//   node cli.js process <audio.wav> [--lang en|sw]   transcribe + summarize + save a note
//   node cli.js list                                 list saved notes
//   node cli.js show <id>                            print one note's markdown
import { processAudio, deleteNote } from './src/pipeline.js';
import { buildIndex, search } from './src/search.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [cmd, arg, ...rest] = process.argv.slice(2);

function die(msg) {
    console.error(`✖ ${msg}`);
    console.error('Usage: node cli.js process <audio.wav> [--lang en|sw] | list | show <id> | reindex | search "<query>"');
    process.exit(1);
}

if (cmd === 'process') {
    if (!arg) die('missing audio file');
    const langIdx = rest.indexOf('--lang');
    const language = langIdx !== -1 ? rest[langIdx + 1] : 'en';
    console.log(`▸ Sauti: processing ${arg} (language=${language})`);
    const note = await processAudio(arg, { language });
    console.log(`\n✅ Note saved: notes/${note.id}.md`);
    console.log(`Title: ${note.title}`);
    console.log(`Summary: ${note.summary}`);
    console.log('Actions:');
    for (const a of note.actions) console.log(`  - ${a}`);
    console.log(`\nTiming: asr-load ${(note.timing.loadAsrMs / 1000).toFixed(1)}s · transcribe ${(note.timing.transcribeMs / 1000).toFixed(1)}s · llm-load ${(note.timing.loadLlmMs / 1000).toFixed(1)}s · llm ${(note.timing.llmMs / 1000).toFixed(1)}s @ ${note.timing.tokensPerSec} tok/s`);
} else if (cmd === 'list') {
    const files = (await readdir('notes').catch(() => [])).filter((f) => f.endsWith('.json') && f !== 'vectors.json').sort();
    if (files.length === 0) {
        console.log('(no notes yet)');
    } else {
        for (const f of files) {
            const n = JSON.parse(await readFile(join('notes', f), 'utf8'));
            console.log(`${n.id}  [${n.language}]  ${n.title}\n    ${n.summary.slice(0, 100)}`);
        }
    }
} else if (cmd === 'show') {
    if (!arg) die('missing note id');
    console.log(await readFile(join('notes', `${arg}.md`), 'utf8'));
} else if (cmd === 'delete') {
    if (!arg) die('missing note id');
    const removed = await deleteNote(arg);
    console.log(removed ? `🗑 deleted ${arg}` : `✖ no such note: ${arg}`);
} else if (cmd === 'reindex') {
    const all = [arg, ...rest].filter(Boolean);
    const { indexed, total } = await buildIndex({ force: all.includes('--force') });
    console.log(`✅ Index: ${indexed} newly embedded, ${total} total in vectors.json`);
} else if (cmd === 'search') {
    const all = [arg, ...rest].filter(Boolean);
    const query = all.find((a) => !a.startsWith('--'));
    if (!query) die('missing query');
    const kIdx = all.indexOf('--k');
    const k = kIdx !== -1 ? Number(all[kIdx + 1]) : 5;
    console.log(`▸ Searching: "${query}"`);
    const results = await search(query, { k });
    if (results.length === 0) {
        console.log('(empty index — run: node cli.js reindex)');
    } else {
        for (const r of results) {
            console.log(`${(r.score + 1).toFixed(4)}  ${r.id}  ${r.title ?? '(missing note file)'}`);
            console.log(`    ${String(r.summary ?? '').slice(0, 110)}`);
        }
    }
} else {
    die(`unknown command: ${cmd}`);
}
