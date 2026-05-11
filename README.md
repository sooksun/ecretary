# M-Secretary V1.3 — Mobile AI Meeting Secretary

Monorepo สำหรับเลขานุการประชุมดิจิทัลที่เปลี่ยนมือถือ Android เก่า ๆ
ให้กลายเป็นอุปกรณ์บันทึกเสียงและสรุปประชุมโดย AI

> มือถือ = หูและสมุดจด, Server = สมอง

## โครงสร้าง

```
m-secretary/
├── apps/
│   ├── api/          NestJS API (REST + Prisma + BullMQ producer + S3/MinIO)
│   ├── worker/       BullMQ consumer (mock STT + mock LLM in Phase A)
│   └── mobile/       React Native + Expo Dev Client
├── packages/
│   └── shared/       TypeScript types + Zod schemas + enums
├── docs/             PRD, architecture, ERD, API spec, AI workflow, etc.
├── prompts/          AI prompt templates (general / PLC / official)
├── infra/
│   └── docker-compose.yml
└── package.json      (npm workspaces — mobile is intentionally outside)
```

## Quickstart

```bash
# 1. infra
docker compose -f infra/docker-compose.yml up -d postgres redis minio

# 2. install + db
cp .env.example .env
npm install
npm --workspace @msec/shared run build
npm --workspace @msec/api exec -- prisma generate
npm --workspace @msec/api exec -- prisma migrate dev --name init
npm --workspace @msec/api run prisma:seed

# 3. run services (in three terminals)
npm run dev:api
npm run dev:worker
cd apps/mobile && npm install && npx expo run:android
```

Full step-by-step: [docs/10_RUNBOOK.md](docs/10_RUNBOOK.md).

## Status

| Area | Status |
|---|---|
| Monorepo + tooling | ✅ npm workspaces, TS strict, shared types |
| Prisma schema | ✅ 11 models incl. AuditLog, indexes, status enums |
| API: Meetings CRUD | ✅ |
| API: Audio chunk upload (multipart, idempotent, checksum) | ✅ |
| API: Markers, Status, Transcripts, Action Items | ✅ |
| API: Meeting Board, Summary regenerate | ✅ |
| API: Exports (PDF/DOCX) | 🚧 stub returns 501 (Phase 5 / M6 — not started) |
| Auth (JWT + bcryptjs + global guard + `@CurrentUser`) | ✅ M2 |
| Storage: MinIO/S3 abstraction + local fallback | ✅ |
| Queue: BullMQ producer + consumer | ✅ |
| Worker: transcription provider factory (mock \| whisper) | ✅ M3 — selected via `AI_PROVIDER` |
| Worker: real faster-whisper HTTP service (`infra/whisper/`) | ✅ M3 — code ready, image build pending verify |
| Worker: summary provider factory (mock \| claude) | ✅ M4 — selected via `LLM_PROVIDER` |
| Worker: real Claude LLM summary (tool use + prompt caching + fallback) | ✅ M4 — needs `ANTHROPIC_API_KEY` to enable |
| Mobile: Home / NewMeeting / Recording / Processing / Board / Tracker | ✅ scaffold |
| Mobile: SQLite repos + upload queue | ✅ |
| Mobile: Login screen + secure token storage + axios bearer | ✅ M2 |
| Mobile: native foreground recorder (local Expo Module, Kotlin) | ✅ M5 — code ready, requires `npx expo prebuild` + device test |
| Mobile: chunk rotation via `MediaRecorder.setNextOutputFile()` (gapless) | ✅ M5 — Android 8+ |

End-to-end smoke test on a real Android device (M1) and Phase 5 official
export (M6) are the remaining cut-line items before field test. See
[the development plan](#) — the working plan was: M2 → M5 → M3 → M4 → M1
→ M6. Currently on M1 / docs catch-up.

## Documents

| File | Purpose |
|---|---|
| [docs/01_PRD.md](docs/01_PRD.md) | Product requirements |
| [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) | System architecture |
| [docs/03_ERD_DATABASE.md](docs/03_ERD_DATABASE.md) | Database design |
| [docs/04_API_SPEC.md](docs/04_API_SPEC.md) | REST API spec |
| [docs/05_MOBILE_SPEC.md](docs/05_MOBILE_SPEC.md) | Mobile app spec |
| [docs/06_AI_WORKFLOW.md](docs/06_AI_WORKFLOW.md) | AI pipeline + JSON schema |
| [docs/07_ROADMAP.md](docs/07_ROADMAP.md) | Phased roadmap |
| [docs/08_QA_TEST_PLAN.md](docs/08_QA_TEST_PLAN.md) | QA cases |
| [docs/09_SECURITY_PRIVACY.md](docs/09_SECURITY_PRIVACY.md) | Security & consent |
| [docs/10_RUNBOOK.md](docs/10_RUNBOOK.md) | Local dev runbook |
| [prompts/summary-prompts.md](prompts/summary-prompts.md) | Thai prompt templates |

## License

Internal / unpublished. Update before public release.
