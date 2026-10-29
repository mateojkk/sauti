/** Copies mic frames off the render thread. Input buffers are reused; always slice. */
class CaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const channel = inputs[0]?.[0];
        if (channel && channel.length) this.port.postMessage(channel.slice());
        return true;
    }
}
registerProcessor('capture', CaptureProcessor);
