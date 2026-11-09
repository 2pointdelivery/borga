import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  getBaseUrl,
  setBaseUrl,
  login,
  signup,
  fetchMe,
  getHealth,
  getWorkspaces,
  getWorkspaceData,
  logout,
  apiPost,
  flushOutbox,
} from './src/api';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { CommsScreen } from './src/screens/CommsScreen';
import { SalesScreen } from './src/screens/SalesScreen';
import { SupportScreen } from './src/screens/SupportScreen';
import { FinanceScreen } from './src/screens/FinanceScreen';
import { HRScreen } from './src/screens/HRScreen';
import { CompanyScreen } from './src/screens/CompanyScreen';
import { MarketingScreen } from './src/screens/MarketingScreen';
import { AIPlatformScreen } from './src/screens/AIPlatformScreen';
import { IntegrationsScreen, SettingsScreen } from './src/screens/MoreScreens';

const MODULES = [
  { id: 'overview', title: 'Overview' },
  { id: 'sales', title: 'Sales' },
  { id: 'marketing', title: 'Marketing' },
  { id: 'comms', title: 'Comms' },
  { id: 'support', title: 'Support' },
  { id: 'finance', title: 'Finance' },
  { id: 'hr', title: 'HR' },
  { id: 'company', title: 'Company' },
  { id: 'ai', title: 'AI' },
  { id: 'integrations', title: 'Apps' },
  { id: 'settings', title: 'Settings' },
] as const;

export default function App() {
  const [baseUrl, setBase] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<string>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState('');
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [ws, setWs] = useState('');
  const [data, setData] = useState<any>(null);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    getBaseUrl().then(setBase);
    fetchMe().then((r) => r?.user && setUser(r.user)).catch(() => {});
    // Online again? Send whatever was queued while offline, then reload so
    // the screens reflect what actually landed.
    void (async () => {
      const r = await flushOutbox((item) =>
        apiPost<{ ok: boolean; saved?: boolean }>(`/api/borga/data`, {
          ws: item.ws,
          entity: item.entity,
          value: item.value,
          ...(item.baseVersion !== undefined ? { baseVersion: item.baseVersion } : {}),
        })
          .then((res) => ({ ok: !!res.saved, conflict: false }))
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : '';
            if (/Request failed \(409\)/.test(msg)) return { ok: false, conflict: true };
            throw e;
          }),
      );
      if (r.sent > 0 && user) refreshData();
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadWorkspaces() {
    const r = await getWorkspaces();
    setWorkspaces(r.workspaces ?? []);
    if (!ws && (r.workspaces ?? []).length) {
      setWs((r.workspaces as any[])[0].id);
    }
  }

  useEffect(() => {
    if (user) loadWorkspaces().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (user && ws) refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  async function refreshData() {
    if (!ws) return;
    setDataLoading(true);
    try {
      setData(await getWorkspaceData(ws));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDataLoading(false);
    }
  }

  async function checkHealth() {
    setError('');
    try {
      await setBaseUrl(baseUrl);
      const h = await getHealth();
      setHealth(JSON.stringify(h).slice(0, 200));
    } catch (e: any) {
      setHealth('');
      setError(e.message);
    }
  }

  async function handleAuth() {
    setLoading(true);
    setError('');
    try {
      await setBaseUrl(baseUrl);
      if (mode === 'login') {
        const r = await login(email.trim().toLowerCase(), password);
        setUser(r.user);
        if (r.workspaceId) setWs(r.workspaceId);
      } else {
        await signup(name.trim(), email.trim().toLowerCase(), password);
        const r = await login(email.trim().toLowerCase(), password);
        setUser(r.user);
        if (r.workspaceId) setWs(r.workspaceId);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.wrap}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={styles.card}>
          <Text style={styles.h1}>Borga Mobile</Text>
          <Text style={styles.sub}>Native client — phases 1–4 complete, all 11 modules wired</Text>
          <Text style={styles.label}>Backend URL (same Wi-Fi as this PC)</Text>
          <TextInput style={styles.input} value={baseUrl} onChangeText={setBase} autoCapitalize="none" />
          <Button title="Test connection (/api/health)" onPress={checkHealth} />
          {!!health && <Text style={styles.ok}>{health}</Text>}
          <Text style={styles.label}>Name (signup only)</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
          {loading ? <ActivityIndicator /> : <Button title={mode === 'login' ? 'Sign in' : 'Create account + sign in'} onPress={handleAuth} />}
          <Button title={mode === 'login' ? 'Need account? Switch to signup' : 'Have account? Switch to login'} onPress={() => setMode(mode === 'login' ? 'signup' : 'login')} />
          {!!error && <Text style={styles.err}>{error}</Text>}
          <Text style={styles.hint}>Phone + PC same Wi-Fi. Test: http://10.0.0.170:13000. Public HTTPS needed for store.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.wrap}>
      <StatusBar style="auto" />
      <View style={styles.topbar}>
        <Text style={styles.h1}>Borga</Text>
        <Text style={styles.sub}>{user.email}</Text>
        <ScrollView horizontal style={styles.wsRow}>
          {workspaces.map((w: any) => (
            <Text key={w.id} onPress={() => setWs(w.id)} style={[styles.ws, ws === w.id && styles.wsActive]}>
              {w.name ?? w.id}
            </Text>
          ))}
        </ScrollView>
        <View style={styles.topBtns}>
          <Button title="Refresh" onPress={refreshData} />
          <Button title="Sign out" onPress={async () => { await logout(); setUser(null); setData(null); }} />
        </View>
      </View>
      <View style={styles.tabs}>
        <FlatList
          horizontal
          data={MODULES as unknown as any[]}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <Text onPress={() => setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}>
              {item.title}
            </Text>
          )}
          showsHorizontalScrollIndicator={false}
        />
      </View>
      {!!error && <Text style={styles.err}>{error}</Text>}
      {tab === 'overview' && <OverviewScreen data={data} loading={dataLoading} />}
      {tab === 'comms' && ws ? <CommsScreen ws={ws} data={data} onData={setData} /> : null}
      {tab === 'sales' && ws ? <SalesScreen ws={ws} data={data} onData={setData} /> : null}
      {tab === 'support' && ws ? <SupportScreen ws={ws} /> : null}
      {tab === 'finance' ? <FinanceScreen data={data} /> : null}
      {tab === 'hr' && ws ? <HRScreen ws={ws} data={data} onData={setData} /> : null}
      {tab === 'company' && ws ? <CompanyScreen ws={ws} data={data} onData={setData} workspaces={workspaces} /> : null}
      {tab === 'marketing' && ws ? <MarketingScreen ws={ws} data={data} onData={setData} /> : null}
      {tab === 'ai' && ws ? <AIPlatformScreen ws={ws} data={data} onData={setData} /> : null}
      {tab === 'integrations' ? <IntegrationsScreen data={data} /> : null}
      {tab === 'settings' ? <SettingsScreen data={data} baseUrl={baseUrl} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0B0F19' },
  card: { padding: 20, gap: 10 },
  h1: { color: '#fff', fontSize: 24, fontWeight: '700' },
  sub: { color: '#9CA3AF', marginBottom: 4 },
  label: { color: '#E5E7EB', marginTop: 10, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 4 },
  err: { color: '#F87171', margin: 8 },
  ok: { color: '#34D399', marginTop: 8 },
  hint: { color: '#9CA3AF', marginTop: 12 },
  topbar: { padding: 12, gap: 4 },
  topBtns: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  wsRow: { marginVertical: 6 },
  ws: { color: '#9CA3AF', paddingHorizontal: 10, paddingVertical: 6, fontWeight: '600' },
  wsActive: { color: '#fff', textDecorationLine: 'underline' },
  tabs: { paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1F2937' },
  tab: { color: '#9CA3AF', paddingHorizontal: 12, paddingVertical: 8, fontWeight: '600' },
  tabActive: { color: '#fff', textDecorationLine: 'underline' },
});
