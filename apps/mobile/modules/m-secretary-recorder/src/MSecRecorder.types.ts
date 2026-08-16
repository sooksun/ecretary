export interface NativeChunkReadyEvent {
  fileUri: string;
  chunkIndex: number;
  startedAtSec: number;
  endedAtSec: number;
  durationSec: number;
  fileSizeBytes: number;
  checksumSha256?: string;
}

export interface NativeRecorderErrorEvent {
  message: string;
}

/**
 * iOS encoder report. `applicableBitRates` is the set AAC-LC actually accepts
 * for `outputSampleRate` at mono — requesting a value outside it is what made
 * the earlier gapless attempt fail with AVFoundationErrorDomain -11861.
 */
export interface RecorderDiagnostics {
  environment: 'simulator' | 'device';
  osVersion: string;
  sessionSampleRate: number;
  inputSampleRate: number;
  inputChannels: number;
  outputSampleRate: number;
  applicableBitRates: number[];
  desiredBitRate: number;
  selectedBitRate: number;
  desiredBitRateSupported: boolean;
  continuousCaptureSupported: boolean;
}

export type NativeRecorderEventMap = {
  onStarted: Record<string, never>;
  onStopped: Record<string, never>;
  onChunkReady: NativeChunkReadyEvent;
  onError: NativeRecorderErrorEvent;
};
