import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

export function FinanceScreen({ data }: { data: any }) {
  const finance: any[] = data?.finance ?? [];
  const journals: any[] = data?.journals ?? [];
  const bankTxns: any[] = data?.bankTxns ?? [];
  const bankAccounts: any[] = data?.bankAccounts ?? [];
  const invoices: any[] = data?.invoices ?? [];
  const bills: any[] = data?.bills ?? [];
  const income = finance.filter((f) => Number(f.amount) > 0).reduce((s, f) => s + Number(f.amount), 0);
  const spend = finance.filter((f) => Number(f.amount) < 0).reduce((s, f) => s + Math.abs(Number(f.amount)), 0);
  return (
    <ScrollView contentContainerStyle={styles.col}>
      <Text style={styles.h}>Finance</Text>
      <Text style={styles.item}>Income: ${income.toLocaleString()} • Spend: ${spend.toLocaleString()} • Net: ${(income - spend).toLocaleString()}</Text>
      <Text style={styles.item}>Ledger entries: {finance.length} • Journal: {journals.length}</Text>
      <Text style={styles.item}>Bank accounts: {bankAccounts.length} • Transactions: {bankTxns.length}</Text>
      <Text style={styles.item}>Invoices: {invoices.length} • Bills: {bills.length}</Text>
      <Text style={styles.h}>Latest entries</Text>
      {finance.slice(0, 12).map((f: any, i: number) => (
        <Text key={i} style={styles.item}>• {(f.date ?? f.createdAt ?? '').toString().slice(0, 10)} {(f.description ?? f.memo ?? 'entry').toString().slice(0, 60)} {Number(f.amount ?? 0).toLocaleString()}</Text>
      ))}
      {!finance.length && <Text style={styles.hint}>No ledger entries yet — import in web Banking.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  col: { padding: 16, gap: 6 },
  h: { color: '#fff', fontWeight: '700', marginTop: 12, fontSize: 16 },
  item: { color: '#E5E7EB', marginTop: 2 },
  hint: { color: '#9CA3AF', marginTop: 6 },
});
