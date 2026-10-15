import React, { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { saveEntity } from '../api';

export function HRScreen({ ws, data, onData }: { ws: string; data: any; onData: (d: any) => void }) {
  const employees: any[] = data?.employees ?? [];
  const leave: any[] = data?.leave ?? [];
  const [who, setWho] = useState('');
  const [days, setDays] = useState('');
  const [msg, setMsg] = useState('');

  async function requestLeave() {
    if (!who.trim()) return;
    try {
      const req = { id: `lv-${Date.now()}`, employee: who.trim(), days: Number(days) || 1, status: 'pending', createdAt: new Date().toISOString() };
      const next = [req, ...leave];
      await saveEntity(ws, 'leave', next, data?.versions?.leave);
      onData({ ...data, leave: next });
      setWho('');
      setDays('');
      setMsg('Leave request saved.');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Directory ({employees.length})</Text>
      {employees.slice(0, 15).map((e: any, i: number) => (
        <Text key={i} style={styles.item}>• {(e.name ?? `Employee ${i + 1}`).toString()} {(e.role ?? e.title ?? '').toString()}</Text>
      ))}
      <Text style={styles.h}>Time off ({leave.length})</Text>
      {leave.slice(0, 10).map((l: any, i: number) => (
        <Text key={i} style={styles.item}>• {(l.employee ?? l.name ?? '?').toString()} — {String(l.days ?? l.length ?? '?')} day(s) [{(l.status ?? 'pending').toString()}]</Text>
      ))}
      <Text style={styles.h}>Request leave</Text>
      <TextInput style={styles.input} value={who} onChangeText={setWho} placeholder="Employee name" placeholderTextColor="#6B7280" />
      <TextInput style={styles.input} value={days} onChangeText={setDays} placeholder="Days" placeholderTextColor="#6B7280" keyboardType="numeric" />
      <Button title="Save request" onPress={requestLeave} />
      {!!msg && <Text style={styles.hint}>{msg}</Text>}
      <Text style={styles.hint}>Teams live in web HR → Teams; directory here is read-only in v1.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 6 },
  h: { color: '#fff', fontWeight: '700', marginTop: 12, fontSize: 16 },
  item: { color: '#E5E7EB', marginTop: 2 },
  hint: { color: '#9CA3AF', marginTop: 6 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 6 },
});
