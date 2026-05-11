import axios, { AxiosInstance } from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '@/store/auth';

const baseURL =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string })?.apiBaseUrl ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  'http://10.0.2.2:3000/api/v1'; // Android emulator → host

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
