import { useEffect, useState } from 'react';
import { getDb } from '@/db/sqlite';
import { uploadQueue } from '@/services/UploadQueueService';
import { useAuthStore } from '@/store/auth';

export function useBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      await getDb();
      await hydrate();
      uploadQueue.start();
      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
      uploadQueue.stop();
    };
  }, [hydrate]);
  return ready;
}
