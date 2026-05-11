# m-secretary-recorder

Local Expo Module — Android-only foreground audio recorder for M-Secretary.

## Why this exists

Phase A used `expo-av` JS-driven chunking. On older Android (8/10/12), the
JS event loop is killed when the screen locks or the app goes background,
which silently truncates meetings. This module owns recording in a real
`Foreground Service` (type=`microphone`) and rotates output files via
`MediaRecorder.setNextOutputFile()` — **gapless** rotation, OS-managed.

## Surface (TypeScript)

```ts
import { MSecRecorder } from 'm-secretary-recorder';

await MSecRecorder.start(300);          // chunkLengthSec
const sub = MSecRecorder.addChunkListener((e) => { ... });
await MSecRecorder.pause();
await MSecRecorder.resume();
await MSecRecorder.stop();
sub.remove();
```

The mobile app does **not** import this module directly — it goes through
`apps/mobile/src/services/AudioRecorderService.ts` which preserves the
Phase A interface (`start({ onChunkReady })`, `stop()`, `pause()`,
`resume()`, `getState()`).

## Audio format

| Param | Value |
|---|---|
| Source | `MIC` |
| Container | MPEG-4 |
| Codec | AAC |
| Sample rate | 16 kHz |
| Channels | mono |
| Bitrate | 64 kbps |

Roughly **480 KB / minute** → a 5-minute chunk is ~2.4 MB. A 90-minute
meeting at 18 chunks fits within the 50 MB / chunk default limit.

## Permissions runtime-requested by JS

- `RECORD_AUDIO` — required, fails loudly if denied
- `POST_NOTIFICATIONS` (Android 13+) — required to show the foreground
  notification; older Androids auto-grant

Manifest declares `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`,
`WAKE_LOCK` (declared in `apps/mobile/app.json`).

## Build / first-run

This module ships uncompiled. Expo autolinking picks it up after prebuild:

```bash
cd apps/mobile
npm install                          # creates node_modules/m-secretary-recorder symlink
npx expo prebuild --clean            # regenerates android/, autolinks the module
npx expo run:android                 # Gradle build + install on device
```

The first build takes longer (Gradle pulls dependencies). Subsequent
incremental builds run from `apps/mobile/android/`.

## Verifying the foreground service

After login + start recording, look for:

1. A persistent notification "M-Secretary — กำลังบันทึกการประชุม"
2. `adb shell dumpsys activity services | grep -i RecordingService` — service in `started` state
3. Lock screen → 5+ minutes → unlock → check `adb shell ls /data/data/com.msecretary.app/files/meetings/` — should see new chunk files appearing every 5 minutes

## Vendor ROM caveats

Xiaomi (MIUI), Oppo (ColorOS), Vivo, Huawei, and some Samsung ROMs
aggressively kill foreground services to save battery, even when the
service holds a wakelock. Mitigations:

1. **First-run UX** must instruct the user to disable battery
   optimization for M-Secretary (`Settings → Apps → M-Secretary →
   Battery → Unrestricted`).
2. **Autostart** permission on Xiaomi/Oppo (separate setting).
3. **Lock the app** in the recents tray (vendor-specific gesture).

These are user-side actions; no app code can bypass vendor restrictions.

## What this module deliberately does NOT do

- **iOS** — out of M5 scope. JS layer throws if `Platform.OS !== 'android'`.
- **Audio preprocessing** — denoise, gain control, VAD all happen
  server-side in the worker (`apps/worker/src/ai/`).
- **Checksum** — the JS-side `AudioRecorderService` computes SHA-256
  after the file is finalized. Keeping it in JS means one path for
  upload-queue resume.
- **Streaming upload** — chunks are flushed atomically; the upload queue
  picks them up after `onChunkReady`.

## Extending

To add a feature (e.g. live audio level meter):

1. Emit a new event from `RecordingService.kt` (Kotlin side).
2. Add it to `Events(...)` in `MSecRecorderModule.kt`.
3. Add a typed `addXxxListener` in `src/index.ts`.
4. Surface it through `AudioRecorderService.ts` if screens need it.
