# POC Streaming ASR — Local (Vosk)
## Prerrequisitos
- Docker Desktop (Windows/macOS) o Docker Engine (Linux)
- Puerto 8080 libre (UI/WS) y 2700 libre (Vosk)
- Micrófono conectado
## Pasos
1. Clona esta carpeta y entra en `poc-streaming-asr/`.
2. Ejecuta: `docker compose up --build`.
3. Abre `http://localhost:8080` en el navegador (Chrome recomendado).
4. Pulsa **Iniciar** y acepta permisos de micrófono.
5. Habla y verás **parciales** (gris) y **finales** (negro).
6. **Detener** cierra la sesión.
## Ajustes rápidos
- Cambia **idioma** en UI (por ahora informativo para Vosk; sí se usa en futuros proveedores).
- Cambia `FRAME_MS` y `JITTER_MS` en `docker-compose.yml` para jugar con latencia vs. estabilidad.
- Umbral de diarización: edita `Diarizer(threshold, minSilenceMs)` en `server.js`.
## Exportación TXT/DOCX
En esta POC nos enfocamos en **capturar y transcribir**. Para exportar, puedes copiar/pegar el texto o añadir un botón que consuma los eventos `final` y genere archivos (siguiente iteración).
## Cambiar a otro proveedor (puerta abierta)
La estructura del *gateway* separa la conexión **cliente ⇄ gateway** (WS `/stream`) de la conexión **gateway ⇄ ASR** (`VOSK_URL`). Para Google/AWS, reemplaza la conexión Vosk por el SDK correspondiente y conserva el **contrato de eventos** `{partial|final, text, speaker}`.