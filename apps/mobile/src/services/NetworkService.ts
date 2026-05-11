import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useNetwork(): NetInfoState | null {
  const [state, setState] = useState<NetInfoState | null>(null);
  useEffect(() => {
    const unsub = NetInfo.addEventListener(setState);
    NetInfo.fetch().then(setState);
    return () => unsub();
  }, []);
  return state;
}
