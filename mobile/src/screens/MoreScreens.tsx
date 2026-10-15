import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

export function IntegrationsScreen({ data }: { data: any }) {
  const connections: any[] = data?.connections ?? [];
  const toolkits: any[] = data?.toolkits ?? [];
  const mcp: any[] = data?.mcpServers ?? [];
  const installed = toolkits.filter((t) => t.installed).length;
  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Connected apps ({connections.length})</Text>
      {connections.slice(0, 12).map((c: any, i: number) => (
        <Text key={i} style={styles.item}>• {(c.name ?? c.provider ?? `App ${i + 1}`).toString()} [{(c.status ?? 'connected').toString()}]</Text>
      ))}
      {!connections.length && <Text style={styles.hint}>No OAuth connections yet — connect in web Integrations.</Text>}
      <Text style={styles.h}>Composio toolkits ({installed}/{toolkits.length} installed)</Text>
      {toolkits.filter((t) => t.installed).slice(0, 10).map((t: any, i: number) => (
        <Text key={i} style={styles.item}>• {(t.name ?? t.id).toString()}</Text>
      ))}
      <Text style={styles.h}>MCP servers ({mcp.length})</Text>
      {mcp.slice(0, 8).map((m: any, i: number) => (
        <Text key={i} style={styles.item}>• {(m.name ?? m.url ?? `server ${i + 1}`).toString()}</Text>
      ))}
      <Text style={styles.hint}>OAuth must be completed in the web app (browser redirect); mobile shows status.</Text>
    </ScrollView>
  );
}

export function SettingsScreen({ data, baseUrl }: { data: any; baseUrl: string }) {
  const settings: any = data?.settings ?? {};
  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Settings</Text>
      <Text style={styles.item}>Backend: {baseUrl}</Text>
      <Text style={styles.item}>Features: {JSON.stringify(settings.features ?? settings ?? {}).slice(0, 300)}</Text>
      <Text style={styles.item}>Billing: {JSON.stringify(data?.billing ?? {}).slice(0, 300)}</Text>
      <Text style={styles.hint}>Feature toggles + secrets stay web-only (Settings → Features). Mobile respects the same gates (tickets 404 when off).</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 6 },
  h: { color: '#fff', fontWeight: '700', marginTop: 12, fontSize: 16 },
  item: { color: '#E5E7EB', marginTop: 2 },
  hint: { color: '#9CA3AF', marginTop: 6 },
});
