import React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { meetingRepo } from '@/db/meetingRepo';
import { meetingsApi } from '@/api/meetings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Rt = RouteProp<RootStackParamList, 'MeetingBoard'>;

interface BoardData {
  meetingId: string;
  status: string;
  failureReason?: string | null;
  summaryModel?: string | null;
  isMock?: boolean;
  summary: {
    executiveSummary: string;
    keyPoints: { title: string; detail: string }[];
    decisions: { decision: string; rationale?: string | null }[];
    risks: { risk: string; recommendation?: string | null }[];
    pendingQuestions: { question: string }[];
    officialMinutes: { title: string; agendaItems: { agendaNo: string; topic: string; resolution?: string | null }[] };
    qualityCheck: { recommendations: string[] };
  } | null;
  actionItems: { id: string; title: string; assigneeName?: string | null; dueDate?: string | null; status: string }[];
}

export default function MeetingBoardScreen() {
  const route = useRoute<Rt>();
  const meetingId = route.params.meetingId;
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<BoardData | null>({
    queryKey: ['board', meetingId],
    queryFn: async () => {
      const m = await meetingRepo.getById(meetingId);
      if (!m?.serverId) return null;
      return (await meetingsApi.getBoard(m.serverId)) as BoardData;
    },
    refetchInterval: 5_000,
  });

  // Retry mutation — re-enqueues PENDING/FAILED chunks via /process and
  // refetches the board. Once the worker picks up the job, status flips
  // out of FAILED, the banner disappears, failureReason clears server-side.
  const retry = useMutation({
    mutationFn: async () => {
      const m = await meetingRepo.getById(meetingId);
      if (!m?.serverId) throw new Error('ยังไม่มี serverId — ประชุมยังไม่อัปโหลด');
      return meetingsApi.process(m.serverId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', meetingId] });
    },
    onError: (err: Error) => {
      Alert.alert('ประมวลผลใหม่ไม่สำเร็จ', err.message);
    },
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>ยังไม่มีข้อมูลสรุป (กำลังประมวลผล)</Text>
      </View>
    );
  }

  const s = data.summary;

  return (
    <ScrollView style={{ backgroundColor: '#020617' }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.statusBadge}>{data.status}</Text>

      {data.status === 'FAILED' ? (
        <View style={styles.failedBanner}>
          <Text style={styles.failedTitle}>การประมวลผลล้มเหลว</Text>
          <Text style={styles.failedBody}>
            {data.failureReason ?? 'ไม่ทราบสาเหตุ — ตรวจสอบ log ของ worker'}
          </Text>
          <Text style={styles.failedHint}>
            แก้ปัญหา infrastructure (whisper / Anthropic / network) ก่อน แล้วกดปุ่มด้านล่าง
          </Text>
          <Pressable
            style={[styles.retry, retry.isPending && styles.retryDisabled]}
            disabled={retry.isPending}
            onPress={() => retry.mutate()}
          >
            <Text style={styles.retryText}>
              {retry.isPending ? 'กำลังส่งคำขอ...' : 'ประมวลผลใหม่'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {data.isMock ? (
        <View style={styles.mockBanner}>
          <Text style={styles.mockTitle}>⚠ เนื้อหาทดสอบ (mock)</Text>
          <Text style={styles.mockBody}>
            สรุปนี้ไม่ได้มาจากเสียงที่อัด — ระบบใช้ provider ทดสอบ
            {data.summaryModel ? ` (${data.summaryModel})` : ''}
          </Text>
        </View>
      ) : null}

      {!s ? (
        <Text style={styles.muted}>กำลังสร้างสรุป...</Text>
      ) : (
        <>
          <Section title="สรุปย่อ">
            <Text style={styles.body}>{s.executiveSummary}</Text>
          </Section>

          <Section title="ประเด็นสำคัญ">
            {s.keyPoints.map((k, i) => (
              <View key={i} style={styles.bullet}>
                <Text style={styles.bulletTitle}>{k.title}</Text>
                <Text style={styles.body}>{k.detail}</Text>
              </View>
            ))}
          </Section>

          <Section title="มติ">
            {s.decisions.map((d, i) => (
              <View key={i} style={styles.bullet}>
                <Text style={styles.body}>• {d.decision}</Text>
                {d.rationale ? <Text style={styles.muted}>เหตุผล: {d.rationale}</Text> : null}
              </View>
            ))}
          </Section>

          <Section title="งานติดตาม">
            {data.actionItems.map((a) => (
              <View key={a.id} style={styles.bullet}>
                <Text style={styles.body}>☐ {a.title}</Text>
                <Text style={styles.muted}>
                  {a.assigneeName ?? 'ยังไม่ระบุผู้รับผิดชอบ'} · {a.dueDate ?? 'ยังไม่ระบุวันส่ง'} · {a.status}
                </Text>
              </View>
            ))}
          </Section>

          <Section title="ความเสี่ยง">
            {s.risks.map((r, i) => (
              <Text key={i} style={styles.body}>
                ⚠ {r.risk}
                {r.recommendation ? ` — ${r.recommendation}` : ''}
              </Text>
            ))}
          </Section>

          <Section title="คำถามค้าง">
            {s.pendingQuestions.map((q, i) => (
              <Text key={i} style={styles.body}>
                ? {q.question}
              </Text>
            ))}
          </Section>

          <Section title="ตรวจคุณภาพ">
            {s.qualityCheck.recommendations.map((r, i) => (
              <Text key={i} style={styles.muted}>
                • {r}
              </Text>
            ))}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020617' },
  statusBadge: {
    alignSelf: 'flex-start',
    color: '#cbd5e1',
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    marginBottom: 8,
  },
  section: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  sectionTitle: { color: '#22c55e', fontWeight: '700', marginBottom: 8 },
  bullet: { marginBottom: 6 },
  bulletTitle: { color: '#f1f5f9', fontWeight: '600' },
  body: { color: '#cbd5e1', lineHeight: 22 },
  muted: { color: '#64748b' },
  failedBanner: {
    backgroundColor: '#7f1d1d',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  failedTitle: { color: '#fee2e2', fontWeight: '700', marginBottom: 4 },
  failedBody: { color: '#fecaca', lineHeight: 20 },
  failedHint: { color: '#fca5a5', marginTop: 6, fontSize: 12 },
  retry: {
    marginTop: 12,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  retryDisabled: { opacity: 0.6 },
  retryText: { color: '#fef2f2', fontWeight: '700' },
  mockBanner: {
    backgroundColor: '#78350f',
    borderColor: '#fbbf24',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  mockTitle: { color: '#fef3c7', fontWeight: '700', marginBottom: 4 },
  mockBody: { color: '#fde68a', lineHeight: 20 },
});
