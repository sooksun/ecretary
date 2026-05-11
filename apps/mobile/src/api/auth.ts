import { api } from './client';
import type { StoredUser } from '@/services/AuthStorage';

export type LoginResponse = {
  accessToken: string;
  user: StoredUser;
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}
