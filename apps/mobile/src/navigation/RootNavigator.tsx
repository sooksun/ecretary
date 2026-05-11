import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '@/screens/HomeScreen';
import NewMeetingScreen from '@/screens/NewMeetingScreen';
import RecordingScreen from '@/screens/RecordingScreen';
import ProcessingScreen from '@/screens/ProcessingScreen';
import MeetingBoardScreen from '@/screens/MeetingBoardScreen';
import ActionTrackerScreen from '@/screens/ActionTrackerScreen';
import LoginScreen from '@/screens/LoginScreen';
import { useAuthStore } from '@/store/auth';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  NewMeeting: undefined;
  Recording: { meetingId: string };
  Processing: { meetingId: string };
  MeetingBoard: { meetingId: string };
  ActionTracker: { meetingId?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const token = useAuthStore((s) => s.token);
  const isAuthed = Boolean(token);

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f8fafc',
      }}
    >
      {isAuthed ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'M-Secretary' }} />
          <Stack.Screen name="NewMeeting" component={NewMeetingScreen} options={{ title: 'ประชุมใหม่' }} />
          <Stack.Screen name="Recording" component={RecordingScreen} options={{ title: 'บันทึกเสียง' }} />
          <Stack.Screen name="Processing" component={ProcessingScreen} options={{ title: 'กำลังประมวลผล' }} />
          <Stack.Screen name="MeetingBoard" component={MeetingBoardScreen} options={{ title: 'สรุปประชุม' }} />
          <Stack.Screen name="ActionTracker" component={ActionTrackerScreen} options={{ title: 'งานติดตาม' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
