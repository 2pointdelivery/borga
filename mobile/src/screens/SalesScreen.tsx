import React, { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { saveEntity } from '../api';

export function SalesScreen({ ws, data, onData }: { ws: string; data: any; onData: (d: any) => void }) {
  const leads: any[] = data?.leads ?? [];
  const customers: any[] = data?.customers ?? [];
  const invoices: any[] = data?.invoices ?? [];
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const stages = ['new', 'qualified', 'proposal', 'won', 'lost'];

  async function addLead() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const lead = {
        id: `ld-${Date.now()}`,
        name: name.trim(),
        company: name.trim(),
        value: Number(value) || 0,
        stage: 'new',
        source: 'mobile',
        priority: 'P2',
        createdAt: new Date().toISOString(),
      };
      const next = [lead, ...leads];
      await saveEntity(ws, 'leads', next, data?.versions?.leads);
      onData({ ...data, leads: next });
      setName('');
      setValue('');
      setMsg('Lead added.');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Pipeline ({leads.length})</Text>
      {stages.map((s) => (
        <Text key={s} style={styles.item}>
          {s}: {leads.filter((l) => (l.stage ?? 'new') === s).length}
        </Text>
      ))}
      {leads.slice(0, 10).map((l: any, i: number) => (
        <View key={i} style={styles.card}>
          <Text style={styles.cardT}>{l.name ?? 'Unnamed'} @ {l.company ?? '-'}</Text>
          <Text style={styles.cardS}>
            ${Number(l.value || 0).toLocaleString()} • {l.stage ?? 'new'} • {l.priority ?? ''}
          </Text>
        </View>
      ))}
      <Text style={styles.h}>Add lead</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name / company" placeholderTextColor="#6B7280" />
      <TextInput style={styles.input} value={value} onChangeText={setValue} placeholder="Value (USD)" placeholderTextColor="#6B7280" keyboardType="numeric" />
      <Button title={busy ? 'Saving…' : 'Add lead'} onPress={addLead} disabled={busy} />
      {!!msg && <Text style={styles.hint}>{msg}</Text>}
      <Text style={styles.h}>Customers ({customers.length})</Text>
      {customers.slice(0, 8).map((c: any, i: number) => (
        <Text key={i} style={styles.item}>• {c.name ?? c.company ?? `Customer ${i + 1}`}</Text>
      ))}
      <Text style={styles.h}>Invoices ({invoices.length})</Text>
      {invoices.slice(0, 8).map((v: any, i: number) => (
        <Text key={i} style={styles.item}>
          • {v.number ?? `#${i + 1}`} — {v.client ?? v.customer ?? ''} ${Number(v.total ?? v.amount ?? 0).toLocaleString()} [{v.status ?? 'draft'}]
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 6 },
  h: { color: '#fff', fontWeight: '700', marginTop: 12, fontSize: 16 },
  item: { color: '#E5E7EB', marginTop: 2 },
  hint: { color: '#9CA3AF', marginTop: 6 },
  card: { backgroundColor: '#1F2937', borderRadius: 10, padding: 10, marginTop: 6 },
  cardT: { color: '#fff', fontWeight: '600' },
  cardS: { color: '#9CA3AF', marginTop: 2, fontSize: 12 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 6 },
});
