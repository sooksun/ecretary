# msecretary-mobile

React Native + Expo Dev Client app.

## Run (Android)

```bash
cd apps/mobile
cp .env.example .env
npm install
# point EXPO_PUBLIC_API_BASE_URL at the API
npx expo prebuild --clean
npx expo run:android
```

## Architecture

```
src/
├── api/              REST clients (meetings, chunks)
├── db/               expo-sqlite repositories (meeting, chunk, marker)
├── services/
│   ├── AudioRecorderService.ts   chunked audio recorder (expo-av — Phase A)
│   ├── UploadQueueService.ts     polling uploader with backoff
│   ├── NetworkService.ts         NetInfo hook
│   └── BatteryStorageMonitor.ts  device health hook
├── navigation/       react-navigation stack
├── screens/          Home / NewMeeting / Recording / Processing / Board / Tracker
├── hooks/            useBootstrap (DB + uploader)
└── types/            domain types (mirror of @msec/shared)
```

## Phase A scope vs production

`AudioRecorderService` is JS-driven (expo-av). For reliable background
recording on old Android we will swap it for a native foreground-service
module in Bare RN. The **interface stays the same**, so the screens won't
need to change.

## Key flows

1. **Create meeting** → local row + best-effort sync to server
2. **Record** → `expo-av` produces chunks every 5 min → SQLite + queue
3. **Uploader** → polls every 4 s, exponential backoff up to 6 retries
4. **Processing** → polls server status until summary ready
5. **Meeting Board** → renders `/meetings/:id/board` JSON
