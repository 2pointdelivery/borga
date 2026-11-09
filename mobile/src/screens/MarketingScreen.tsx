import React, { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { saveEntity } from '../api';

export function MarketingScreen({ ws, data, onData }: { ws: string; data: any; onData: (d: any) => void }) {
  const posts: any[] = data?.posts ?? [];
  const ads: any[] = data?.ads ?? [];
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');

  async function saveDraft() {
    if (!draft.trim()) return;
    try {
      const post = { id: `sp-${Date.now()}`, content: draft.trim(), status: 'draft', channel: 'general', createdAt: new Date().toISOString() };
      const next = [post, ...posts];
      await saveEntity(ws, 'posts', next, data?.versions?.posts);
      onData({ ...data, posts: next });
      setDraft('');
      setMsg('Draft saved — schedule it in web Marketing.');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  const spend = ads.reduce((s, a) => s + Number(a.spend ?? 0), 0);
  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Ads ({ads.length}) — spend ${spend.toLocaleString()}</Text>
      {ads.slice(0, 8).map((a: any, i: number) => (
        <Text key={i} style={styles.item}>• {(a.name ?? `Campaign ${i + 1}`).toString()} ${Number(a.spend ?? 0).toLocaleString()} ROAS {(a.roas ?? '-').toString()}</Text>
      ))}
      <Text style={styles.h}>Social posts ({posts.length})</Text>
      {posts.slice(0, 10).map((p: any, i: number) => (
        <Text key={i} style={styles.item}>• [{(p.status ?? 'draft').toString()}] {(p.content ?? '').toString().slice(0, 120)}</Text>
      ))}
      <Text style={styles.h}>New draft</Text>
      <TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="Write post…" placeholderTextColor="#6B7280" multiline />
      <Button title="Save draft" onPress={saveDraft} />
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
