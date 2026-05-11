import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { meetingRepo } from '@/db/meetingRepo';
import { LocalMeeting } from '@/types/domain';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const [meetings, setMeetings] = React.useState<LocalMeeting[]>([]);

  const refresh = useCallback(async () => {
    const list = await meetingRepo.list();
    setMeetings(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

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
