import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { meetingRepo } from '@/db/meetingRepo';
import { chunkRepo } from '@/db/chunkRepo';
import { meetingsApi } from '@/api/meetings';
import { uploadQueue } from '@/services/UploadQueueService';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Processing'>;
type Rt = RouteProp<RootStackParamList, 'Processing'>;

export default function ProcessingScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const meetingId = route.params.meetingId;
  const [local, setLocal] = React.useState({
    LOCAL_ONLY: 0,
    QUEUED: 0,
    UPLOADING: 0,
    UPLOADED: 0,
    FAILED_RETRY: 0,
    FAILED_FINAL: 0,
  });
  const [server, setServer] = React.useState<{
    chunks: { total: number; uploaded: number; transcribed: number; failed: number };
    summaryStatus: string;
  } | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      const tick = async () => {
        const counts = await chunkRepo.countByStatusForMeeting(meetingId);
        setLocal((prev) => ({ ...prev, ...counts }));
        const m = await meetingRepo.getById(meetingId);
        if (m?.serverId) {
          try {
            setServer(await meetingsApi.getStatus(m.serverId));
          } catch {
            // ignore
          }
        }
      };
      void tick();
      const t = setInterval(tick, 4_000);
      return () => clearInterval(t);
    }, [meetingId]),
  );

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Card title="อัปโหลดในเครื่อง">
        <Row label="คิว" value={String(local.QUEUED ?? 0)} />
        <Row label="กำลังส่ง" value={String(local.UPLOADING ?? 0)} />
        <Row label="ส่งสำเร็จ" value={String(local.UPLOADED ?? 0)} />
        <Row label="พยายามใหม่" value={String(local.FAILED_RETRY ?? 0)} />
        <Row label="ล้มเหลว" value={String(local.FAILED_FINAL ?? 0)} />
        <Pressable style={styles.retry} onPress={() => uploadQueue.tick()}>
          <Text style={styles.retryText}>ลองอัปโหลดอีกครั้ง</Text>
        </Pressable>
      </Card>

      <Card title="สถานะบนเซิร์ฟเวอร์">
        {server ? (
          <>
            <Row label="ไฟล์ทั้งหมด" value={String(server.chunks.total)} />
            <Row label="ถอดเสียงแล้ว" value={String(server.chunks.transcribed)} />
            <Row label="ล้มเหลว" value={String(server.chunks.failed)} />
            <Row label="สรุป" value={server.summaryStatus} />
          </>
        ) : (
          <Text style={styles.muted}>รอเชื่อมต่อเซิร์ฟเวอร์...</Text>
        )}
      </Card>

      <Pressable
        style={styles.cta}
        onPress={() => nav.replace('MeetingBoard', { meetingId })}
      >
        <Text style={styles.ctaText}>ดูสรุปการประชุม</Text>
      </Pressable>
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, backgroundColor: '#020617', minHeight: '100%' },
  card: { backgroundColor: '#0f172a', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#1e293b' },
  cardTitle: { color: '#cbd5e1', fontWeight: '700', fontSize: 14, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  rowLabel: { color: '#94a3b8' },
  rowValue: { color: '#f1f5f9', fontWeight: '600' },
  muted: { color: '#64748b' },
  retry: { marginTop: 10, padding: 10, backgroundColor: '#1e293b', borderRadius: 8, alignItems: 'center' },
  retryText: { color: '#cbd5e1' },
  cta: { marginTop: 16, padding: 16, backgroundColor: '#22c55e', borderRadius: 12, alignItems: 'center' },
  ctaText: { color: '#0b1220', fontSize: 16, fontWeight: '700' },
});
