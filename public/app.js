const $ = (id) => document.getElementById(id);

function fmtDur(sec) {
    if (sec == null) return '';
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function relDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (d.toDateString() === now.toDateString()) return `Today · ${t}`;
    if (d.toDateString() === yest.toDateString()) return `Yesterday · ${t}`;
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${t}`;
}

function dayLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

let allNotes = [];
let activeId = null;

function noteMatches(n, filter) {
    if (!filter) return true;
    const hay = `${n.title} ${n.summary}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
}

function renderList() {
    const filter = $('q').value.trim();
    const notes = allNotes.filter((n) => noteMatches(n, filter));
    $('noteCount').textContent = String(allNotes.length);
    const list = $('notesList');
    list.replaceChildren();
    if (!notes.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = allNotes.length ? 'No titles match that filter.' : 'Nothing here yet. Press Record.';
        list.appendChild(empty);
        return;
    }
    let lastDay = '';
    for (const n of notes) {
        const label = dayLabel(n.createdAt);
        if (label !== lastDay) {
            lastDay = label;
            const h = document.createElement('div');
            h.className = 'day';
            h.textContent = label;
            list.appendChild(h);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `note${n.id === activeId ? ' active' : ''}`;
        btn.innerHTML = '<div class="top"><div class="t"></div><div class="dur"></div></div><div class="s"></div><div class="meta"></div>';
        btn.querySelector('.t').textContent = n.title || '(untitled)';
        btn.querySelector('.dur').textContent = n.durationSec != null ? fmtDur(n.durationSec) : '';
        btn.querySelector('.s').textContent = (n.body || n.summary || '').split('\n').find(Boolean) || '';
        btn.querySelector('.meta').textContent = relDate(n.createdAt);
        btn.onclick = () => openNote(n.id);
        list.appendChild(btn);
    }
}

function renderChips() {
    const box = $('chips');
    box.replaceChildren();
    const seen = new Set();
    for (const n of allNotes) {
        const label = (n.title || '').trim();
        if (!label || seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.textContent = label;
        btn.onclick = () => {
            $('q').value = label;
            $('searchForm').requestSubmit();
        };
        box.appendChild(btn);
        if (seen.size >= 5) break;
    }
    box.hidden = seen.size === 0;
}

async function loadNotes() {
    const { notes } = await (await fetch('/api/notes', { cache: 'no-store' })).json();
    allNotes = notes;
    renderChips();
    renderList();
}

let openDraft = null;

function showIdle() {
    activeId = null;
    openDraft = null;
    $('detail').classList.remove('editing');
    $('detail').hidden = true;
    $('idle').hidden = false;
    $('dAudio').pause();
    $('playBtn').textContent = '▶';
    renderList();
}

function setEditing(on) {
    $('detail').classList.toggle('editing', on);
    $('dEdit').hidden = on;
    $('dDelete').hidden = on;
    $('dCancel').hidden = !on;
    $('dSave').hidden = !on;
    $('saveState').textContent = '';
}

function fillView(note) {
    $('dTitle').textContent = note.title || '';
    $('dBody').textContent = note.body || '';
    const gist = note.summary && note.summary !== note.body ? note.summary : '';
    $('dSummary').textContent = gist;
    $('sumSection').hidden = !gist;
}

function startEdit() {
    if (!openDraft) return;
    $('eTranscript').value = openDraft.transcript || '';
    setEditing(true);
    $('eTranscript').focus();
}

function cancelEdit() {
    setEditing(false);
    if (openDraft) fillView(openDraft);
}

async function saveEdits() {
    if (!activeId) return;
    const transcript = $('eTranscript').value;
    $('saveState').textContent = 'Saving…';
    const res = await fetch(`/api/note/${activeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ transcript }),
    });
    if (!res.ok) {
        $('saveState').textContent = 'Could not save';
        return;
    }
    const { note } = await res.json();
    openDraft = note;
    setEditing(false);
    fillView(note);
    $('dTranscript').textContent = note.transcript || '';
    $('dWhen').textContent = `${relDate(note.createdAt)} · ${note.language}${fmtDur(note.durationSec) ? ` · ${fmtDur(note.durationSec)}` : ''}`;
    $('saveState').textContent = 'Saved. Rewrite notes to refresh the structure.';
    await loadNotes();
}

async function openNote(id) {
    const { note } = await (await fetch(`/api/note/${id}`, { cache: 'no-store' })).json();
    if (!note) return;
    activeId = id;
    openDraft = note;
    $('idle').hidden = true;
    $('detail').hidden = false;
    setEditing(false);
    $('dWhen').textContent = `${relDate(note.createdAt)} · ${note.language}${fmtDur(note.durationSec) ? ` · ${fmtDur(note.durationSec)}` : ''}`;
    const au = $('dAudio');
    au.pause();
    au.src = `/api/audio/${note.id}`;
    au.load();
    $('playBtn').textContent = '▶';
    $('playCur').textContent = '0:00';
    $('playSeek').value = 0;
    fillView(note);
    $('dTranscript').textContent = note.transcript || '';
    renderList();
}

const audio = $('dAudio');
$('playBtn').onclick = () => {
    if (audio.paused) audio.play();
    else audio.pause();
};
audio.addEventListener('play', () => { $('playBtn').textContent = '❚❚'; });
audio.addEventListener('pause', () => { $('playBtn').textContent = '▶'; });
audio.addEventListener('loadedmetadata', () => {
    $('playSeek').max = audio.duration || 0;
    $('playDur').textContent = fmtDur(audio.duration);
});
audio.addEventListener('timeupdate', () => {
    if (!$('playSeek').matches(':active')) $('playSeek').value = audio.currentTime;
    $('playCur').textContent = fmtDur(audio.currentTime);
});
$('playSeek').addEventListener('input', () => {
    audio.currentTime = Number($('playSeek').value);
});

$('dCopy').onclick = async () => {
    if (!openDraft) return;
    const n = openDraft;
    const parts = [n.title, '', n.body];
    if (n.summary) parts.push('', 'Summary', n.summary);
    if ((n.actions || []).length) parts.push('', 'Tasks', ...n.actions.map((a) => `- ${a}`));
    try {
        await navigator.clipboard.writeText(parts.join('\n').trim());
        $('saveState').textContent = 'Copied';
        setTimeout(() => { if ($('saveState').textContent === 'Copied') $('saveState').textContent = ''; }, 1600);
    } catch {
        alert('Could not copy.');
    }
};
$('dRebuild').onclick = async () => {
    if (!activeId) return;
    $('dRebuild').disabled = true;
    stage('Rewriting notes from the transcript…', 60);
    try {
        const res = await fetch(`/api/note/${activeId}/rebuild`, { method: 'POST', cache: 'no-store' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'rebuild failed');
        const { note } = await res.json();
        openDraft = note;
        fillView(note);
        $('dTranscript').textContent = note.transcript || '';
        $('dWhen').textContent = `${relDate(note.createdAt)} · ${note.language}${fmtDur(note.durationSec) ? ` · ${fmtDur(note.durationSec)}` : ''}`;
        await loadNotes();
    } catch (err) {
        alert(`✖ ${err.message}`);
    } finally {
        stageDone();
        $('dRebuild').disabled = false;
    }
};
$('dEdit').onclick = startEdit;
$('dCancel').onclick = cancelEdit;
$('dSave').onclick = saveEdits;
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && $('detail').classList.contains('editing')) {
        e.preventDefault();
        saveEdits();
    }
});

$('back').onclick = showIdle;
$('dDelete').onclick = async () => {
    if (!activeId) return;
    if (!confirm('Delete this note? This cannot be undone.')) return;
    const id = activeId;
    const res = await fetch(`/api/note/${id}`, { method: 'DELETE', cache: 'no-store' });
    if (!res.ok) {
        alert('✖ Could not delete that note.');
        return;
    }
    allNotes = allNotes.filter((n) => n.id !== id);
    for (const hit of [...$('results').querySelectorAll('.hit')]) {
        if (hit.dataset.id === id) hit.remove();
    }
    if (!$('results').querySelector('.hit')) $('results').hidden = true;
    showIdle();
    await loadNotes();
};

function stage(name, pct) {
    $('progress').hidden = false;
    $('stageLabel').textContent = name;
    $('barFill').style.width = `${pct ?? 85}%`;
}
function stageDone() {
    $('progress').hidden = true;
    $('barFill').style.width = '0%';
}

async function submitAudio(blob, name, durationSec = null) {
    $('rec').disabled = true;
    $('file').disabled = true;
    stage('Sending audio…', 15);
    try {
        stage('Transcribing on-device…', 45);
        const res = await fetch(`/api/process?lang=${$('lang').value}&name=${encodeURIComponent(name)}${durationSec ? `&dur=${Math.round(durationSec)}` : ''}`, {
            method: 'POST',
            body: blob,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error ?? 'processing failed');
        }
        stage('Writing the note…', 90);
        const { note } = await res.json();
        stageDone();
        await loadNotes();
        await openNote(note.id);
    } catch (e) {
        stageDone();
        alert(`✖ ${e.message}`);
    } finally {
        $('rec').disabled = false;
        $('file').disabled = false;
    }
}

let waveRaf = 0;
let mediaStream = null;
let audioCtx = null;
let recSource = null;
let captureNode = null;
let chunks = [];
let lastFrame = new Float32Array(128);
let t0 = 0;
let timerId = 0;
let recRate = 16000;
let capturing = false;
let recPaused = false;
let elapsedMs = 0;
let runningSince = 0;

function recSeconds() {
    const live = recPaused ? 0 : Date.now() - runningSince;
    return Math.floor((elapsedMs + live) / 1000);
}

function paintRecTime() {
    const s = recSeconds();
    $('recLabel').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function startWaveform() {
    const canvas = $('wave');
    const ctx2d = canvas.getContext('2d');
    canvas.classList.add('live');
    const draw = () => {
        waveRaf = requestAnimationFrame(draw);
        const data = lastFrame;
        const W = canvas.width, H = canvas.height;
        ctx2d.clearRect(0, 0, W, H);
        const bars = 36;
        const step = Math.max(1, Math.floor(data.length / bars));
        const bw = W / bars;
        for (let i = 0; i < bars; i++) {
            let v = 0;
            for (let j = 0; j < step; j++) v = Math.max(v, Math.abs(data[i * step + j] ?? 0));
            const h = Math.max(3, v * (H - 8));
            ctx2d.fillStyle = '#ff3b33';
            ctx2d.fillRect(i * bw + 2, (H - h) / 2, bw - 3, h);
        }
    };
    draw();
}

function stopWaveform() {
    cancelAnimationFrame(waveRaf);
    const canvas = $('wave');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove('live');
}

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

function setRecordingUi(on) {
    $('rec').classList.toggle('recording', on);
    $('rec').classList.remove('paused');
    $('recLabel').textContent = on ? '00:00' : 'Record';
    $('rec').title = on ? 'Done (save notes)' : 'Record (R)';
    $('recPause').hidden = !on;
    $('recPause').textContent = 'Pause';
    $('recCancel').hidden = !on;
    $('file').disabled = on;
    document.querySelector('.upload').hidden = on;
    $('langBtn').disabled = on;
    if (on) closeMenus();
    recPaused = false;
    capturing = on;
}

async function endCapture() {
    stopWaveform();
    recSource?.disconnect();
    captureNode?.disconnect();
    const rate = recRate;
    const captured = chunks;
    chunks = [];
    try { await audioCtx.close(); } catch {}
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    if (!recPaused) elapsedMs += Date.now() - runningSince;
    clearInterval(timerId);
    const durationSec = elapsedMs / 1000;
    setRecordingUi(false);
    return { rate, captured, durationSec };
}

$('recCancel').onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!$('rec').classList.contains('recording')) return;
    await endCapture();
};

$('recPause').onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!$('rec').classList.contains('recording')) return;
    if (recPaused) {
        recPaused = false;
        capturing = true;
        runningSince = Date.now();
        $('recPause').textContent = 'Pause';
        $('rec').classList.remove('paused');
        startWaveform();
        return;
    }
    elapsedMs += Date.now() - runningSince;
    recPaused = true;
    capturing = false;
    $('recPause').textContent = 'Resume';
    $('rec').classList.add('paused');
    stopWaveform();
};

$('rec').onclick = async () => {
    if ($('rec').classList.contains('recording')) {
        const { rate, captured, durationSec } = await endCapture();
        const total = captured.reduce((n, c) => n + c.length, 0);
        const merged = new Float32Array(total);
        let off = 0;
        for (const c of captured) { merged.set(c, off); off += c.length; }
        const wav16 = resampleTo16k(merged, rate);
        if (wav16.length < 8000) return alert('Recording too short.');
        const blob = new Blob([encodeWav(wav16, 16000)], { type: 'audio/wav' });
        await submitAudio(blob, 'recording.wav', durationSec);
        return;
    }
    showIdle();
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
            audioCtx = new AudioContext({ sampleRate: 16000 });
        } catch {
            audioCtx = new AudioContext();
        }
        recRate = audioCtx.sampleRate;
        await audioCtx.audioWorklet.addModule('/worklet-recorder.js');
        recSource = audioCtx.createMediaStreamSource(mediaStream);
        captureNode = new AudioWorkletNode(audioCtx, 'capture');
        chunks = [];
        captureNode.port.onmessage = (e) => {
            if (!capturing) return;
            const buf = e.data;
            chunks.push(buf);
            lastFrame = buf;
        };
        recSource.connect(captureNode);
        elapsedMs = 0;
        runningSince = Date.now();
        t0 = Date.now();
        timerId = setInterval(paintRecTime, 250);
        setRecordingUi(true);
        startWaveform();
    } catch (err) {
        mediaStream?.getTracks().forEach((t) => t.stop());
        setRecordingUi(false);
        alert(`✖ ${err.message}`);
    }
};

$('file').onchange = async () => {
    const f = $('file').files[0];
    if (!f) return;
    await submitAudio(f, f.name);
    $('file').value = '';
};

$('q').addEventListener('input', () => {
    if (!$('q').value.trim()) $('results').hidden = true;
    renderList();
});

$('searchForm').onsubmit = async (e) => {
    e.preventDefault();
    const query = $('q').value.trim();
    if (!query) return;
    const box = $('results');
    box.hidden = false;
    box.innerHTML = '<div class="empty">searching on-device…</div>';
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'search failed');
        const { results } = await res.json();
        box.replaceChildren();
        if (!results.length) {
            box.innerHTML = '<div class="empty">no index yet. Process a note first.</div>';
            return;
        }
        for (const r of results) {
            const el = document.createElement('div');
            el.className = 'hit';
            if (r.id) el.dataset.id = r.id;
            el.innerHTML = '<div class="score"></div><div class="t"></div><div class="s"></div>';
            el.querySelector('.score').textContent = `match ${(r.score + 1).toFixed(3)}`;
            el.querySelector('.t').textContent = r.title ?? r.id;
            el.querySelector('.s').textContent = (r.summary ?? '').slice(0, 120);
            if (r.id) el.onclick = () => openNote(r.id);
            box.appendChild(el);
        }
    } catch (err) {
        box.innerHTML = `<div class="empty">✖ ${err.message}</div>`;
    }
};

function closeMenus(except) {
    for (const menu of document.querySelectorAll('.menu.open')) {
        if (menu === except) continue;
        menu.classList.remove('open');
        const list = menu.querySelector('.menu-list');
        const btn = menu.querySelector('.menu-btn');
        if (list) list.hidden = true;
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }
}

function bindMenu(menu, { labels = {}, hiddenId } = {}) {
    const btn = menu.querySelector('.menu-btn');
    const list = menu.querySelector('.menu-list');
    const hidden = hiddenId ? $(hiddenId) : menu.querySelector('input[type="hidden"]');
    const label = btn.querySelector('span:not(.chev)');
    const options = () => [...list.querySelectorAll('[role="option"]')];

    function setValue(value, { close = true } = {}) {
        if (hidden) hidden.value = value;
        if (label) label.textContent = labels[value] ?? value.toUpperCase();
        for (const opt of options()) {
            opt.setAttribute('aria-selected', opt.dataset.value === value ? 'true' : 'false');
        }
        if (close) closeMenus();
    }

    function open() {
        const wasOpen = menu.classList.contains('open');
        closeMenus();
        if (wasOpen) return;
        menu.classList.add('open');
        list.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        options().find((o) => o.getAttribute('aria-selected') === 'true')?.focus();
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        open();
    });
    for (const opt of options()) {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            setValue(opt.dataset.value);
            btn.focus();
        });
    }
    list.addEventListener('keydown', (e) => {
        const items = options();
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = e.key === 'ArrowDown'
                ? items[(i + 1) % items.length]
                : items[(i - 1 + items.length) % items.length];
            next.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (i >= 0) setValue(items[i].dataset.value);
        } else if (e.key === 'Home') {
            e.preventDefault();
            items[0]?.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1]?.focus();
        }
    });
    setValue(hidden?.value || options()[0]?.dataset.value, { close: false });
}

bindMenu($('langMenu'), { labels: { en: 'EN', sw: 'SW' }, hiddenId: 'lang' });
document.addEventListener('click', () => closeMenus());

const hashNote = location.hash.match(/^#note=([\w-]+)$/);
if (hashNote) openNote(hashNote[1]);

loadNotes();
document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
        || document.activeElement?.isContentEditable;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (document.querySelector('.menu.open')) {
            closeMenus();
            return;
        }
        if ($('rec').classList.contains('recording')) {
            $('recCancel').click();
            return;
        }
        if ($('detail').classList.contains('editing')) {
            cancelEdit();
            return;
        }
        showIdle();
        return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('rec').classList.contains('recording') && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        $('recPause').click();
        return;
    }
    if (e.key === '/') {
        e.preventDefault();
        $('q').focus();
    } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        $('rec').click();
    }
});
