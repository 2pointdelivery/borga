import React, { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { saveEntity } from '../api';

export function CompanyScreen({ ws, data, onData, workspaces }: { ws: string; data: any; onData: (d: any) => void; workspaces: any[] }) {
  const fundraising: any[] = data?.fundraising ?? [];
  const knowledge: any[] = data?.knowledge ?? [];
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');

  async function addNote() {
    if (!note.trim()) return;
    try {
      const entry = { id: `kb-${Date.now()}`, title: note.trim().slice(0, 80), content: note.trim(), createdAt: new Date().toISOString() };
      const next = [entry, ...knowledge];
      await saveEntity(ws, 'knowledge', next, data?.versions?.knowledge);
      onData({ ...data, knowledge: next });
      setNote('');
      setMsg('Knowledge note saved.');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Workspaces ({workspaces.length})</Text>
      {workspaces.slice(0, 10).map((w: any, i: number) => (
        <Text key={i} style={styles.item}>• {(w.name ?? w.id).toString()}</Text>
      ))}
      <Text style={styles.h}>Fundraising ({fundraising.length})</Text>
      {fundraising.slice(0, 8).map((f: any, i: number) => (
        <Text key={i} style={styles.item}>• {(f.name ?? f.program ?? `Opportunity ${i + 1}`).toString()} {(f.amount ?? f.size ?? '').toString()}</Text>
      ))}
      <Text style={styles.h}>Knowledge base ({knowledge.length})</Text>
      {knowledge.slice(0, 8).map((k: any, i: number) => (
        <Text key={i} style={styles.item}>• {(k.title ?? k.content ?? '').toString().slice(0, 100)}</Text>
      ))}
      <Text style={styles.h}>Add knowledge note</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Fact the AI should know" placeholderTextColor="#6B7280" multiline />
      <Button title="Save note" onPress={addNote} />
      {!!msg && <Text style={styles.hint}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 6 },
  h: { color: '#fff', fontWeight: '700', marginTop: 12, fontSize: 16 },
  item: { color: '#E5E7EB', marginTop: 2 },
  hint: { color: '#9CA3AF', marginTop: 6 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 6, minHeight: 44 },
});
