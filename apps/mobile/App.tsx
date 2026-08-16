import React, { createContext, useContext } from 'react';
import { View, ActivityIndicator, StyleSheet, LogBox } from 'react-native';
LogBox.ignoreAllLogs();
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from '@/navigation/RootNavigator';
import { useBootstrap, OrphanedMeeting } from '@/hooks/useBootstrap';

const queryClient = new QueryClient();

interface BootstrapCtx {
  orphanedRecordings: OrphanedMeeting[];
  dismissOrphan: (id: string) => void;
}
export const BootstrapContext = createContext<BootstrapCtx>({
  orphanedRecordings: [],
  dismissOrphan: () => {},
});
export const useBootstrapContext = () => useContext(BootstrapContext);

export default function App() {
  const { ready, orphanedRecordings, dismissOrphan } = useBootstrap();

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color="#f8fafc" size="large" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <BootstrapContext.Provider value={{ orphanedRecordings, dismissOrphan }}>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <RootNavigator />
          <StatusBar style="light" />
        </NavigationContainer>
      </QueryClientProvider>
    </BootstrapContext.Provider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
