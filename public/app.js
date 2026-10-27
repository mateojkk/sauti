/* Sauti client logic: record → WAV → /api/process; list; view; semantic search. */
const $ = (id) => document.getElementById(id);

// ---------- network badge ----------
const net = $('net');
function paintNet() {
    if (navigator.onLine) {
        net.textContent = 'internet ON — demo needs it OFF';
        net.className = 'net on';
    } else {
        net.textContent = 'offline ✔ still working';
        net.className = 'net off';
    }
}
window.addEventListener('online', paintNet);
window.addEventListener('offline', paintNet);
paintNet();

// ---------- notes list ----------
async function loadNotes() {
    const { notes } = await (await fetch('/api/notes')).json();
    const list = $('notesList');
    list.innerHTML = notes.length
        ? ''
        : '<div class="empty">no notes yet — record something</div>';
    for (const n of notes) {
        const el = document.createElement('div');
        el.className = 'note';
        el.innerHTML = `
            <button class="del" title="delete note">🗑</button>
            <div class="t"></div>
            <div class="s"></div>
            <div class="meta">${new Date(n.createdAt).toLocaleString()} <span class="badge">${n.language}</span> ${n.actions.length} action(s)</div>`;
        el.querySelector('.t').textContent = n.title || '(untitled)';
        el.querySelector('.s').textContent = n.summary || '';
        el.querySelector('.del').onclick = (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${n.title}"? This cannot be undone.`)) return;
            fetch(`/api/note/${n.id}`, { method: 'DELETE' }).then(loadNotes);
        };
        el.onclick = () => openNote(n.id);
        list.appendChild(el);
    }
}

async function openNote(id) {
    const { note } = await (await fetch(`/api/note/${id}`)).json();
    const body = $('modalBody');
    body.innerHTML = `
        <h3></h3>
        <div class="when">${new Date(note.createdAt).toLocaleString()} · ${note.language} · ${note.audioFile}</div>
        <section><h4>Summary</h4><p></p></section>
        <section><h4>Actions</h4><div class="actions"></div></section>
        <section><h4>Transcript</h4><div class="transcript"></div></section>
        <div class="models">asr: ${note.models.asr} · llm: ${note.models.llm} · transcribe ${(note.timing.transcribeMs / 1000).toFixed(1)}s · llm ${(note.timing.llmMs / 1000).toFixed(1)}s @ ${note.timing.tokensPerSec} tok/s</div>`;
    body.querySelector('h3').textContent = note.title;
    body.querySelector('p').textContent = note.summary;
    body.querySelector('.actions').innerHTML = note.actions.length
        ? note.actions.map((a) => `<div class="action"></div>`).join('')
        : '<div class="empty">none</div>';
    [...body.querySelectorAll('.action')].forEach((el, i) => { el.textContent = note.actions[i]; });
    body.querySelector('.transcript').textContent = note.transcript;
    $('modal').classList.remove('hidden');
}
$('closeModal').onclick = () => $('modal').classList.add('hidden');
$('modal').onclick = (e) => { if (e.target === $('modal')) $('modal').classList.add('hidden'); };

// ---------- processing UI ----------
function stage(name, pct) {
    $('progress').classList.remove('hidden');
    $('stage').textContent = name;
    if (pct != null) $('barFill').style.width = `${pct}%`;
    else $('barFill').style.width = '85%';
}
function stageDone() {
    $('progress').classList.add('hidden');
    $('barFill').style.width = '0%';
}

async function submitAudio(blob, name) {
    $('rec').disabled = true;
    $('file').disabled = true;
    stage('Uploading audio…', 15);
    try {
        stage('Transcribing on-device…', 45);
        const res = await fetch(`/api/process?lang=${$('lang').value}&name=${encodeURIComponent(name)}`, {
            method: 'POST',
            body: blob,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error ?? 'processing failed');
        }
        stage('Summarizing locally…', 90);
        const { note } = await res.json();
        stageDone();
        await loadNotes();
        openNote(note.id);
    } catch (e) {
        stageDone();
        alert(`✖ ${e.message}`);
    } finally {
        $('rec').disabled = false;
        $('file').disabled = false;
    }
}

// ---------- recording (browser captures PCM, encodes 16 kHz WAV) ----------
let mediaStream = null;
let audioCtx = null;
let processor = null;
let chunks = [];
let t0 = 0;
let timerId = 0;

function downsample48to16(f32) {
    const out = new Float32Array(Math.floor(f32.length / 3));
    for (let i = 0; i < out.length; i++) {
        out[i] = (f32[i * 3] + f32[i * 3 + 1] + f32[i * 3 + 2]) / 3;
    }
    return out;
}

function encodeWav(f32, sampleRate) {
    const buf = new ArrayBuffer(44 + f32.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF');
    v.setUint32(4, 36 + f32.length * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, f32.length * 2, true);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
}

$('rec').onclick = async () => {
    if ($('rec').classList.contains('recording')) {
        // stop
        processor.disconnect();
        audioCtx.close();
        mediaStream.getTracks().forEach((t) => t.stop());
        clearInterval(timerId);
        $('rec').classList.remove('recording');
        $('rec').textContent = '🎙 Record';
        $('recState').textContent = '';
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const merged = new Float32Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        chunks = [];
        const wav16 = downsample48to16(merged);
        if (wav16.length < 8000) return alert('Recording too short.');
        const blob = new Blob([encodeWav(wav16, 16000)], { type: 'audio/wav' });
        await submitAudio(blob, 'recording.wav');
        return;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(mediaStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    processor.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(processor);
    processor.connect(audioCtx.destination); // needed in some browsers to keep pumping
    t0 = Date.now();
    timerId = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        $('recState').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    $('rec').classList.add('recording');
    $('rec').textContent = '⏹ Stop';
};

// ---------- file upload ----------
$('file').onchange = async () => {
    const f = $('file').files[0];
    if (!f) return;
    await submitAudio(f, f.name);
    $('file').value = '';
};

// ---------- semantic search ----------
$('searchForm').onsubmit = async (e) => {
    e.preventDefault();
    const query = $('q').value.trim();
    if (!query) return;
    $('results').innerHTML = '<div class="empty">searching on-device…</div>';
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'search failed');
        const { results } = await res.json();
        if (results.length === 0) {
            $('results').innerHTML = '<div class="empty">no index yet — process a note first</div>';
            return;
        }
        $('results').innerHTML = '';
        for (const r of results) {
            const el = document.createElement('div');
            el.className = 'result';
            el.innerHTML = `
                <div class="score">match ${(r.score + 1).toFixed(3)}</div>
                <div class="t"></div>
                <div class="s"></div>`;
            el.querySelector('.t').textContent = r.title ?? r.id;
            el.querySelector('.s').textContent = (r.summary ?? '').slice(0, 120);
            if (r.id) el.onclick = () => openNote(r.id);
            $('results').appendChild(el);
        }
    } catch (err) {
        $('results').innerHTML = `<div class="empty">✖ ${err.message}</div>`;
    }
};

loadNotes();
