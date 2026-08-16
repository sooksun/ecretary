import { useEffect, useState } from 'react';
import { getDb } from '@/db/sqlite';
import { uploadQueue } from '@/services/UploadQueueService';
import { useAuthStore } from '@/store/auth';
import { meetingRepo } from '@/db/meetingRepo';

export interface OrphanedMeeting {
  id: string;
  title: string;
}

export interface BootstrapResult {
  ready: boolean;
  orphanedRecordings: OrphanedMeeting[];
  dismissOrphan: (id: string) => void;
}

export function useBootstrap(): BootstrapResult {
  const [ready, setReady] = useState(false);
  const [orphanedRecordings, setOrphanedRecordings] = useState<OrphanedMeeting[]>([]);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await getDb();
      await hydrate();
      uploadQueue.start();

      // Detect meetings left in RECORDING status from a previous app crash.
      // These are surfaced to the user on HomeScreen for a continue-or-end decision.
      const crashed = await meetingRepo.findRecording();
      if (mounted && crashed.length > 0) {
        setOrphanedRecordings(crashed.map((m) => ({ id: m.id, title: m.title })));
      }

      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
      uploadQueue.stop();
    };
  }, [hydrate]);

  const dismissOrphan = (id: string) => {
    setOrphanedRecordings((prev) => prev.filter((m) => m.id !== id));
  };

  return { ready, orphanedRecordings, dismissOrphan };
}
