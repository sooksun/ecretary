import * as Battery from 'expo-battery';
import * as FileSystem from 'expo-file-system';
import { useEffect, useState } from 'react';

export interface DeviceHealth {
  batteryLevel: number;
  freeStorageBytes: number;
}

export function useDeviceHealth(): DeviceHealth | null {
  const [health, setHealth] = useState<DeviceHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [b, free] = await Promise.all([
          Battery.getBatteryLevelAsync(),
          FileSystem.getFreeDiskStorageAsync(),
        ]);
        if (!cancelled) setHealth({ batteryLevel: b, freeStorageBytes: free });
      } catch {
        // ignore
      }
    };
    void tick();
    const t = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return health;
}
