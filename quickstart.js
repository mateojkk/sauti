// Day-1 gate: prove @qvac/sdk loads a model and runs on this machine.
// Adapted from https://docs.qvac.tether.io/sdk/js-ts-sdk/#quickstart
// The SDK prints no logs by default; run with QVAC_CONFIG_PATH=./qvac.config.json
import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from '@qvac/sdk';

try {
    const modelId = await loadModel({
        modelSrc: LLAMA_3_2_1B_INST_Q4_0,
        onProgress: (p) => {
            const mb = (n) => (n / 1e6).toFixed(1);
            const line = `▸ Downloading ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)`;
            process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`);
            if (p.percentage >= 100) process.stderr.write('\n');
        },
    });
    const history = [
        { role: 'user', content: 'Reply with exactly one word: offline.' },
    ];
    const result = completion({ modelId, history, stream: true });
    for await (const token of result.tokenStream) {
        process.stdout.write(token);
    }
    process.stdout.write('\n');
    await unloadModel({ modelId });
    console.log('✔ QVAC quickstart OK');
} catch (error) {
    console.error('✖', error);
    process.exit(1);
}
