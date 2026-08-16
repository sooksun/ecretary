import React, { useCallback, useEffect } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { meetingRepo } from '@/db/meetingRepo';
import { meetingsApi } from '@/api/meetings';
import { MeetingStatus, LocalMeeting } from '@/types/domain';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useBootstrapContext } from '../../App';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

/** Statuses the backend will never move away from — nothing left to poll for. */
const TERMINAL: string[] = [
  MeetingStatus.READY,
  MeetingStatus.FAILED,
  MeetingStatus.ARCHIVED,
];

/** How often to re-check the server while a meeting is still being processed. */
const POLL_MS = 10_000;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const [meetings, setMeetings] = React.useState<LocalMeeting[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const { orphanedRecordings, dismissOrphan } = useBootstrapContext();

  /**
   * The list rows come from SQLite, which only knows what this device did.
   * Everything after upload happens server-side, so without this a card sits at
   * UPLOADING forever even though the meeting is already READY.
   *
   * Returns true when at least one row changed. Network failures are swallowed
   * on purpose — this screen stays usable offline on the local rows.
   */
  const syncFromServer = useCallback(async (local: LocalMeeting[]): Promise<boolean> => {
    const known = new Set(
      local.filter((m) => m.serverId).map((m) => m.serverId as string),
    );
    if (known.size === 0) return false;
    try {
      const { items } = await meetingsApi.list({ limit: 100 });
      const byServerId: Record<string, string> = {};
      for (const it of items) {
        if (known.has(it.id)) byServerId[it.id] = it.status;
      }
      return (await meetingRepo.applyServerStatuses(byServerId)) > 0;
    } catch {
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    const list = await meetingRepo.list();
    setMeetings(list);
    if (await syncFromServer(list)) {
      setMeetings(await meetingRepo.list());
    }
  }, [syncFromServer]);

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const tick = async () => {
        const list = await meetingRepo.list();
        if (cancelled) return;
        setMeetings(list);
        // Only hit the network while something is still in flight — once every
        // synced meeting is READY/FAILED there is nothing left to learn.
        const inFlight = list.some((m) => m.serverId && !TERMINAL.includes(m.status));
        if (!inFlight) return;
        const changed = await syncFromServer(list);
        if (cancelled || !changed) return;
        setMeetings(await meetingRepo.list());
      };

      void tick();
      const timer = setInterval(() => void tick(), POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [syncFromServer]),
  );

  // Prompt user for each meeting that was left in RECORDING after a crash.
  useEffect(() => {
    if (orphanedRecordings.length === 0) return;
    // Prompt for one at a time; the effect re-runs as each is dismissed.
    const [orphan] = orphanedRecordings;
    void (async () => {
      await new Promise<void>((resolve) => {
        Alert.alert(
          'การประชุมค้างอยู่',
          `พบการประชุม "${orphan.title}" ที่กำลังบันทึกอยู่ก่อนแอปปิด\nต้องการทำอะไรกับการประชุมนี้?`,
          [
            {
              text: 'บันทึกต่อ',
              onPress: () => {
                dismissOrphan(orphan.id);
                nav.navigate('Recording', { meetingId: orphan.id });
                resolve();
              },
            },
            {
              text: 'สิ้นสุดการประชุม',
              style: 'destructive',
              onPress: async () => {
                await meetingRepo.setStatus(orphan.id, MeetingStatus.UPLOADING);
                await meetingRepo.setEndedAt(orphan.id, new Date().toISOString());
                dismissOrphan(orphan.id);
                await refresh();
                resolve();
              },
            },
          ],
          { cancelable: false },
        );
      });
    })();
  }, [orphanedRecordings, dismissOrphan, nav, refresh]);

  return (
    <View style={styles.root}>
      <Pressable style={styles.cta} onPress={() => nav.navigate('NewMeeting')}>
        <Text style={styles.ctaText}>+ สร้างการประชุมใหม่</Text>
      </Pressable>

      <Text style={styles.section}>ประชุมล่าสุด</Text>
      <FlatList
        data={meetings}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => nav.navigate('MeetingBoard', { meetingId: item.id })}
          >
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemMeta}>
              {item.meetingType} · {item.status}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีประชุม</Text>}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor="#94a3b8"
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: '#020617' },
  cta: {
    backgroundColor: '#22c55e',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  ctaText: { color: '#0b1220', fontWeight: '700', fontSize: 16 },
  section: { color: '#cbd5e1', fontSize: 13, marginBottom: 8, fontWeight: '600' },
  item: {
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  itemTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  itemMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
});
