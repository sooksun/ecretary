export interface NativeChunkReadyEvent {
  fileUri: string;
  chunkIndex: number;
  startedAtSec: number;
  endedAtSec: number;
  durationSec: number;
  fileSizeBytes: number;
}

export interface NativeRecorderErrorEvent {
  message: string;
}

export type NativeRecorderEventMap = {
  onStarted: Record<string, never>;
  onStopped: Record<string, never>;
  onChunkReady: NativeChunkReadyEvent;
  onError: NativeRecorderErrorEvent;
};
