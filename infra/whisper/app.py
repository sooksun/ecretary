"""
M-Secretary Whisper service.

High-performance FastAPI wrapper around faster-whisper. Supports batched inference,
multi-threaded CPU/GPU optimization, non-blocking async execution, and startup model prewarming.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
import time
from typing import Iterable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("whisper-svc")

MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")             # cpu | cuda
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8") # int8 (CPU), float16 (GPU)
DEFAULT_LANG = os.environ.get("WHISPER_DEFAULT_LANG", "th")
BEAM_SIZE = int(os.environ.get("WHISPER_BEAM_SIZE", "1"))     # 1 = greedy, faster
VAD_FILTER = os.environ.get("WHISPER_VAD", "true").lower() == "true"
CPU_THREADS = int(os.environ.get("WHISPER_CPU_THREADS", "4"))
BATCH_SIZE = int(os.environ.get("WHISPER_BATCH_SIZE", "16"))
WARMUP_ON_STARTUP = os.environ.get("WHISPER_WARMUP", "true").lower() == "true"

_model = None
_batched_pipeline = None
_model_lock = threading.Lock()


def get_model():
    global _model, _batched_pipeline
    if _model is not None:
        return _model, _batched_pipeline
    with _model_lock:
        if _model is not None:
            return _model, _batched_pipeline
        from faster_whisper import WhisperModel

        log.info(
            "loading whisper model name=%s device=%s compute=%s threads=%d batch_size=%d",
            MODEL_NAME, DEVICE, COMPUTE_TYPE, CPU_THREADS, BATCH_SIZE,
        )
        t0 = time.time()
        _model = WhisperModel(
            MODEL_NAME,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            cpu_threads=CPU_THREADS,
            num_workers=2 if DEVICE == "cuda" else 1,
        )
        
        try:
            from faster_whisper import BatchedInferencePipeline
            _batched_pipeline = BatchedInferencePipeline(model=_model)
            log.info("BatchedInferencePipeline enabled for faster-whisper")
        except Exception as e:
            log.info("BatchedInferencePipeline unavailable (using standard pipeline): %s", e)
            _batched_pipeline = None

        log.info("model loaded in %.1fs", time.time() - t0)
        return _model, _batched_pipeline


app = FastAPI(title="msec-whisper", version="0.2.0")


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


@app.on_event("startup")
async def startup_event():
    if WARMUP_ON_STARTUP:
        log.info("Warming up whisper model on startup...")
        def _warmup():
            model, _ = get_model()
            return model is not None
        await asyncio.to_thread(_warmup)
        log.info("Whisper model warmup completed.")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute": COMPUTE_TYPE,
        "cpu_threads": CPU_THREADS,
        "batch_size": BATCH_SIZE,
        "batched_pipeline": _batched_pipeline is not None,
        "loaded": _model is not None,
    }


def _run_transcription(tmp_path: str, lang: str):
    model, pipeline = get_model()
    t0 = time.time()
    if pipeline is not None and BATCH_SIZE > 1:
        segments_iter, info = pipeline.transcribe(
            tmp_path,
            language=lang,
            vad_filter=VAD_FILTER,
            batch_size=BATCH_SIZE,
        )
    else:
        segments_iter, info = model.transcribe(
            tmp_path,
            language=lang,
            vad_filter=VAD_FILTER,
            beam_size=BEAM_SIZE,
            condition_on_previous_text=False,
        )
    out: list[Segment] = list(_iter_segments(segments_iter))
    elapsed = time.time() - t0
    return out, info, elapsed


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
        lang = language or DEFAULT_LANG
        log.info("transcribe path=%s lang=%s", tmp_path, lang)
        
        # Offload heavy CPU/GPU model processing to thread pool so async loop remains responsive
        out, info, elapsed = await asyncio.to_thread(_run_transcription, tmp_path, lang)

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

