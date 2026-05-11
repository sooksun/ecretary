# 02 Architecture — M-Secretary V1.3

## High-level Architecture

```txt
Mobile App
  ├─ Meeting UI
  ├─ Audio Recording Engine
  ├─ Chunk Manager
  ├─ Local SQLite DB
  ├─ Upload Queue
  └─ Meeting Board UI
        │
        ▼
API Gateway / Backend
  ├─ Auth Service
  ├─ Organization Service
  ├─ Meeting Service
  ├─ Audio Upload Service
  ├─ Processing Status Service
  ├─ Action Item Service
  └─ Export Service
        │
        ▼
Infrastructure
  ├─ PostgreSQL/MySQL
  ├─ Redis + BullMQ
  ├─ MinIO/S3 Storage
  └─ Worker Runtime
        │
        ▼
AI Workers
  ├─ Audio Preprocess Worker
  ├─ faster-whisper Transcription Worker
  ├─ Transcript Merger
  ├─ LLM Summary Worker
  └─ Quality Check Worker
```

## Mobile Responsibilities

Mobile must remain lightweight.

```txt
Record → Chunk → Store → Upload → Display
```

Mobile must not:

- run heavy speech-to-text model
- run large LLM locally
- keep huge audio in memory
- depend on always-on network

## Backend Responsibilities

```txt
Receive → Validate → Store → Queue → Process → Summarize → Return Result
```

## Data Flow

```txt
1. User creates meeting
2. Mobile creates local meeting row
3. Mobile syncs meeting to API
4. Mobile records chunk every 5 minutes
5. Each chunk saved locally with checksum
6. Upload queue sends chunk to API
7. API stores file in object storage
8. API creates transcription job
9. Worker transcribes chunk
10. Transcript merger combines all chunks
11. Summary worker generates meeting board
12. Mobile fetches status/result
```

## Recommended Runtime

### Mobile

- React Native
- Expo Dev Client or Bare React Native
- TypeScript
- SQLite
- MMKV
- Background upload task

### Backend

- NestJS
- Prisma
- PostgreSQL or MySQL
- Redis
- BullMQ
- MinIO/S3

### AI

- faster-whisper
- LLM provider/local LLM
- Optional Qdrant for meeting memory search

## Deployment Topology

### MVP Single Server

```txt
Ubuntu Server
  ├─ nginx reverse proxy
  ├─ api container
  ├─ worker container
  ├─ redis container
  ├─ postgres/mysql container
  ├─ minio container
  └─ optional qdrant container
```

### Production-ready Split

```txt
App Server
  ├─ API
  ├─ Redis
  └─ DB

AI Server
  ├─ GPU Worker
  ├─ faster-whisper
  └─ LLM/local model

Storage
  └─ S3/MinIO
```

## Design Decisions

### Chunk Length

Default: 5 minutes

Reason:

- prevents giant files
- easier retry
- reduces crash impact
- parallel server processing
- good balance between overhead and reliability

### Audio Format

Recommended:

```txt
M4A/AAC
16kHz if supported
64kbps–128kbps
Mono
```

### Idempotent Upload

Each chunk has:

```txt
meeting_id
chunk_index
checksum
client_chunk_id
```

If client retries, server must not duplicate processing.
