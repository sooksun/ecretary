import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'msec.auth.token';
const USER_KEY = 'msec.auth.user';

export type StoredUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  organizationId: string;
};

export const AuthStorage = {
  async saveSession(token: string, user: StoredUser) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },
  async loadSession(): Promise<{ token: string; user: StoredUser } | null> {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const userRaw = await SecureStore.getItemAsync(USER_KEY);
    if (!token || !userRaw) return null;
    try {
      return { token, user: JSON.parse(userRaw) as StoredUser };
    } catch {
      return null;
    }
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  },
};
