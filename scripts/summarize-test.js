// Summarizer validation: local LLM turns a transcript into structured notes.
// Usage: node scripts/summarize-test.js [transcript-file]
import { loadModel, completion, unloadModel, LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk';
import { readFileSync } from 'node:fs';

const transcriptPath = process.argv[2] ?? 'test-audio/sample-en-16k.transcript.txt';
const transcript = readFileSync(transcriptPath, 'utf8').trim();

const SYSTEM = `You are a meeting-notes assistant. From the transcript you are given, produce:
1. A short title (max 8 words).
2. A 2-sentence summary.
3. Action items as a list of "person: task" lines, or "none".
Answer in plain text with exactly these headings: TITLE, SUMMARY, ACTIONS.`;

const history = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Transcript:\n${transcript}\n\nNotes:` },
];

try {
    const t0 = Date.now();
    const modelId = await loadModel({
        modelSrc: LLAMA_3_2_1B_INST_Q4_0,
        onProgress: (p) => {
            if (p.percentage >= 100) process.stderr.write('▸ LLM cached\n');
        },
    });
    const loadMs = Date.now() - t0;
    console.log(`▸ LLM loaded in ${(loadMs / 1000).toFixed(1)}s (includes first-run download)`);

    const t1 = Date.now();
    const result = completion({ modelId, history, stream: true });
    let out = '';
    for await (const token of result.tokenStream) {
        out += token;
        process.stdout.write(token);
    }
    const genMs = Date.now() - t1;
    const tokens = out.split(/\s+/).length;
    console.log(`\n▸ ${(tokens / (genMs / 1000)).toFixed(1)} tokens/s over ${(genMs / 1000).toFixed(1)}s`);
    await unloadModel({ modelId });
} catch (error) {
    console.error('✖', error);
    process.exit(1);
}
