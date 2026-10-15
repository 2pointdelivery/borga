import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createTicket, getTickets } from '../api';

export function SupportScreen({ ws }: { ws: string }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await getTickets(ws);
      setTickets(r.tickets ?? []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [ws]);

  async function add() {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      const r = await createTicket(ws, { subject: subject.trim(), description: desc.trim(), priority: 'medium' });
      if (r.ticket) setTickets((t) => [r.ticket, ...t]);
      setSubject('');
      setDesc('');
      setMsg('Ticket created.');
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Tickets ({tickets.length})</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        tickets.slice(0, 20).map((t: any, i: number) => (
          <View key={i} style={styles.card}>
            <Text style={styles.cardT}>{t.id ?? `#${i + 1}`} — {t.subject ?? 'No subject'}</Text>
            <Text style={styles.cardS}>
              {(t.status ?? 'open').toString()} • {(t.priority ?? 'medium').toString()} • {(t.assignee ?? 'unassigned').toString()}
            </Text>
          </View>
        ))
      )}
      {!loading && !tickets.length && <Text style={styles.hint}>No tickets yet.</Text>}
      <Button title="Refresh" onPress={load} />
      <Text style={styles.h}>New ticket</Text>
      <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor="#6B7280" />
      <TextInput style={styles.input} value={desc} onChangeText={setDesc} placeholder="Description" placeholderTextColor="#6B7280" multiline />
      <Button title={busy ? 'Creating…' : 'Create ticket'} onPress={add} disabled={busy} />
      {!!msg && <Text style={styles.hint}>{msg}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 6 },
  h: { color: '#fff', fontWeight: '700', marginTop: 12, fontSize: 16 },
  hint: { color: '#9CA3AF', marginTop: 6 },
  card: { backgroundColor: '#1F2937', borderRadius: 10, padding: 10, marginTop: 6 },
  cardT: { color: '#fff', fontWeight: '600' },
  cardS: { color: '#9CA3AF', marginTop: 2, fontSize: 12 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 6 },
});
