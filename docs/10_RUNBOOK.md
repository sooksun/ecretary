# 10 RUNBOOK — Local development

## 1. Prereqs

- Node.js ≥ 20
- npm ≥ 9
- Docker Desktop (for Postgres, Redis, MinIO)
- For mobile builds: Android Studio (Android SDK), or Xcode (macOS) for iOS

## 2. Boot infrastructure

```bash
# from the repo root: D:\laragon\www\secretary\m-secretary
cp .env.example .env

# Postgres + Redis + MinIO only (recommended for dev)
docker compose -f infra/docker-compose.yml up -d postgres redis minio

# verify
docker compose -f infra/docker-compose.yml ps
```

MinIO console: http://localhost:9001 (minioadmin / minioadmin) — bucket
`msecretary` is auto-created on first chunk upload.

## 3. Install dependencies

```bash
npm install
```

This installs the workspace root, `packages/shared`, `apps/api`, and
`apps/worker`. The mobile app is **not** in the workspace (Metro bundler
prefers a self-contained tree); install it separately:

```bash
cd apps/mobile
npm install
cd ../..
```

## 4. Database migrate + seed

```bash
npm --workspace @msec/shared run build
npm --workspace @msec/api exec -- prisma generate
npm --workspace @msec/api exec -- prisma migrate dev --name init
npm --workspace @msec/api run prisma:seed
```

You should see something like
`Seeded org=00000000-… user=… meeting=00000000-…-010`.

## 5. Run the API

```bash
npm run dev:api
# → 🟢 API ready on http://localhost:3000/api/v1
```

Smoke-test:

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/meetings
```

## 6. Run the worker

In another terminal:

```bash
npm run dev:worker
```

You should see `🟢 Worker ready` once Redis is reachable.

## 7. Run the mobile app

```bash
cd apps/mobile
cp .env.example .env       # edit EXPO_PUBLIC_API_BASE_URL if needed
npx expo prebuild --clean  # one-time native project generation
npx expo run:android       # or run:ios
```

Android emulator reaches the host API at `http://10.0.2.2:3000/api/v1`
(already the default in `.env.example`). For a real Android device,
replace with your laptop's LAN IP, e.g. `http://192.168.1.21:3000/api/v1`.

## 8. End-to-end smoke test (Phase A)

Once API + worker + mobile are running:

1. Open the mobile app → **Home** → **+ สร้างการประชุมใหม่**.
2. Fill title + meeting type → **เริ่มบันทึกการประชุม**.
3. Tap red record → talk for ~10 minutes (chunks every 5 min).
4. Stop → app shows **Processing** screen.
5. Within seconds the worker generates **mock transcripts + mock summary**.
6. Tap **ดูสรุปการประชุม** → Meeting Board renders the JSON.

## 9. Reset the database

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d postgres redis minio
npm --workspace @msec/api exec -- prisma migrate reset --force
npm --workspace @msec/api run prisma:seed
```

## 10. Common issues

| Symptom | Cause / Fix |
|---|---|
| `prisma generate` fails on Windows | Run from a path without spaces; close other Prisma Studio windows. |
| API → `Connection refused 5432` | `docker compose up -d postgres` and wait for healthy state. |
| Worker stuck in `transcribe.start` | Check `DATABASE_URL` and that you ran `prisma generate`. |
| Mobile cannot reach API on real device | Use the LAN IP, not `localhost`. Check Windows firewall allows port 3000. |
| Upload returns 400 "Checksum mismatch" | The mobile fallback path may compute checksum after a re-encode; retry — or omit `checksumSha256`. |
