// Importaciones Necesarias
import http from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

// Variables Globales de Configuración
const PORT = 8080;
const VOSK_URL = process.env.VOSK_URL || 'ws://localhost:2700';
const DEFAULT_LANG = process.env.DEFAULT_LANG || 'es-CO';
const FRAME_MS = Number(process.env.FRAME_MS || 20);
const JITTER_MS = Number(process.env.JITTER_MS || 240);
const DIARIZATION = process.env.DIARIZATION === '1';

const app = express();

app.use(express.static('public'));
const server = http.createServer(app);
// Utilidad: RMS simple para energía
function rmsInt16(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let sum = 0;
    for (let i = 0; i < dv.byteLength; i += 2) {
        const s = dv.getInt16(i, true) / 32768;
        sum += s * s;
    }
    return Math.sqrt(sum / (dv.byteLength / 2));
}
// Heurística de diarización A/B por silencios
class Diarizer {
    constructor(threshold = 0.02, minSilenceMs = 350) {
        this.threshold = threshold;
        this.minSilenceMs = minSilenceMs;
        this.current = 'A';
        this.silenceMs = 0;
    }
    feed(int16Frame, frameMs) {
        const energy = rmsInt16(int16Frame);
        if (energy < this.threshold) {
            this.silenceMs += frameMs;
        } else {
            if (this.silenceMs >= this.minSilenceMs) {
                this.current = this.current === 'A' ? 'B' : 'A';
            }
            this.silenceMs = 0;
        }
        return this.current;
    }
}

const wss = new WebSocketServer({ noServer: true, path: '/stream' });
wss.on('connection', (wsClient) => {
    let vosk = null;
    let opened = false;
    const jitterFrames = Math.max(1, Math.round(JITTER_MS / FRAME_MS));
    const buffer = [];
    const diarizer = new Diarizer();
    function flush() {
        if (!vosk || vosk.readyState !== WebSocket.OPEN) return;
        while (buffer.length) {
            const frame = buffer.shift();
            vosk.send(frame);
        }
    }
    wsClient.on('message', (raw) => {
        // Control JSON o audio binario (Int16LE)
        if (raw[0] === 0x7b) { // '{'
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'init' && !opened) {
                opened = true;
                const lang = msg.language || DEFAULT_LANG;
                const sampleRate = msg.sampleRate || 16000;
                const wantDiar = DIARIZATION || !!msg.diarization;
                vosk = new WebSocket(VOSK_URL);
                vosk.on('open', () => {
                // Config inicial para Vosk WS
                // Nota: muchos servidores Vosk aceptan solo audio; enviamos config si está soportado
                    try {
                        vosk.send(JSON.stringify({
                            config: {
                                sample_rate: sampleRate,

                                words: true
                            }
                        }));
                    } catch { }
                    wsClient.send(JSON.stringify({
                        type: 'ready', provider: 'vosk',

                        language: lang
                    }));
                    flush();
                });
                vosk.on('message', (buf) => {
                    try {
                        const m = JSON.parse(buf.toString());
                        if (m?.partial) {
                            wsClient.send(JSON.stringify({
                                type: 'partial', text:
                                    m.partial, speaker: wantDiar ? diarizer.current : undefined
                            }));

                        }
                        if (m?.text && m?.result) {
                            wsClient.send(JSON.stringify({
                                type: 'final', text: m.text,

                                speaker: wantDiar ? diarizer.current : undefined
                            }));

                        }
                    } catch (e) {
                        wsClient.send(JSON.stringify({
                            type: 'error', message:

                                String(e?.message || e)
                        }));

                    }
                });
                vosk.on('close', () => wsClient.send(JSON.stringify({
                    type:
                        'end'
                })));
                vosk.on('error', (e) => wsClient.send(JSON.stringify({
                    type:
                        'error', message: String(e?.message || e)
                })));
            }
            if (msg.type === 'end') {
                try { vosk?.send(JSON.stringify({ eou: 1 })); } catch { }
                vosk?.close();
                wsClient.close();
            }
            return;
        }
        // Audio binario: encolamos para jitter y estimamos speaker
        buffer.push(raw);
        if (buffer.length >= jitterFrames) flush();
        if (DIARIZATION) {
            // Actualizamos A/B con este frame
            diarizer.feed(new Int16Array(raw.buffer, raw.byteOffset,
                raw.byteLength / 2), FRAME_MS);
        }
    });
    wsClient.on('close', () => {
        try { vosk?.send(JSON.stringify({ eou: 1 })); } catch { }
        try { vosk?.close(); } catch { }
    });
});
server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/stream')) {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws,
            req));
    } else {
        socket.destroy();
    }
});
server.listen(PORT, () => console.log(`Gateway listo: http://localhost:${PORT}`));