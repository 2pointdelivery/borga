import React, { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { saveEntity } from '../api';

export function AIPlatformScreen({ ws, data, onData }: { ws: string; data: any; onData: (d: any) => void }) {
  const agents: any[] = data?.agents ?? [];
  const tasks: any[] = data?.tasks ?? [];
  const runs: any[] = data?.agentRuns ?? [];
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');

  async function addTask() {
    if (!title.trim()) return;
    try {
      const task = { id: `t-${Date.now()}`, title: title.trim(), status: 'todo', priority: 'P2', bucket: 'week', createdAt: new Date().toISOString() };
      const next = [task, ...tasks];
      await saveEntity(ws, 'tasks', next, data?.versions?.tasks);
      onData({ ...data, tasks: next });
      setTitle('');
      setMsg('Task queued — agents pick it up via automation.');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Agents ({agents.length})</Text>
      {agents.slice(0, 12).map((a: any, i: number) => (
        <Text key={i} style={styles.item}>• {(a.name ?? `Agent ${i + 1}`).toString()} — {(a.role ?? a.department ?? '').toString().slice(0, 80)}</Text>
      ))}
      <Text style={styles.h}>Planner — tasks ({tasks.length})</Text>
      {tasks.slice(0, 10).map((t: any, i: number) => (
        <Text key={i} style={styles.item}>• {(t.title ?? 'Untitled').toString().slice(0, 100)} [{(t.status ?? 'todo').toString()}]</Text>
      ))}
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="New task for agents…" placeholderTextColor="#6B7280" />
      <Button title="Queue task" onPress={addTask} />
      {!!msg && <Text style={styles.hint}>{msg}</Text>}
      <Text style={styles.h}>Recent runs ({runs.length})</Text>
      {runs.slice(0, 6).map((r: any, i: number) => (
        <Text key={i} style={styles.item}>• {(r.agentName ?? r.goal ?? 'run').toString().slice(0, 100)}</Text>
      ))}
      <Text style={styles.hint}>Full Agent Runner console stays web-only in v1; mobile queues + monitors.</Text>
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
