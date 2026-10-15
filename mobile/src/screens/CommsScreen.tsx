import React, { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { sendChat } from '../api';

export function CommsScreen({ ws, data, onData }: { ws: string; data: any; onData: (d: any) => void }) {
  const messages: any[] = data?.messages ?? [];
  const [chatInput, setChatInput] = useState('');
  const [chatReply, setChatReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function askAi() {
    if (!chatInput.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await sendChat(ws, [{ role: 'user', content: chatInput.trim() }]);
      setChatReply(r.reply);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Unified inbox ({messages.length})</Text>
      {messages.slice(0, 15).map((m: any, i: number) => (
        <View key={i} style={styles.msg}>
          <Text style={styles.msgH}>
            {(m.channel ?? m.provider ?? 'message').toString()} • {(m.from ?? m.author ?? 'unknown').toString()}
          </Text>
          <Text style={styles.msgB} numberOfLines={3}>
            {(m.body ?? m.text ?? m.subject ?? JSON.stringify(m)).toString().slice(0, 220)}
          </Text>
        </View>
      ))}
      {!messages.length && <Text style={styles.hint}>Inbox empty — connect email/WhatsApp in web Integrations.</Text>}
      <Text style={styles.h}>Ask Borga AI</Text>
      <TextInput
        style={styles.input}
        value={chatInput}
        onChangeText={setChatInput}
        placeholder="e.g. Summarise my open deals"
        placeholderTextColor="#6B7280"
        multiline
      />
      {busy ? <ActivityIndicator /> : <Button title="Send" onPress={askAi} />}
      {!!chatReply && <Text style={styles.reply}>{chatReply}</Text>}
      {!!error && <Text style={styles.err}>{error}</Text>}
      <Text style={styles.hint}>
        Live chat threads + calls UI lands in Phase 1 polish; inbox data above is live from /api/borga/data.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 8 },
  h: { color: '#fff', fontWeight: '700', marginTop: 10, fontSize: 16 },
  hint: { color: '#9CA3AF', marginTop: 6 },
  msg: { backgroundColor: '#1F2937', borderRadius: 10, padding: 10, marginTop: 6 },
  msgH: { color: '#93C5FD', fontWeight: '600', fontSize: 12 },
  msgB: { color: '#E5E7EB', marginTop: 4 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 6, minHeight: 44 },
  reply: { color: '#E5E7EB', backgroundColor: '#111827', borderRadius: 8, padding: 10, marginTop: 8 },
  err: { color: '#F87171', marginTop: 8 },
});
