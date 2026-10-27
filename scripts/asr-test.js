// ASR validation: Whisper (qvac-fabric-speech.cpp) on a 16 kHz mono WAV.
// Usage: node scripts/asr-test.js test-audio/sample-en-16k.wav en
import { loadModel, unloadModel, transcribe, WHISPER_BASE_Q8_0 } from '@qvac/sdk';
import { writeFileSync } from 'node:fs';

const [audioPath = 'test-audio/sample-en-16k.wav', language = 'en'] = process.argv.slice(2);

try {
    const t0 = Date.now();
    const modelId = await loadModel({
        modelSrc: WHISPER_BASE_Q8_0,
        modelType: 'whisper',
        modelConfig: {
            language,
            translate: false,
            strategy: 'greedy',
            temperature: 0.0,
            n_threads: 4,
        },
        onProgress: (p) => {
            if (p.percentage >= 100) process.stderr.write('▸ Whisper model cached\n');
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
