import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import type {
  NativeChunkReadyEvent,
  NativeRecorderErrorEvent,
  NativeRecorderEventMap,
} from './MSecRecorder.types';

const Native = requireNativeModule('MSecRecorder');
const emitter = new EventEmitter(Native);

export const MSecRecorder = {
  /** Start the foreground recording service. chunkLengthSec rotates output gaplessly. */
  start(chunkLengthSec = 300): Promise<void> {
    return Native.start(chunkLengthSec);
  },
  stop(): Promise<void> {
    return Native.stop();
  },
  pause(): Promise<void> {
    return Native.pause();
  },
  resume(): Promise<void> {
    return Native.resume();
  },
  isRunning(): boolean {
    return Boolean(Native.isRunning());
  },
  addChunkListener(handler: (e: NativeChunkReadyEvent) => void) {
    return emitter.addListener('onChunkReady', handler);
  },
  addStartedListener(handler: () => void) {
    return emitter.addListener('onStarted', handler);
  },
  addStoppedListener(handler: () => void) {
    return emitter.addListener('onStopped', handler);
  },
  addErrorListener(handler: (e: NativeRecorderErrorEvent) => void) {
    return emitter.addListener('onError', handler);
  },
};

export type { NativeChunkReadyEvent, NativeRecorderErrorEvent, NativeRecorderEventMap };
