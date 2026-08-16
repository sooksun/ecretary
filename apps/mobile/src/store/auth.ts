import { create } from 'zustand';
import { AuthStorage, StoredUser } from '@/services/AuthStorage';
import { uploadQueue } from '@/services/UploadQueueService';

type AuthState = {
  token: string | null;
  user: StoredUser | null;
  hydrated: boolean;
  setSession: (token: string, user: StoredUser) => Promise<void>;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  async setSession(token, user) {
    await AuthStorage.saveSession(token, user);
    set({ token, user });
  },
  async hydrate() {
    const session = await AuthStorage.loadSession();
    if (session) set({ token: session.token, user: session.user, hydrated: true });
    else set({ hydrated: true });
  },
  async logout() {
    // Stop the upload poller immediately so in-flight ticks don't fire
    // after auth is cleared and start burning retry counts with 401s.
    uploadQueue.stop();
    await AuthStorage.clear();
    set({ token: null, user: null });
  },
}));
