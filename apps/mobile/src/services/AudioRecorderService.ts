
import { Platform } from 'react-native';
import { PermissionsAndroid } from 'react-native';
import { MSecRecorder, NativeChunkReadyEvent } from 'm-secretary-recorder';
import type { Subscription } from 'expo-modules-core';

export interface ChunkRecorded {
  chunkIndex: number;
  fileUri: string;
  durationSec: number;
  fileSizeBytes: number;
  startedAtSec: number;
  endedAtSec: number;
  checksumSha256?: string;
}

export interface RecorderEvents {
  onChunkReady: (chunk: ChunkRecorded) => Promise<void> | void;
  onError?: (err: Error) => void;
}

/**
 * Phase 1+ AudioRecorderService — delegates to the native foreground
 * recording service (m-secretary-recorder). The native module rotates
 * chunk files every chunkLengthSec via MediaRecorder.setNextOutputFile,
 * which is gapless on Android 8+. JS-side concerns kept here:
 *
 *   - permission prompt (RECORD_AUDIO + POST_NOTIFICATIONS)
 *   - SHA-256 checksum (native could do it, but FS-based reads are
 *     identical to the previous JS recorder, so we keep one path)
 *   - state book-keeping for the UI (elapsedSec / chunkIndex)
 *
 * Both platforms are native now: Android runs a Foreground Service
 * (Kotlin, gapless via setNextOutputFile), iOS runs an AVAudioRecorder
 * engine with stop/restart rotation (ios/MSecRecorderModule.swift).
 * iOS mic permission is requested inside the native start().
 */
export class AudioRecorderService {
  private chunkIndex = 0;
  private elapsedSec = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private events?: RecorderEvents;
  private state: 'idle' | 'recording' | 'paused' | 'stopped' = 'idle';
  private chunkLengthSec: number;
  private subs: Subscription[] = [];

  constructor(opts: { chunkLengthSec?: number } = {}) {
    this.chunkLengthSec = opts.chunkLengthSec ?? 300;
  }

  getState() {
    return { state: this.state, elapsedSec: this.elapsedSec, chunkIndex: this.chunkIndex };
  }

  async start(events: RecorderEvents): Promise<void> {
    if (this.state !== 'idle') throw new Error('Recorder already started');
    this.events = events;
    await this.requestPermissions();

    this.subs.push(
      MSecRecorder.addChunkListener((e) => void this.handleNativeChunk(e)),
      MSecRecorder.addErrorListener((e) =>
        this.events?.onError?.(new Error(e.message ?? 'recorder error')),
      ),
    );

    this.state = 'recording';
    this.chunkIndex = 0;
    this.elapsedSec = 0;
    await MSecRecorder.start(this.chunkLengthSec);

    this.timer = setInterval(() => {
      if (this.state === 'recording') this.elapsedSec += 1;
    }, 1_000);
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') return;
    await MSecRecorder.pause();
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await MSecRecorder.resume();
    this.state = 'recording';
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    // Native AsyncFunction("stop") returns immediately after dispatching the
    // intent — the foreground service still needs to finalize MediaRecorder
    // and emit the final chunkReady. Replace the live listener with a
    // one-shot that resolves once the final chunk's handler has finished
    // (or 5s timeout, in case the service is already idle).
    for (const s of this.subs) s.remove();
    this.subs = [];

    const finalChunk = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      const sub = MSecRecorder.addChunkListener((e) => {
        clearTimeout(timeout);
        sub.remove();
        this.handleNativeChunk(e).finally(() => resolve());
      });
    });

    await MSecRecorder.stop();
    await finalChunk;

    this.state = 'stopped';
  }

  // ── internals ───────────────────────────────────────────

  private async requestPermissions(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      // POST_NOTIFICATIONS is Android 13+; older Androids ignore it
      ('android.permission.POST_NOTIFICATIONS' as unknown) as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS],
    ]);
    const mic = granted['android.permission.RECORD_AUDIO'];
    if (mic !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('ไม่ได้รับสิทธิ์ใช้ไมโครโฟน');
    }
  }

  private async handleNativeChunk(e: NativeChunkReadyEvent): Promise<void> {
    try {
      this.chunkIndex = e.chunkIndex + 1;
      await this.events?.onChunkReady({
        chunkIndex: e.chunkIndex,
        fileUri: e.fileUri,
        durationSec: e.durationSec,
        fileSizeBytes: e.fileSizeBytes,
        startedAtSec: e.startedAtSec,
        endedAtSec: e.endedAtSec,
        checksumSha256: e.checksumSha256,
      });
    } catch (err) {
      this.events?.onError?.(err as Error);
    }
  }
}
