import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { AudioRecorderService } from '@/services/AudioRecorderService';
import { chunkRepo } from '@/db/chunkRepo';
import { markerRepo } from '@/db/markerRepo';
import { meetingRepo } from '@/db/meetingRepo';
import { meetingsApi } from '@/api/meetings';
import { MarkerType, MeetingStatus } from '@/types/domain';
import { useNetwork } from '@/services/NetworkService';
import { useDeviceHealth } from '@/services/BatteryStorageMonitor';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Recording'>;
type Rt = RouteProp<RootStackParamList, 'Recording'>;

const MARKER_BUTTONS: { type: MarkerType; label: string; color: string }[] = [
  { type: MarkerType.IMPORTANT, label: '⭐ สำคัญ', color: '#facc15' },
  { type: MarkerType.DECISION, label: '✅ มติ', color: '#22c55e' },
  { type: MarkerType.ACTION, label: '🛠 งาน', color: '#3b82f6' },
  { type: MarkerType.ISSUE, label: '⚠️ ปัญหา', color: '#f97316' },
  { type: MarkerType.QUESTION, label: '❓ คำถาม', color: '#a855f7' },
];

export default function RecordingScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const meetingId = route.params.meetingId;
  const recorder = useRef(new AudioRecorderService({ chunkLengthSec: 300 })).current;
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'stopped'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const network = useNetwork();
  const health = useDeviceHealth();

  useEffect(() => {
    const t = setInterval(() => {
      const s = recorder.getState();
      setState(s.state);
      setElapsed(s.elapsedSec);
      setChunkCount(s.chunkIndex);
    }, 500);
    return () => clearInterval(t);
  }, [recorder]);

  const onStart = async () => {
    try {
      const meeting = await meetingRepo.getById(meetingId);
      if (!meeting) throw new Error('Meeting not found locally');
      await meetingRepo.setStatus(meetingId, MeetingStatus.RECORDING);
      await meetingRepo.setStartedAt(meetingId, new Date().toISOString());
      if (meeting.serverId) {
        await meetingRepo.setPendingSync(meetingId, 'start');
        try {
          await meetingsApi.start(meeting.serverId);
          await meetingRepo.setPendingSync(meetingId, null);
        } catch {
          // UploadQueueService.tick() will retry every 4s
        }
      }
      await recorder.start({
        onChunkReady: async (chunk) => {
          await chunkRepo.insert({
            meetingId,
            chunkIndex: chunk.chunkIndex,
            fileUri: chunk.fileUri,
            durationSec: chunk.durationSec,
            fileSizeBytes: chunk.fileSizeBytes,
            checksumSha256: chunk.checksumSha256,
            startedAtSec: chunk.startedAtSec,
            endedAtSec: chunk.endedAtSec,
          });
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn('[recorder] error', err.message);
        },
      });
    } catch (err) {
      Alert.alert('ไม่สามารถบันทึกได้', (err as Error).message);
    }
  };

  const onStop = async () => {
    await recorder.stop();
    await meetingRepo.setStatus(meetingId, MeetingStatus.UPLOADING);
    await meetingRepo.setEndedAt(meetingId, new Date().toISOString());
    const meeting = await meetingRepo.getById(meetingId);
    if (meeting?.serverId) {
      await meetingRepo.setPendingSync(meetingId, 'end');
      try {
        await meetingsApi.end(meeting.serverId);
        await meetingRepo.setPendingSync(meetingId, null);
      } catch {
        // UploadQueueService.tick() will retry every 4s
      }
    }
    nav.replace('Processing', { meetingId });
  };

  const onMarker = async (type: MarkerType) => {
    await markerRepo.add({ meetingId, markerType: type, timestampSec: elapsed });
  };

  const elapsedLabel = useMemo(() => formatDuration(elapsed), [elapsed]);

  return (
    <View style={styles.root}>
      <View style={[styles.statusBadge, { backgroundColor: state === 'recording' ? '#dc2626' : '#475569' }]}>
        <Text style={styles.statusText}>{state === 'recording' ? '● กำลังบันทึก' : 'พร้อมบันทึก'}</Text>
      </View>

      <Text style={styles.timer}>{elapsedLabel}</Text>
      <Text style={styles.chunk}>chunk #{chunkCount}</Text>

      <View style={styles.statsRow}>
        <Stat label="Network" value={network?.isConnected ? 'Online' : 'Offline'} ok={Boolean(network?.isConnected)} />
        <Stat
          label="Battery"
          value={health ? `${Math.round(health.batteryLevel * 100)}%` : '—'}
          ok={(health?.batteryLevel ?? 1) > 0.2}
        />
        <Stat
          label="Storage"
          value={health ? `${(health.freeStorageBytes / 1e9).toFixed(1)}GB` : '—'}
          ok={(health?.freeStorageBytes ?? 0) > 1e9}
        />
      </View>

      {state === 'recording' && (
        <View style={styles.markerRow}>
          {MARKER_BUTTONS.map((m) => (
            <Pressable
              key={m.type}
              onPress={() => onMarker(m.type)}
              style={[styles.marker, { borderColor: m.color }]}
            >
              <Text style={[styles.markerText, { color: m.color }]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ flex: 1 }} />

      {state !== 'recording' && state !== 'paused' && (
        <Pressable onPress={onStart} style={[styles.cta, { backgroundColor: '#dc2626' }]}>
          <Text style={styles.ctaText}>● เริ่มบันทึก</Text>
        </Pressable>
      )}
      {(state === 'recording' || state === 'paused') && (
        <Pressable onPress={onStop} style={[styles.cta, { backgroundColor: '#475569' }]}>
          <Text style={styles.ctaText}>■ หยุดบันทึก</Text>
        </Pressable>
      )}
    </View>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: ok ? '#22c55e' : '#f97316' }]}>{value}</Text>
    </View>
  );
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#020617' },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  statusText: { color: '#f8fafc', fontWeight: '600' },
  timer: { color: '#f1f5f9', fontSize: 56, fontWeight: '300', textAlign: 'center', marginTop: 24 },
  chunk: { color: '#64748b', textAlign: 'center', marginBottom: 24 },
  statsRow: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, backgroundColor: '#0f172a', padding: 12, borderRadius: 10, borderColor: '#1e293b', borderWidth: 1 },
  statLabel: { color: '#94a3b8', fontSize: 12 },
  statValue: { fontSize: 18, fontWeight: '600', marginTop: 4 },
  markerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 },
  marker: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  markerText: { fontWeight: '600' },
  cta: { padding: 18, borderRadius: 12, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
