// LLM benchmark: same notes prompt across candidate models, tok/s + quality.
// Usage: QWEN_MODEL=QWEN3_600M_INST_Q4 node scripts/llm-bench.js
import { loadModel, completion, unloadModel } from '@qvac/sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const constantName = process.env.QWEN_MODEL ?? 'QWEN3_600M_INST_Q4';
const sdk = await import('@qvac/sdk');
const modelSrc = sdk[constantName];
if (!modelSrc) {
    console.error(`✖ Unknown model constant: ${constantName}`);
    process.exit(1);
}

const transcript = readFileSync('test-audio/sample-en-16k.transcript.txt', 'utf8').trim();

const SYSTEM = `You are a meeting-notes assistant. From the transcript you are given, produce:
1. A short title (max 8 words).
2. A 2-sentence summary.
3. Action items: one line per task someone must do, in the form "- person: task". Include every task mentioned. If there are truly no tasks, write "- none".
Answer in plain text (no markdown bold) with exactly these headings: TITLE, SUMMARY, ACTIONS.`;

const history = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Transcript:\n${transcript}\n\nNotes:` },
];

try {
    const t0 = Date.now();
    const modelId = await loadModel({
        modelSrc,
        onProgress: (p) => {
            if (p.percentage >= 100) process.stderr.write(`▸ ${constantName} cached\n`);
        },
    });
    const loadMs = Date.now() - t0;

    const t1 = Date.now();
    const result = completion({ modelId, history, stream: true });
    let out = '';
    let ntok = 0;
    for await (const token of result.tokenStream) {
        out += token;
        ntok++;
    }
    const genMs = Date.now() - t1;

    // Strip Qwen3-style thinking block when present; it must not reach users.
    out = out.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

    const report = {
        model: constantName,
        loadMs,
        genMs,
        tokens: ntok,
        tokensPerSec: +(ntok / (genMs / 1000)).toFixed(1),
        output: out.trim(),
    };
    writeFileSync(`bench-${constantName}.json`, JSON.stringify(report, null, 2));
    console.log(`\n▸ ${constantName}: load ${(loadMs / 1000).toFixed(1)}s, ${report.tokensPerSec} tok/s, ${ntok} tokens`);
    console.log(out.trim());
    await unloadModel({ modelId });
} catch (error) {
    console.error('✖', error);
    process.exit(1);
}
