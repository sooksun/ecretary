import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { login as apiLogin } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('admin@msecretary.local');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);

  async function onSubmit() {
    if (!email || !password) {
      Alert.alert('กรอกข้อมูลไม่ครบ', 'ใส่อีเมลและรหัสผ่าน');
      return;
    }
    setBusy(true);
    try {
      const res = await apiLogin(email.trim(), password);
      await setSession(res.accessToken, res.user);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'เข้าสู่ระบบไม่สำเร็จ';
      Alert.alert('เข้าสู่ระบบไม่สำเร็จ', msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>M-Secretary</Text>
      <Text style={styles.subtitle}>เข้าสู่ระบบ</Text>

      <Text style={styles.label}>อีเมล</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
      />

      <Text style={styles.label}>รหัสผ่าน</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />

      <Pressable
        onPress={onSubmit}
        disabled={busy}
        style={({ pressed }) => [styles.btn, (busy || pressed) && styles.btnPressed]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>เข้าสู่ระบบ</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', padding: 24, justifyContent: 'center' },
  title: { color: '#f8fafc', fontSize: 32, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#94a3b8', fontSize: 16, textAlign: 'center', marginBottom: 32 },
  label: { color: '#cbd5e1', fontSize: 14, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  btn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  btnPressed: { opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
