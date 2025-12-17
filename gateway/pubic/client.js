const FRAME_MS = 20; // 20 ms → 320 muestras @ 16 kHz
const SAMPLE_RATE_TARGET = 16000; // PCM 16 kHz mono
let ws, ctx, worklet, running = false;
const $ = (s) => document.querySelector(s);
const logEl = $('#log');
const statusEl = $('#status');
function appendLine(text, cls = 'final') {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}
$('#btnStart').onclick = async () => {
    if (running) return;
    running = true;
    ws = new WebSocket(`ws://${location.host}/stream`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'init', language: $('#lang').value, sampleRate:
                SAMPLE_RATE_TARGET, diarization: true, stabilizedPartials: true
        }));
        statusEl.textContent = 'Estado: conectado';
    };
    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'ready') {
                appendLine(`[ready] proveedor=${msg.provider}, lenguaje=${msg.language}`, 'partial');
            }
            if (msg.type === 'partial') {
                // Muestra parcial en una sola línea (sobrescribible)
                if (!clientState.partialEl) {
                    clientState.partialEl = document.createElement('div');
                    clientState.partialEl.className = 'partial';
                    logEl.appendChild(clientState.partialEl);
                }
                clientState.partialEl.textContent = `${msg.speaker ? '[' + msg.speaker + '] ' : ''}${msg.text}`;
                logEl.scrollTop = logEl.scrollHeight;
            }
            if (msg.type === 'final') {
                if (clientState.partialEl) {
                    clientState.partialEl.remove();
                    clientState.partialEl = null;
                }
                appendLine(`${msg.speaker ? '[' + msg.speaker + '] ' : ''}${msg.text}`, 'final');
            }
            if (msg.type === 'error') {
                appendLine(`[error] ${msg.message}`, 'partial');
            }
            if (msg.type === 'end') {
                statusEl.textContent = 'Estado: finalizado';
            }
        } catch { }
    };
    ws.onclose = () => {
        statusEl.textContent = 'Estado: desconectado';
    };
    // AudioWorklet: captura + resample a 16k + empaquetado 20ms
    ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate:
            48000
    });
    await ctx.audioWorklet.addModule('./recorder-worklet.js');
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1, noiseSuppression: true, echoCancellation: false
        }, video:
            false
    });
    const src = ctx.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(ctx, 'pcm-worklet', {
        processorOptions: {
            targetSampleRate: SAMPLE_RATE_TARGET, frameMs: FRAME_MS
        }
    });
    worklet.port.onmessage = (ev) => {
        if (ev.data?.type === 'frame' && ws?.readyState === WebSocket.OPEN) {
            ws.send(ev.data.buffer); // Int16Array.buffer
        }
    };
    src.connect(worklet).connect(ctx.destination); // Nota: en producciónpuedes no rutear a speakers
};
const clientState = { partialEl: null };
$('#btnStop').onclick = () => {
    running = false;
    try { ws?.send(JSON.stringify({ type: 'end' })); } catch { }
    try { ws?.close(); } catch { }
    try { worklet?.port.postMessage({ type: 'stop' }); } catch { }
};
$('#btnStart').disabled = false;
$('#btnStop').disabled = false;