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

// ---------- live waveform ----------
let analyser = null;
let waveRaf = 0;

function startWaveform() {
    const canvas = $('wave');
    const ctx2d = canvas.getContext('2d');
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    processor.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    canvas.classList.add('live');
    const draw = () => {
        waveRaf = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);
        const W = canvas.width, H = canvas.height;
        ctx2d.clearRect(0, 0, W, H);
        const bars = 40, step = Math.floor(data.length / bars);
        const bw = W / bars;
        for (let i = 0; i < bars; i++) {
            let v = 0;
            for (let j = 0; j < step; j++) v = Math.max(v, data[i * step + j]);
            const h = Math.max(3, (v / 255) * (H - 6));
            const x = i * bw + 2;
            const g = ctx2d.createLinearGradient(0, H / 2 - h / 2, 0, H / 2 + h / 2);
            g.addColorStop(0, '#a78bfa');
            g.addColorStop(1, '#22d3ee');
            ctx2d.fillStyle = g;
            ctx2d.beginPath();
            if (ctx2d.roundRect) ctx2d.roundRect(x, (H - h) / 2, bw - 4, h, 3);
            else ctx2d.rect(x, (H - h) / 2, bw - 4, h);
            ctx2d.fill();
        }
    };
    draw();
}

function stopWaveform() {
    cancelAnimationFrame(waveRaf);
    analyser = null;
    const canvas = $('wave');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove('live');
}

// ---------- recording (browser captures PCM, encodes 16 kHz WAV) ----------
let mediaStream = null;
let audioCtx = null;
let processor = null;
let chunks = [];
let t0 = 0;
let timerId = 0;

/** Resample to 16 kHz by linear interpolation (correct for any input rate). */
function resampleTo16k(f32, fromRate) {
    if (fromRate === 16000) return f32;
    const outLen = Math.round((f32.length * 16000) / fromRate);
    const out = new Float32Array(outLen);
    const step = fromRate / 16000;
    for (let i = 0; i < outLen; i++) {
        const pos = i * step;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = f32[i0] ?? 0;
        const b = f32[i0 + 1] ?? a;
        out[i] = a + (b - a) * frac;
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
        stopWaveform();
        processor.disconnect();
        audioCtx.close();
        mediaStream.getTracks().forEach((t) => t.stop());
        clearInterval(timerId);
        $('rec').classList.remove('recording');
        $('rec').querySelector('span').textContent = 'Record';
        $('recState').textContent = '';
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const merged = new Float32Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        chunks = [];
        const wav16 = resampleTo16k(merged, audioCtx.sampleRate);
        if (wav16.length < 8000) return alert('Recording too short.');
        const blob = new Blob([encodeWav(wav16, 16000)], { type: 'audio/wav' });
        await submitAudio(blob, 'recording.wav');
        return;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Prefer a 16 kHz context (native resample by the browser, no aliasing).
    try {
        audioCtx = new AudioContext({ sampleRate: 16000 });
    } catch {
        audioCtx = new AudioContext();
    }
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
    $('rec').textContent = '';
    $('rec').querySelector('span').textContent = 'Stop';
    startWaveform();
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
    const btn = $('searchForm').querySelector('button');
    if (btn) btn.disabled = true;
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
    } finally {
        if (btn) btn.disabled = false;
    }
};

loadNotes();
