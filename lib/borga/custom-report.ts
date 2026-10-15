/**
 * User-built tabular reports: pick a dataset, the columns, filters and an
 * optional grouping. Pure (registry + execution), so the dashboard builder,
 * the CSV export and the shared-link page all render byte-identical rows.
 * Field accessors are plain object reads; every dynamic value is escaped by
 * the renderers, never here.
 */

export type ReportFieldType = 'text' | 'money' | 'number' | 'date' | 'status';

export interface ReportField {
  key: string;
  label: string;
  type: ReportFieldType;
  get: (row: Record<string, unknown>) => string | number;
}

export type ReportDatasetId = 'invoices' | 'bills' | 'leads' | 'customers' | 'tickets' | 'tasks';

export interface ReportDataset {
  id: ReportDatasetId;
  label: string;
  /** Entity name in the store / persistence. */
  entity: string;
  fields: ReportField[];
}

const s = (row: Record<string, unknown>, k: string): string => (typeof row[k] === 'string' ? (row[k] as string) : row[k] == null ? '' : String(row[k]));
const n = (row: Record<string, unknown>, k: string): number => (typeof row[k] === 'number' ? (row[k] as number) : Number(row[k]) || 0);

export const REPORT_DATASETS: ReportDataset[] = [
  {
    id: 'invoices', label: 'Invoices', entity: 'invoices',
    fields: [
      { key: 'number', label: 'Number', type: 'text', get: (r) => s(r, 'number') },
      { key: 'client', label: 'Client', type: 'text', get: (r) => s(r, 'client') },
      { key: 'amount', label: 'Amount', type: 'money', get: (r) => n(r, 'amount') },
      { key: 'status', label: 'Status', type: 'status', get: (r) => s(r, 'status') },
      { key: 'issued', label: 'Issued', type: 'date', get: (r) => s(r, 'issued') },
      { key: 'due', label: 'Due', type: 'date', get: (r) => s(r, 'due') },
    ],
  },
  {
    id: 'bills', label: 'Bills (Vendors & AP)', entity: 'bills',
    fields: [
      { key: 'number', label: 'Number', type: 'text', get: (r) => s(r, 'number') },
      { key: 'vendorName', label: 'Vendor', type: 'text', get: (r) => s(r, 'vendorName') },
      { key: 'amount', label: 'Amount', type: 'money', get: (r) => n(r, 'amount') },
      { key: 'status', label: 'Status', type: 'status', get: (r) => s(r, 'status') },
      { key: 'received', label: 'Received', type: 'date', get: (r) => s(r, 'received') },
      { key: 'due', label: 'Due', type: 'date', get: (r) => s(r, 'due') },
    ],
  },
  {
    id: 'leads', label: 'Leads (pipeline)', entity: 'leads',
    fields: [
      { key: 'name', label: 'Name', type: 'text', get: (r) => s(r, 'name') },
      { key: 'company', label: 'Company', type: 'text', get: (r) => s(r, 'company') },
      { key: 'value', label: 'Deal value', type: 'money', get: (r) => n(r, 'value') },
      { key: 'stage', label: 'Stage', type: 'status', get: (r) => s(r, 'stage') },
      { key: 'source', label: 'Source', type: 'text', get: (r) => s(r, 'source') },
      { key: 'createdAt', label: 'Captured', type: 'date', get: (r) => s(r, 'createdAt').slice(0, 10) },
    ],
  },
  {
    id: 'customers', label: 'Customer accounts', entity: 'customers',
    fields: [
      { key: 'name', label: 'Account', type: 'text', get: (r) => s(r, 'name') },
      { key: 'industry', label: 'Industry', type: 'text', get: (r) => s(r, 'industry') },
      { key: 'status', label: 'Status', type: 'status', get: (r) => s(r, 'status') },
      { key: 'owner', label: 'Owner', type: 'text', get: (r) => s(r, 'owner') },
      { key: 'country', label: 'Country', type: 'text', get: (r) => s(r, 'country') },
    ],
  },
  {
    id: 'tickets', label: 'Support tickets', entity: 'tickets',
    fields: [
      { key: 'id', label: 'Ticket', type: 'text', get: (r) => s(r, 'id') },
      { key: 'subject', label: 'Subject', type: 'text', get: (r) => s(r, 'subject') },
      { key: 'priority', label: 'Priority', type: 'status', get: (r) => s(r, 'priority') },
      { key: 'status', label: 'Status', type: 'status', get: (r) => s(r, 'status') },
      { key: 'assignee', label: 'Assignee', type: 'text', get: (r) => s(r, 'assignee') },
    ],
  },
  {
    id: 'tasks', label: 'Tasks', entity: 'tasks',
    fields: [
      { key: 'title', label: 'Title', type: 'text', get: (r) => s(r, 'title') },
      { key: 'status', label: 'Status', type: 'status', get: (r) => s(r, 'status') },
      { key: 'priority', label: 'Priority', type: 'status', get: (r) => s(r, 'priority') },
      { key: 'assignee', label: 'Assignee', type: 'text', get: (r) => s(r, 'assignee') },
      { key: 'bucket', label: 'Bucket', type: 'text', get: (r) => s(r, 'bucket') },
    ],
  },
];

export function datasetOf(id: string): ReportDataset | null {
  return REPORT_DATASETS.find((d) => d.id === id) ?? null;
}

export type ReportFilterOp = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';

export interface ReportFilter {
  field: string;
  op: ReportFilterOp;
  value: string;
}

export interface CustomReport {
  id: string;
  name: string;
  dataset: ReportDatasetId;
  /** Field keys shown, in order. Empty falls back to every field. */
  columns: string[];
  filters: ReportFilter[];
  /** Optional grouping field: one row per value with count + money sum. */
  groupBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportResult {
  columns: Array<{ key: string; label: string; type: ReportFieldType }>;
  rows: Array<Array<string | number>>;
  /** When grouped: { value, count, sum } rows instead of record rows. */
  groups?: Array<{ value: string; count: number; sum: number }>;
  totals?: { count: number; sum: number };
  rowCount: number;
}

function fieldOf(ds: ReportDataset, key: string): ReportField | null {
  return ds.fields.find((f) => f.key === key) ?? null;
}

function matches(f: ReportFilter, ds: ReportDataset, row: Record<string, unknown>): boolean {
  const field = fieldOf(ds, f.field);
  if (!field) return true; // unknown field never filters anything out
  const raw = field.get(row);
  const want = f.value.trim();
  if (field.type === 'money' || field.type === 'number') {
    const a = Number(raw);
    const b = Number(want);
    if (!Number.isFinite(b)) return true;
    if (f.op === 'greater_than') return a > b;
    if (f.op === 'less_than') return a < b;
    if (f.op === 'equals') return a === b;
    if (f.op === 'not_equals') return a !== b;
    return true;
  }
  const a = String(raw).toLowerCase();
  const w = want.toLowerCase();
  if (f.op === 'equals') return a === w;
  if (f.op === 'not_equals') return a !== w;
  if (f.op === 'contains') return w === '' || a.includes(w);
  return true;
}

/** Run a custom report over dataset rows. Grouping aggregates count + the first money column. */
export function runCustomReport(report: CustomReport, rows: Array<Record<string, unknown>>): ReportResult {
  const ds = datasetOf(report.dataset);
  if (!ds) return { columns: [], rows: [], rowCount: 0 };
  const columns = (report.columns.length ? report.columns : ds.fields.map((f) => f.key))
    .map((k) => fieldOf(ds, k))
    .filter((f): f is ReportField => !!f)
    .map((f) => ({ key: f.key, label: f.label, type: f.type }));
  const filtered = rows.filter((row) => (report.filters ?? []).every((f) => matches(f, ds, row)));

  if (report.groupBy) {
    const gField = fieldOf(ds, report.groupBy);
    if (gField) {
      const moneyKey = ds.fields.find((f) => f.type === 'money')?.key;
      const buckets = new Map<string, { count: number; sum: number }>();
      for (const row of filtered) {
        const value = String(gField.get(row) || '—');
        const b = buckets.get(value) ?? { count: 0, sum: 0 };
        b.count++;
        if (moneyKey) b.sum += Number(fieldOf(ds, moneyKey)?.get(row) ?? 0) || 0;
        buckets.set(value, b);
      }
      const groups = [...buckets.entries()]
        .map(([value, b]) => ({ value, ...b }))
        .sort((x, y) => y.count - x.count);
      return {
        columns: [{ key: report.groupBy, label: gField.label, type: gField.type }],
        rows: [],
        groups,
        totals: { count: filtered.length, sum: groups.reduce((s2, g) => s2 + g.sum, 0) },
        rowCount: groups.length,
      };
    }
  }

  const out = filtered.map((row) => columns.map((c) => fieldOf(ds, c.key)!.get(row)));
  const moneyKey = columns.find((c) => c.type === 'money')?.key;
  return {
    columns,
    rows: out.slice(0, 500),
    totals: moneyKey
      ? { count: filtered.length, sum: filtered.reduce((s2, row) => s2 + (Number(fieldOf(ds, moneyKey)?.get(row) ?? 0) || 0), 0) }
      : { count: filtered.length, sum: 0 },
    rowCount: out.length,
  };
}

export function validateCustomReport(r: Partial<CustomReport>): string[] {
  const errors: string[] = [];
  if (!r.name || !r.name.trim()) errors.push('Name the report.');
  else if (r.name.trim().length > 80) errors.push('The name is too long (80 characters).');
  if (!datasetOf(r.dataset ?? '')) errors.push('Pick a dataset.');
  const ds = datasetOf(r.dataset ?? '');
  if (ds) {
    for (const c of r.columns ?? []) if (!ds.fields.some((f) => f.key === c)) errors.push(`Unknown column "${c}".`);
    for (const f of r.filters ?? []) {
      if (!ds.fields.some((x) => x.key === f.field)) errors.push(`Unknown filter field "${f.field}".`);
      if (!['equals', 'not_equals', 'contains', 'greater_than', 'less_than'].includes(f.op)) errors.push(`Unknown comparison for "${f.field}".`);
      if (f.op !== 'contains' && !f.value.trim()) errors.push(`Give "${f.field}" a value to compare against.`);
    }
    if (r.groupBy && !ds.fields.some((f) => f.key === r.groupBy)) errors.push(`Unknown grouping "${r.groupBy}".`);
  }
  return errors;
}

export function newCustomReportId(): string {
  return `cr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
