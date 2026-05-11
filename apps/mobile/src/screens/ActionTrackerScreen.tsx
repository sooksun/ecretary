import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Rt = RouteProp<RootStackParamList, 'ActionTracker'>;

export default function ActionTrackerScreen() {
  const route = useRoute<Rt>();
  return (
    <ScrollView style={{ backgroundColor: '#020617' }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.title}>งานติดตาม</Text>
        <Text style={styles.muted}>
          Phase 4 จะเชื่อมต่อกับ /action-items และเปิดให้แก้สถานะ/วันส่ง/ผู้รับผิดชอบ
        </Text>
        <Text style={styles.muted}>meetingId: {route.params?.meetingId ?? '—'}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#0f172a', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1e293b' },
  title: { color: '#f1f5f9', fontWeight: '700', fontSize: 16, marginBottom: 6 },
  muted: { color: '#64748b', marginTop: 6 },
});
