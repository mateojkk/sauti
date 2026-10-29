// ASR validation: any QVAS ASR model on an audio file.
// Usage: ASR_MODEL=WHISPER_SMALL_Q8_0 node scripts/asr-test.js <audio> [lang]
import { writeFileSync } from 'node:fs';
import { loadModel, unloadModel, transcribe } from '@qvac/sdk';

const sdk = await import('@qvac/sdk');
const constantName = process.env.ASR_MODEL ?? 'WHISPER_SMALL_Q8_0';
const modelSrc = sdk[constantName];
if (!modelSrc) {
    console.error(`✖ Unknown ASR model constant: ${constantName}`);
    process.exit(1);
}

const [audioPath = 'test-audio/sample-en-16k.wav', language = 'en'] = process.argv.slice(2);

try {
    const t0 = Date.now();
    const isWhisper = constantName.startsWith('WHISPER');
    const modelId = await loadModel({
        modelSrc,
        modelType: isWhisper ? 'whisper' : 'parakeet-transcription',
        ...(isWhisper ? {
            modelConfig: {
                language,
                translate: false,
                strategy: 'greedy',
                temperature: 0.0,
                n_threads: 4,
            },
        } : {}),
        onProgress: (p) => {
            if (p.percentage >= 100) process.stderr.write(`▸ ${constantName} cached\n`);
        },
    });
    const loadMs = Date.now() - t0;
    console.log(`▸ Whisper loaded in ${(loadMs / 1000).toFixed(1)}s (includes first-run download)`);

    const t1 = Date.now();
    const text = await transcribe({ modelId, audioChunk: audioPath });
    const inferMs = Date.now() - t1;

    console.log('▸ Transcript:');
    console.log(text);
    const outPath = audioPath.replace(/\.wav$/, '.transcript.txt');
    writeFileSync(outPath, text.trim() + '\n');
    console.log(`▸ Saved transcript to ${outPath}`);
    console.log(`▸ Transcribe: ${(inferMs / 1000).toFixed(1)}s for the clip`);
    await unloadModel({ modelId });
} catch (error) {
    console.error('✖', error);
    process.exit(1);
}
