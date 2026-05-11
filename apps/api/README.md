# @msec/api — NestJS backend

## Run

```bash
# from monorepo root
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis minio
npm install
npm --workspace @msec/api exec -- prisma generate
npm --workspace @msec/api exec -- prisma migrate dev --name init
npm --workspace @msec/api run prisma:seed
npm run dev:api
```

API will listen on `http://localhost:3000/api/v1`.

## Modules

| Module | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` (stub) |
| Health | `GET /health` |
| Meetings | `POST/GET/PATCH /meetings`, `POST /meetings/:id/start\|end` |
| AudioChunks | `POST /meetings/:id/audio-chunks` (multipart), `GET /meetings/:id/audio-chunks`, `PATCH /audio-chunks/:id/status` |
| Markers | `POST/GET /meetings/:id/markers` |
| Status | `GET /meetings/:id/status`, `POST /meetings/:id/process` |
| Transcripts | `GET /meetings/:id/transcript` |
| Summaries | `GET /meetings/:id/board`, `GET /meetings/:id/summary`, `POST /meetings/:id/summary/regenerate` |
| ActionItems | `GET/POST /meetings/:id/action-items`, `PATCH /action-items/:id` |
| Exports | `POST/GET /meetings/:id/exports`, `GET /exports/:id` |

## Notes

- `AuthService.login` is a Phase A stub — first seeded user is returned.
- Storage abstraction supports `s3` (default, MinIO compatible) and `local` driver.
- Transcription jobs are pushed to BullMQ (`transcribe`); the worker runs in `apps/worker`.
