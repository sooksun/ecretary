FROM python:3.11-slim

# faster-whisper needs ffmpeg + libgomp (OpenMP runtime) at runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py /app/

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    HF_HUB_CACHE=/models \
    XDG_CACHE_HOME=/models

EXPOSE 9001

# Single worker keeps the model in one process; scale by replicas not workers.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9001", "--workers", "1"]
