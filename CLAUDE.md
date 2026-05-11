# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

M-Secretary V1.3 — mobile-first AI meeting secretary. Old Android phones act as the recording device ("ears + notepad"); a NestJS API + BullMQ worker do storage, transcription, and summarization ("brain"). The mock and real provider implementations live side-by-side in `apps/worker/src/ai/`; pipeline runs end-to-end on mocks today, and real `faster-whisper` (M3) and Claude LLM (M4) are selected via env vars (`AI_PROVIDER=whisper`, `LLM_PROVIDER=claude`). The remaining cut-line item is an end-to-end real-device smoke (M1).

## Layout

npm workspaces root with three apps + one shared package. The mobile app is **deliberately outside** the workspace (Metro prefers a self-contained tree) — it has its own `package.json` / `node_modules` and must be installed separately.

```
apps/api                                NestJS REST API (Prisma + BullMQ producer + S3/MinIO + JWT global guard)
apps/worker                             BullMQ consumer (transcription + summarization providers)
apps/mobile                             React Native + Expo Dev Client (NOT in workspaces)
apps/mobile/modules/m-secretary-recorder  Local Expo Module — Kotlin Foreground Service for Android recording (M5)
packages/shared                         @msec/shared — TS types, Zod schemas, enums, queue names
infra/docker-compose.yml                Postgres profile=db / Redis / MinIO; api+worker profile=app; whisper profile=ai
infra/whisper/                          faster-whisper FastAPI service (M3)
docs/                                   PRD, architecture, ERD, API spec, AI workflow, roadmap, runbook
prompts/                                Thai summary prompt templates (general / PLC / official)
```

## Commands

Requires **Node.js ≥ 20** (see `engines` in root `package.json`). All commands run from monorepo root unless noted.

```bash
# Bootstrap
npm run infra:up                                            # redis + minio + whisper (use --profile db if you also need postgres)
# or fine-grained:
docker compose -f infra/docker-compose.yml up -d postgres redis minio
cp .env.example .env
npm install                                                 # root + api + worker + shared
npm --workspace @msec/shared run build                      # shared MUST build before api/worker typecheck
npm --workspace @msec/api exec -- prisma generate
npm --workspace @msec/api exec -- prisma migrate dev --name init
npm --workspace @msec/api run prisma:seed

# Dev (three terminals)
npm run doctor                                              # OPTIONAL preflight: db, redis, minio, whisper, anthropic key
npm run dev:api                                             # NestJS watch (auto-loads .env via @nestjs/config)
npm run dev:worker                                          # ts-node-dev watch (auto-loads .env via dotenv/config)
cd apps/mobile && npm install && npx expo run:android       # mobile is separate

# Build / typecheck
npm run build                                               # shared → api → worker (order matters)
npm run typecheck                                           # all workspaces

# Prisma
npm --workspace @msec/api run prisma:studio
npm --workspace @msec/api exec -- prisma migrate reset --force   # destructive

# Lint
npm --workspace @msec/api run lint
cd apps/mobile && npm run lint

# Tests
npm --workspace @msec/api run test:e2e                      # API e2e (jest, supertest) — only test suite that exists
```

No unit tests are configured for `@msec/api`, `@msec/worker`, or `@msec/shared` — only the API e2e suite. Don't reference `npm test` in scripts; it is not wired.

`predev:*` and `preprisma:*` hooks run `sync:env`, which copies the **root** `.env` into `apps/api/.env` and `apps/worker/.env`. Edit the **root** `.env` — per-app copies are overwritten on every dev/prisma run.

## Env vars that change behavior

| Var | Default | Effect |
|---|---|---|
| `JWT_SECRET` | `change-me-dev-secret` | Sign/verify key for `JwtAuthGuard`. Replace in production. |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime; expired tokens 401 → mobile auto-logout |
| `SEED_PASSWORD` | `admin1234` | Seed user password (read by `prisma:seed`, not the running API) |
| `AI_PROVIDER` | `mock` | `mock` \| `whisper` — picks transcription provider in `jobs/transcribe.ts` |
| `WHISPER_ENDPOINT` | `http://localhost:9001` | Where `WhisperHttpProvider` POSTs audio. Inside compose use `http://whisper:9001` |
| `WHISPER_LANGUAGE` | `th` | Sent to whisper as form field |
| `LLM_PROVIDER` | `mock` | `mock` \| `claude` — picks summary provider in `jobs/summarize.ts` |
| `LLM_MODEL` | `claude-sonnet-4-6` | Anthropic model ID for `ClaudeSummarizationProvider` |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=claude`; missing key → init throws → factory falls back to mock |
| `WORKER_CONCURRENCY_TRANSCRIBE` | `2` | BullMQ concurrency for transcribe queue |
| `WORKER_CONCURRENCY_SUMMARY` | `1` | BullMQ concurrency for summarize queue |

## Architecture notes that span files

**Pipeline.** `Mobile records 5-min chunks → POST /meetings/:id/audio-chunks (multipart, idempotent by checksum) → S3/MinIO → BullMQ `transcribe` queue → worker writes transcript segments → when ALL chunks COMPLETED the transcribe handler enqueues a single `summarize` job → worker upserts MeetingSummary + ActionItems → meeting flips to READY.` The transcribe handler in `apps/worker/src/jobs/transcribe.ts` owns the "all chunks done?" check and the summary enqueue — don't duplicate that logic on the API side.

**Provider swap point.** `apps/worker/src/ai/` exports `TranscriptionProvider` and `SummarizationProvider` interfaces. Selection is via env vars and happens in two factory functions inside `jobs/transcribe.ts` and `jobs/summarize.ts` — **don't add provider conditionals anywhere else.** Currently shipping:

| Variant | Selection | Provider class |
|---|---|---|
| `AI_PROVIDER=mock` (default) | deterministic Thai segments — never reads audio | `MockTranscriptionProvider` |
| `AI_PROVIDER=whisper` | downloads chunk from S3 → multipart POST to `WHISPER_ENDPOINT` (`http://whisper:9001` in compose) → maps response | `WhisperHttpProvider` |
| `LLM_PROVIDER=mock` (default) | hand-rolled `SummaryOutput` matching markers | `MockSummarizationProvider` |
| `LLM_PROVIDER=claude` | Anthropic SDK with **tool use** (`submit_meeting_summary`) for guaranteed JSON shape, prompt caching on system + template, `LLM_MODEL` defaults to `claude-sonnet-4-6` | `ClaudeSummarizationProvider` |

**The summary contract is the JSON shape, not the prompt.** Real providers must `SummaryOutputSchema.parse(json)` and **throw on any failure** (no API key, network error, tool_use missing, Zod validation fail). The job handler lets BullMQ retry, and the worker `failed` event marks the meeting as `FAILED` with `failureReason` after final attempt. **Never silently substitute mock content** — a meeting marked `READY` must reflect the user's actual audio. Mock providers are dev-only and selected explicitly via `LLM_PROVIDER=mock` / `AI_PROVIDER=mock`.

**Worker → S3.** Worker has its own minimal S3 read client at `apps/worker/src/storage.ts` (only download path; never writes). Don't import from `apps/api/src/storage` — that's API-side and pulls in NestJS.

**Shared contracts.** `@msec/shared` is the single source of truth for enums (`MeetingStatus`, `ChunkUploadStatus`, `QueueName`, `MeetingType`, `UserRole`), Zod schemas (`SummaryOutputSchema`, upload/marker/meeting create), and types. Worker, API, and mobile import from it. **Build `@msec/shared` first** — `tsc` references won't resolve otherwise. Mobile re-mirrors a subset under `apps/mobile/src/types` because mobile is outside the workspace.

**Storage.** `apps/api/src/storage` abstracts MinIO/S3 vs local-disk fallback behind one interface. Bucket `msecretary` is auto-created on first upload. Don't hardcode S3 SDK calls in modules — go through the storage service.

**Auth (M2).** Real JWT + bcryptjs. `JwtAuthGuard` is registered as `APP_GUARD` in `app.module.ts` so **every endpoint requires a bearer token by default**. Mark public endpoints with `@Public()` (currently only `/health` and `/auth/login`). Use `@CurrentUser()` to inject `AuthUser` into controllers — `meetings.service.create` takes the actor as a parameter, no more `prisma.user.findFirst()` shenanigans. JWT payload is `{sub, orgId, role}`. Seed user is `admin@msecretary.local` / `admin1234` (override via `SEED_PASSWORD` before running `prisma:seed`).

**Mobile auth.** Token + user are persisted in `expo-secure-store` via `AuthStorage`. `useAuthStore` (zustand) holds the reactive state and is hydrated by `useBootstrap` on app start. The axios client at `apps/mobile/src/api/client.ts` reads the token from the store on every request and **on 401 calls `useAuthStore.getState().logout()`** — which clears storage and routes the navigator back to `LoginScreen`. `UploadQueueService.tick()` short-circuits when there's no token, so logging out doesn't burn retry counts.

**Mobile recording (M5).** The Phase A `expo-av` recorder is replaced by a local Expo Module at `apps/mobile/modules/m-secretary-recorder/`. The Kotlin side runs a `RecordingService` (Foreground Service, type=microphone) that uses `MediaRecorder.setNextOutputFile()` for **gapless** 5-min chunk rotation on Android 8+. The JS-side `AudioRecorderService.ts` is now a thin wrapper that delegates to the native module while preserving the original interface — **screens are unchanged**. Format: AAC/MP4 16 kHz mono 64 kbps. Requires `npx expo prebuild --clean` before the first build (autolinks the local module). iOS path is intentionally not implemented (`Platform.OS !== 'android'` throws). Upload queue still polls every 4s with exponential backoff (max 6 retries); SQLite repos in `src/db` mirror chunk/meeting/marker rows locally.

**Android networking.** Emulator → host = `http://10.0.2.2:3000/api/v1` (default). Real device → use the laptop LAN IP and open Windows firewall on port 3000.

**Exports (M6).** `POST /meetings/:id/exports` accepts `{exportType: "DOCX" | "PDF" | "TRANSCRIPT_TXT"}` and returns `{id, filePath, downloadUrl, ...}`. The signed `downloadUrl` is good for 1 hour. DOCX uses `docx`, PDF uses `pdfmake` with bundled Sarabun fonts in `apps/api/assets/fonts/` (TH gov "TH Sarabun New"-equivalent). PDF rendering throws `ServiceUnavailableException` if the font files are missing — DOCX still works because Word/LibreOffice supplies fonts at open time. The official-minutes layout (header, attendees, agenda items, action-items table, signer block, AI quality footnote) lives in `render/{docx,pdf}-renderer.ts` — keep both renderers in sync when adding fields.

**Compose profiles.** `docker compose up -d redis minio` brings up only the dev infrastructure. Postgres lives in profile `db` (most dev machines have host Postgres on 5432 already — Laragon, Postgres installer, etc.); add `--profile db` if you don't. Whisper lives in profile `ai` (`docker compose --profile ai up -d whisper`). API + worker images live in profile `app` for production-style runs.

**Production env files (git-ignored).** Two locations to fill in before `docker compose --profile app up -d`:
- `.env.production` (root) — `AI_PROVIDER=whisper`, `LLM_PROVIDER=claude`, real `ANTHROPIC_API_KEY`. The worker preflight will refuse to boot if mock providers are set with `NODE_ENV=production`.
- `apps/mobile/.env.production` — `EXPO_PUBLIC_API_BASE_URL` set to the public HTTPS URL of the production API. Picked up by Expo at release-build time (`eas build --profile=production`). Localhost / LAN IPs will not work on installed APKs.

Both files have `REPLACE_WITH_*` placeholders; running with the placeholder values will fail at boot (preflight) or at first network call (mobile).

## Conventions

- API global prefix: `/api/v1` (set via `API_GLOBAL_PREFIX`).
- Every route is protected by `JwtAuthGuard` by default; opt out with `@Public()`. Don't add per-route guard registrations.
- Chunk uploads are idempotent on `(meetingId, sequence, checksumSha256)`. Re-uploading the same chunk must not duplicate.
- Meeting status is the canonical state machine; all transitions go through `StatusModule` / worker — don't write status fields directly from feature modules.
- Provider selection lives in the factory inside the matching `jobs/*.ts` file — don't branch on `AI_PROVIDER` / `LLM_PROVIDER` outside that one place.
- **No silent mock fallback.** Real providers must throw on failure; BullMQ retries; `apps/worker/src/main.ts` `failed` handler marks the meeting `FAILED` with `failureReason` after the final attempt. Mock providers are dev-only — selected explicitly via env, never as a fallback.
- **Worker preflight** (`apps/worker/src/preflight.ts`) runs at boot and refuses to start if `AI_PROVIDER=whisper` but whisper is unreachable, or if `LLM_PROVIDER=claude` but `ANTHROPIC_API_KEY` is missing/malformed. Run `npm run doctor` for the same checks before starting.
- Documentation in `docs/` is authoritative for product/architecture decisions; update it when behavior changes. Files used most often:
  - [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) — system architecture
  - [docs/03_ERD_DATABASE.md](docs/03_ERD_DATABASE.md) — ERD + Prisma model rationale
  - [docs/04_API_SPEC.md](docs/04_API_SPEC.md) — REST API contract
  - [docs/06_AI_WORKFLOW.md](docs/06_AI_WORKFLOW.md) — pipeline + JSON summary schema
  - [docs/10_RUNBOOK.md](docs/10_RUNBOOK.md) — full local-dev runbook
- Thai language is first-class in transcripts, prompts, and UI strings — don't normalize/strip it.
