"""
M-Secretary Whisper service.

Single-process FastAPI wrapper around faster-whisper. The model is
loaded lazily on the first /transcribe request and held in memory for
the lifetime of the process — concurrency is intentionally serialized
inside the model (one request transcribes at a time per replica) to
keep RAM bounded. Run multiple replicas if higher throughput is needed.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from typing import Iterable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("whisper-svc")

MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")             # cpu | cuda
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8") # int8 (CPU), float16 (GPU)
DEFAULT_LANG = os.environ.get("WHISPER_DEFAULT_LANG", "th")
BEAM_SIZE = int(os.environ.get("WHISPER_BEAM_SIZE", "1"))     # 1 = greedy, faster
VAD_FILTER = os.environ.get("WHISPER_VAD", "true").lower() == "true"

_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from faster_whisper import WhisperModel

        log.info(
            "loading whisper model name=%s device=%s compute=%s",
            MODEL_NAME, DEVICE, COMPUTE_TYPE,
        )
        t0 = time.time()
        _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("model loaded in %.1fs", time.time() - t0)
        return _model


app = FastAPI(title="msec-whisper", version="0.1.0")


class Segment(BaseModel):
    start: float
    end: float
    text: str
    language: str
    confidence: float


class TranscribeResponse(BaseModel):
    modelName: str
    durationSec: float
    segments: list[Segment]


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute": COMPUTE_TYPE,
        "loaded": _model is not None,
    }


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> TranscribeResponse:
    if file.content_type and not file.content_type.startswith(("audio/", "video/", "application/octet-stream")):
        log.warning("unexpected content_type=%s — proceeding anyway", file.content_type)

    suffix = os.path.splitext(file.filename or "chunk.m4a")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        model = get_model()
        lang = language or DEFAULT_LANG
        log.info("transcribe path=%s lang=%s", tmp_path, lang)
        t0 = time.time()
        segments_iter, info = model.transcribe(
            tmp_path,
            language=lang,
            vad_filter=VAD_FILTER,
            beam_size=BEAM_SIZE,
            condition_on_previous_text=False,
        )
        out: list[Segment] = []
        for s in _iter_segments(segments_iter):
            out.append(s)
        elapsed = time.time() - t0
        log.info("done segments=%d elapsed=%.1fs duration=%.1fs", len(out), elapsed, info.duration)
        return TranscribeResponse(
            modelName=f"faster-whisper:{MODEL_NAME}",
            durationSec=info.duration,
            segments=out,
        )
    except Exception as e:
        log.exception("transcribe failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _iter_segments(segments_iter: Iterable) -> Iterable[Segment]:
    """Map faster-whisper internal segments to our wire format."""
    for s in segments_iter:
        # avg_logprob is negative; map roughly to a 0..1 confidence proxy.
        try:
            confidence = max(0.0, min(1.0, 1.0 + float(s.avg_logprob)))
        except Exception:
            confidence = 0.5
        text = (s.text or "").strip()
        if not text:
            continue
        yield Segment(
            start=float(s.start),
            end=float(s.end),
            text=text,
            language=DEFAULT_LANG,
            confidence=confidence,
        )
