class PCMWorklet extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const { targetSampleRate = 16000, frameMs = 20 } = options?.processorOptions || {};
        this.targetRate = targetSampleRate;
        this.frameSamples = Math.round((this.targetRate * frameMs) / 1000); //320
        this._resamplePos = 0; // fase para el resampler
        this._buf = new Float32Array(0);
        this._out = new Float32Array(0);
    }
    static get parameterDescriptors() { return []; }
    downsample(inFloats) {
        // Resampler lineal de 48k (context) a targetRate (16k)
        const ratio = sampleRate / this.targetRate;
        const outLen = Math.floor(inFloats.length / ratio) + 1;
        const out = new Float32Array(outLen);
        let pos = this._resamplePos;
        let i = 0;
        while (pos < inFloats.length) {
            const idx = Math.floor(pos);
            const frac = pos - idx;
            const s0 = inFloats[idx] || 0;
            const s1 = inFloats[idx + 1] || s0;
            out[i++] = s0 + (s1 - s0) * frac;
            pos += ratio;
        }
        this._resamplePos = pos - inFloats.length; // lleva el sobrante a la siguiente llamada
        return out.subarray(0, i);
    }
    pushFrames(outFloats) {
        // Acumula hasta frameSamples y emite en Int16
        // Concat rápido
        const merged = new Float32Array(this._out.length + outFloats.length);
        merged.set(this._out, 0);
        merged.set(outFloats, this._out.length);
        this._out = merged;
        while (this._out.length >= this.frameSamples) {
            const chunk = this._out.subarray(0, this.frameSamples);
            const rest = this._out.subarray(this.frameSamples);
            this._out = new Float32Array(rest.length);
            this._out.set(rest, 0);
            // Float32 [-1,1] → Int16LE
            const int16 = new Int16Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
                let s = Math.max(-1, Math.min(1, chunk[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this.port.postMessage({ type: 'frame', buffer: int16.buffer },
                [int16.buffer]);
        }
    }
    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0] || input[0].length === 0) return true;
        const mono = input[0]; // canal 0
        const ds = this.downsample(mono);
        this.pushFrames(ds);
        return true;
    }
}
registerProcessor('pcm-worklet', PCMWorklet);