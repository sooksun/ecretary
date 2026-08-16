import axios, { AxiosInstance } from 'axios';
import { Platform } from 'react-native';
import { useAuthStore } from '@/store/auth';

// EXPO_PUBLIC_* vars are baked in at bundle time (see .env / .env.production).
// Fallback: emulator/simulator loopback to the host machine — Android emulator
// reaches the host at 10.0.2.2, iOS simulator shares the host's localhost.
const baseURL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Platform.OS === 'android'
    ? 'http://10.0.2.2:3000/api/v1'
    : 'http://localhost:3000/api/v1');

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err?.response?.status === 401) {
      // token expired or invalid — drop the session so navigator routes to Login
      await useAuthStore.getState().logout();
    }
    throw err;
  },
);
