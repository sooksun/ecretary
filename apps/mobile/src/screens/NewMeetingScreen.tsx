import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { meetingRepo } from '@/db/meetingRepo';
import { meetingsApi } from '@/api/meetings';
import { MeetingType } from '@/types/domain';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'NewMeeting'>;

const TYPES: MeetingType[] = [
  MeetingType.GENERAL,
  MeetingType.SCHOOL_ADMIN,
  MeetingType.PLC,
  MeetingType.PROJECT,
  MeetingType.PARENT_MEETING,
  MeetingType.COMMITTEE,
  MeetingType.TRAINING,
  MeetingType.SUPERVISION,
];

export default function NewMeetingScreen() {
  const nav = useNavigation<Nav>();
  const [title, setTitle] = useState('');
  const [meetingType, setMeetingType] = useState<MeetingType>(MeetingType.GENERAL);
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [busy, setBusy] = useState(false);

  const doCreate = async () => {
    setBusy(true);
    try {
      const local = await meetingRepo.create({
        title: title.trim(),
        meetingType,
        location: location.trim() || undefined,
        agendaText: agenda.trim() || undefined,
      });
      // Sync to server (best-effort; recording can begin even if offline)
      try {
        const remote = await meetingsApi.create({
          title: local.title,
          meetingType: local.meetingType,
          location: local.location ?? undefined,
          agendaText: local.agendaText ?? undefined,
        });
        await meetingRepo.setServerId(local.id, remote.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[create-meeting] sync failed, will retry later', err);
      }
      nav.replace('Recording', { meetingId: local.id });
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () => {
    if (!title.trim()) {
      Alert.alert('โปรดระบุชื่อประชุม');
      return;
    }
    Alert.alert(
      'ยืนยันการบันทึกเสียง',
      'แอปจะบันทึกเสียงในห้องประชุม\nผู้เข้าร่วมทุกคนต้องรับทราบและยินยอมก่อน\n\nคุณแจ้งผู้เข้าร่วมทุกคนแล้วใช่หรือไม่?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ยืนยัน — เริ่มบันทึก', onPress: () => void doCreate() },
      ],
    );
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.label}>ชื่อประชุม *</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="เช่น ประชุม PLC ป.1" placeholderTextColor="#475569" />

      <Text style={styles.label}>ประเภท</Text>
      <View style={styles.typeRow}>
        {TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setMeetingType(t)}
            style={[styles.typeChip, meetingType === t && styles.typeChipActive]}
          >
            <Text style={[styles.typeChipText, meetingType === t && styles.typeChipTextActive]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>สถานที่</Text>
      <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholderTextColor="#475569" />

      <Text style={styles.label}>วาระ</Text>
      <TextInput
        style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
        value={agenda}
        onChangeText={setAgenda}
        multiline
        placeholderTextColor="#475569"
      />

      <Pressable
        disabled={busy}
        onPress={onCreate}
        style={[styles.cta, busy && { opacity: 0.5 }]}
      >
        <Text style={styles.ctaText}>{busy ? 'กำลังสร้าง...' : 'เริ่มบันทึกการประชุม'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020617' },
  label: { color: '#cbd5e1', fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 10,
    color: '#f1f5f9',
    padding: 12,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderColor: '#334155',
    borderWidth: 1,
  },
  typeChipActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  typeChipText: { color: '#cbd5e1', fontSize: 12 },
  typeChipTextActive: { color: '#0b1220', fontWeight: '700' },
  cta: { marginTop: 32, padding: 16, borderRadius: 12, backgroundColor: '#22c55e', alignItems: 'center' },
  ctaText: { color: '#0b1220', fontWeight: '700', fontSize: 16 },
});
