/**
 * Sauti's local storage: a single SQLite file (sauti.db) holding every note
 * and the semantic-search vectors. Zero extra packages (Node's built-in
 * node:sqlite), fully offline, survives crashes via WAL mode.
 *
 * First import creates the file + schema. If the DB is empty, any leftover
 * notes/*.json (and notes/vectors.json) from older installs are imported.
 * A fresh clone with no notes/ folder just gets an empty, ready database.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DB_FILE = process.env.SAUTI_DB ?? 'sauti.db';
export const NOTES_DIR = 'notes';

mkdirSync(NOTES_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    createdAt   INTEGER NOT NULL,
    audioFile   TEXT,
    language    TEXT,
    durationSec REAL,
    title       TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '',
    actions     TEXT NOT NULL DEFAULT '[]',
    transcript  TEXT NOT NULL DEFAULT '',
    models      TEXT NOT NULL DEFAULT '{}',
    timing      TEXT NOT NULL DEFAULT '{}',
    body        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vectors (
    id     TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    vector BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`);
try { db.exec("ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT ''"); } catch { /* already present */ }

function rowToNote(row) {
    return {
        id: row.id,
        createdAt: Number(row.createdAt),
        audioFile: row.audioFile,
        language: row.language,
        durationSec: row.durationSec == null ? null : Number(row.durationSec),
        title: row.title,
        body: row.body ?? '',
        summary: row.summary,
        actions: JSON.parse(row.actions || '[]'),
        transcript: row.transcript,
        models: JSON.parse(row.models || '{}'),
        timing: JSON.parse(row.timing || '{}'),
    };
}

export function insertNote(note) {
    db.prepare(`
        INSERT OR REPLACE INTO notes
            (id, createdAt, audioFile, language, durationSec, title, summary, actions, transcript, models, timing, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        note.id,
        note.createdAt,
        note.audioFile ?? null,
        note.language ?? null,
        note.durationSec ?? null,
        note.title ?? '',
        note.summary ?? '',
        JSON.stringify(note.actions ?? []),
        note.transcript ?? '',
        JSON.stringify(note.models ?? {}),
        JSON.stringify(note.timing ?? {}),
        note.body ?? '',
    );
    return note.id;
}

export function listNotes({ limit = null } = {}) {
    const sql = limit
        ? 'SELECT * FROM notes ORDER BY createdAt DESC LIMIT ?'
        : 'SELECT * FROM notes ORDER BY createdAt DESC';
    const stmt = db.prepare(sql);
    const rows = limit ? stmt.all(limit) : stmt.all();
    return rows.map(rowToNote);
}

export function getNote(id) {
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(String(id));
    return row ? rowToNote(row) : null;
}

export function countNotes() {
    return Number(db.prepare('SELECT COUNT(*) AS c FROM notes').get().c);
}

/** Delete a note and its vector (FK cascade). Returns true if it existed. */
export function deleteNote(id) {
    return db.prepare('DELETE FROM notes WHERE id = ?').run(String(id)).changes > 0;
}

export function loadVectors() {
    const out = {};
    for (const row of db.prepare('SELECT id, vector FROM vectors').all()) {
        out[row.id] = bytesToFloat32(row.vector);
    }
    return out;
}

function bytesToFloat32(buf) {
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return new Float32Array(copy);
}

export function toFloat32(vec) {
    if (vec instanceof Float32Array) return vec;
    return new Float32Array(vec);
}

export function saveVector(id, vec) {
    const f32 = toFloat32(vec);
    db.prepare('INSERT OR REPLACE INTO vectors (id, vector) VALUES (?, ?)')
        .run(String(id), Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength));
}

export function removeVector(id) {
    return db.prepare('DELETE FROM vectors WHERE id = ?').run(String(id)).changes > 0;
}

export function clearVectors() {
    db.exec('DELETE FROM vectors');
}

export function notesMissingVectors() {
    const rows = db.prepare('SELECT * FROM notes WHERE id NOT IN (SELECT id FROM vectors)').all();
    return rows.map(rowToNote);
}

function metaGet(key) {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
}

function metaSet(key, value) {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value));
}

/**
 * One-time import of leftover notes/*.json. After this runs, deletes stay
 * gone even if JSON files remain on disk or the notes table is emptied.
 */
export function migrateFromJsonFiles() {
    if (metaGet('json_migrated') === '1') return 0;
    if (countNotes() > 0) {
        metaSet('json_migrated', '1');
        return 0;
    }
    if (!existsSync(NOTES_DIR)) {
        metaSet('json_migrated', '1');
        return 0;
    }
    const files = readdirSync(NOTES_DIR).filter((f) => f.endsWith('.json') && f !== 'vectors.json');
    let imported = 0;
    for (const f of files) {
        try {
            const note = JSON.parse(readFileSync(join(NOTES_DIR, f), 'utf8'));
            if (note?.id && typeof note.title === 'string') {
                insertNote(note);
                imported++;
            }
        } catch { /* skip unreadable artifact */ }
    }
    try {
        const legacy = JSON.parse(readFileSync(join(NOTES_DIR, 'vectors.json'), 'utf8'));
        for (const [id, vec] of Object.entries(legacy)) {
            if (id && Array.isArray(vec) && getNote(id)) saveVector(id, vec);
        }
    } catch { /* no legacy index */ }
    metaSet('json_migrated', '1');
    return imported;
}

const imported = migrateFromJsonFiles();
if (imported > 0) {
    console.error(`▸ Imported ${imported} legacy note(s) into ${DB_FILE}`);
}
