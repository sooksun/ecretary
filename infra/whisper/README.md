# msec-whisper — faster-whisper HTTP service

Lightweight FastAPI wrapper around `faster-whisper` so the BullMQ worker
can offload Thai audio transcription without bundling a 1-2 GB model
inside the Node container.

## Run

```bash
# from repo root
docker compose -f infra/docker-compose.yml --profile ai up -d whisper

# verify (model is NOT loaded until first transcribe call)
curl -s http://localhost:9001/health
# {"status":"ok","model":"medium","device":"cpu","compute":"int8","loaded":false}
```

The model downloads on the first `/transcribe` request and stays in
memory until the container restarts. The `whisper_models` named volume
caches downloaded weights so subsequent container restarts skip the
download.

## Quick smoke test

```bash
# any short Thai .m4a / .wav file
curl -s -X POST http://localhost:9001/transcribe \
  -F "file=@sample.m4a" \
  -F "language=th" | jq
```

Expect `{ "modelName": "faster-whisper:medium", "segments": [...] }`.
First call: 30–120 s extra for model download. Steady state on an
8-core CPU laptop: roughly **0.3-0.5× real-time** with `medium` int8 —
i.e. a 5-min chunk transcribes in about 90-150 s.

## Tuning via environment

| Var | Default | Notes |
|---|---|---|
| `WHISPER_MODEL` | `medium` | `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_DEVICE` | `cpu` | `cuda` if you have a GPU + the right base image |
| `WHISPER_COMPUTE_TYPE` | `int8` | `float16` for GPU, `int8_float16` mixed |
| `WHISPER_DEFAULT_LANG` | `th` | sent if caller omits `language` |
| `WHISPER_BEAM_SIZE` | `1` | bump to 5 for slower but more accurate decoding |
| `WHISPER_VAD` | `true` | filter silence before decoding |

## Wire format

Request: `multipart/form-data`
- `file` (required) — the audio file
- `language` (optional) — ISO-639-1 (`th`, `en`, `auto`); falls back to `WHISPER_DEFAULT_LANG`

Response:

```jsonc
{
  "modelName": "faster-whisper:medium",
  "durationSec": 312.4,
  "segments": [
    { "start": 0.0, "end": 4.2, "text": "...", "language": "th", "confidence": 0.83 }
  ]
}
```

`confidence` is a coarse proxy derived from segment-level `avg_logprob`
(`max(0, 1 + avg_logprob)`); useful for UI sorting, not absolute.

## Production caveats

- **CPU vs GPU**: `medium` on an 8-core CPU is acceptable for back-of-meeting batch processing. For live use, switch to GPU (`large-v3` + float16).
- **One model per process**: the model is held by one Python process; scale by adding replicas (compose `deploy.replicas` or run multiple containers behind a reverse proxy), not by Uvicorn `--workers`.
- **Memory**: `medium` int8 = ~1.5 GB RSS. `large-v3` = ~3 GB. Allocate accordingly.
- **First-request latency** is dominated by model download; pre-warm by calling `/transcribe` with a 1-second silent file at boot if you need to hide that cost.
