# Claude Code / Cursor Handoff Prompt

You are a senior full-stack engineer and mobile architect. Build M-Secretary V1.3, a low-resource mobile AI meeting secretary application.

## Goal

Create a mobile-first app that turns old Android/iOS phones into meeting secretary devices. The mobile app records meeting audio, splits it into 5-minute chunks, stores audio offline, uploads chunks with retry, and displays AI-generated meeting summaries, decisions, action items, risks, and official minutes.

## Tech Stack

Mobile:
- React Native
- Expo Dev Client
- TypeScript
- SQLite
- MMKV
- React Query
- Zustand
- expo-file-system
- audio recording module

Backend:
- NestJS
- Prisma
- PostgreSQL
- Redis + BullMQ
- MinIO/S3-compatible storage

AI:
- faster-whisper worker
- LLM summary worker
- JSON output validation

## Repository Structure

```txt
m-secretary/
  apps/mobile
  apps/api
  packages/shared
  ai
  infra
  docs
  prompts
```

## Critical Constraints

- Mobile must remain lightweight.
- Do not run heavy AI on mobile.
- Recording must not be lost when network fails.
- Audio chunks must be persisted locally before upload.
- Upload must be idempotent using clientChunkId + checksum.
- Backend processing must use queue workers.
- Thai language must be supported.
- AI output must include confidence and quality check.

## Core Features to Implement First

1. Mobile project scaffold
2. Local SQLite schema
3. Meeting creation
4. Audio recording
5. Chunk manager
6. Upload queue
7. NestJS meeting API
8. Audio chunk upload API
9. Prisma schema migration
10. Processing status API

## Step-by-step Development Plan

### Step 1: Scaffold

Create monorepo with mobile and api apps. Add shared package for types.

### Step 2: Backend

Implement:
- Prisma schema
- Meeting module
- AudioChunk module
- Marker module
- Status endpoint
- File upload to local/MinIO

### Step 3: Mobile Local Data

Implement:
- SQLite schema
- Meeting repository
- Audio chunk repository
- Marker repository
- Upload queue table

### Step 4: Recording

Implement:
- mic permission flow
- start/stop recording
- chunk every 5 minutes
- save metadata
- crash recovery

### Step 5: Upload Queue

Implement:
- queue pending chunks
- retry with backoff
- network-aware upload
- server response handling

### Step 6: AI Worker Interface

Stub worker first. Do not block mobile/backend on real AI integration. Use mock transcript and summary until worker is ready.

### Step 7: Meeting Board

Implement summary display with mock data, then connect API.

## Deliverables

- Working mobile recording MVP
- Working backend upload MVP
- Prisma migrations
- API route tests
- README setup
- Basic QA checklist

## Coding Rules

- Use TypeScript strict mode.
- Keep services small and testable.
- Never load whole audio file into memory.
- Use environment variables for secrets.
- Add clear error states.
- Add logs without leaking transcript/audio content.

## Definition of Done for First Sprint

- A user can create a meeting.
- A user can record 10 minutes of audio split into 2 chunks.
- Chunks are saved locally with metadata.
- Chunks upload to backend.
- Server stores chunks and returns status.
- App shows upload progress.
