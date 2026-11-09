import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

export function OverviewScreen({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <ActivityIndicator style={{ marginTop: 30 }} />;
  if (!data) return <Text style={styles.hint}>Select a workspace to load overview.</Text>;
  const kpis: any[] = data.kpis ?? [];
  const tasks: any[] = data.tasks ?? [];
  const leads: any[] = data.leads ?? [];
  const invoices: any[] = data.invoices ?? [];
  const agents: any[] = data.agents ?? [];
  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'completed').length;
  const totalInvoiced = invoices.reduce((s, i) => s + (Number(i.total) || Number(i.amount) || 0), 0);

  return (
    <ScrollView contentContainerStyle={styles.col}>
      <View style={styles.row}>
        <Stat label="KPIs" value={String(kpis.length)} />
        <Stat label="Open tasks" value={String(openTasks)} />
        <Stat label="Leads" value={String(leads.length)} />
      </View>
      <View style={styles.row}>
        <Stat label="Invoices" value={String(invoices.length)} />
        <Stat label="Invoiced" value={String(Math.round(totalInvoiced))} />
        <Stat label="Agents" value={String(agents.length)} />
      </View>
      <Text style={styles.h}>KPI groups</Text>
      {kpis.slice(0, 10).map((k: any, i: number) => (
        <Text key={i} style={styles.item}>
          • {k.name ?? k.title ?? `Group ${i + 1}`} ({(k.kpis ?? k.items ?? []).length} KPIs)
        </Text>
      ))}
      {!kpis.length && <Text style={styles.hint}>No KPI groups yet — add them in the web app.</Text>}
      <Text style={styles.h}>Latest tasks</Text>
      {tasks.slice(0, 8).map((t: any, i: number) => (
        <Text key={i} style={styles.item}>
          • {t.title ?? t.name ?? 'Untitled'} [{t.status ?? 'open'}]
        </Text>
      ))}
      {!tasks.length && <Text style={styles.hint}>No tasks yet.</Text>}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statV}>{value}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: '#1F2937', borderRadius: 10, padding: 12, alignItems: 'center' },
  statV: { color: '#fff', fontSize: 20, fontWeight: '700' },
  statL: { color: '#9CA3AF', fontSize: 12 },
  h: { color: '#fff', fontWeight: '700', marginTop: 14, fontSize: 16 },
  item: { color: '#E5E7EB', marginTop: 4 },
  hint: { color: '#9CA3AF', marginTop: 8 },
});
