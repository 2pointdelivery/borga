import type { ActivityEvent, Customer, Invoice, Lead, Project } from './data';
import type { Quote } from './quotes';

/**
 * Per-record timeline: everything one relationship touched, newest first.
 * Documents carry their own dates; activity entries carry only a clock time,
 * so dated documents sort first and matching activity follows in feed order.
 * Pure; the panels render it.
 */

export type TimelineTarget =
  | { kind: 'lead'; id: string }
  | { kind: 'customer'; id: string }
  | { kind: 'quote'; id: string }
  | { kind: 'invoice'; id: string };

export interface TimelineEntry {
  at: string | null;
  kind: 'lead' | 'customer' | 'quote' | 'invoice' | 'project' | 'note';
  title: string;
  sub?: string;
  link?: { page: string; tab?: string };
}

export interface TimelineData {
  leads: Array<Pick<Lead, 'id' | 'name' | 'company' | 'customerId' | 'stage' | 'value' | 'source' | 'createdAt'>>;
  customers: Array<Pick<Customer, 'id' | 'name'>>;
  quotes: Array<Pick<Quote, 'id' | 'number' | 'customerId' | 'customerName' | 'leadId' | 'status' | 'issued' | 'convertedInvoiceId' | 'convertedProjectId'>>;
  invoices: Array<Pick<Invoice, 'id' | 'number' | 'client' | 'customerId' | 'amount' | 'status' | 'issued' | 'externalRef' | 'projectId'>>;
  projects: Array<Pick<Project, 'id' | 'name' | 'customerId' | 'status' | 'createdAt'>>;
  activity: ActivityEvent[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function quoteOfInvoice(externalRef: unknown): string | null {
  const m = /^quote:(.+):v\d+$/.exec(str(externalRef));
  return m ? m[1] : null;
}

/** Invoices for one customer: by account link, else by exact company name. */
function customerInvoices(
  invoices: TimelineData['invoices'],
  customerId: string,
  companyName: string,
): TimelineData['invoices'] {
  return invoices.filter((i) => {
    if (i.customerId === customerId) return true;
    return !!companyName && str(i.client).toLowerCase() === companyName.toLowerCase();
  });
}

export function collectTimeline(data: TimelineData, target: TimelineTarget): TimelineEntry[] {
  const dated: TimelineEntry[] = [];
  const notes: TimelineEntry[] = [];
  const pushDoc = (kind: TimelineEntry['kind'], at: string | undefined, title: string, sub?: string, link?: TimelineEntry['link']) => {
    if (at) dated.push({ at, kind, title, sub, link });
    else notes.push({ at: null, kind, title, sub, link });
  };

  if (target.kind === 'lead') {
    const lead = data.leads.find((l) => l.id === target.id);
    const customerId = str(lead?.customerId);
    const company = str(lead?.company);
    const leadQuotes = data.quotes.filter((x) => x.leadId === target.id);
    for (const q of leadQuotes) {
      pushDoc('quote', str(q.issued) || undefined, `Quote ${str(q.number)}`, `${str(q.status)} · ${str(q.customerName)}`, { page: 'sales', tab: 'quotes' });
    }
    const invoices = data.invoices.filter((i) => {
      const qid = quoteOfInvoice(i.externalRef);
      if (qid && data.quotes.some((q) => q.id === qid && q.leadId === target.id)) return true;
      if (customerId && i.customerId === customerId) return true;
      return !!company && !!str(i.client) && str(i.client).toLowerCase() === company.toLowerCase();
    });
    for (const i of invoices) {
      pushDoc('invoice', str(i.issued) || undefined, `Invoice ${str(i.number)}`, `${str(i.status)} · ${str(i.amount)}`, { page: 'sales', tab: 'invoices' });
    }
    const projectIds = new Set<string>();
    for (const q of leadQuotes) if (str(q.convertedProjectId)) projectIds.add(str(q.convertedProjectId));
    for (const i of invoices) if (str(i.projectId)) projectIds.add(str(i.projectId));
    for (const pid of projectIds) {
      const p = data.projects.find((x) => x.id === pid);
      if (p) pushDoc('project', str(p.createdAt) || undefined, `Project ${str(p.name)}`, `${str(p.status)}`, { page: 'projects' });
    }
    if (lead) {
      pushDoc('lead', str(lead.createdAt) || undefined, 'Lead captured', `${str(lead.stage)} · ${str(lead.source)}`);
      if (customerId) {
        const c = data.customers.find((x) => x.id === customerId);
        if (c) pushDoc('customer', undefined, `Account ${str(c.name)}`, undefined, { page: 'sales', tab: 'customers' });
      }
    }
  }

  if (target.kind === 'customer') {
    const customer = data.customers.find((c) => c.id === target.id);
    const company = str(customer?.name);
    for (const l of data.leads.filter((x) => x.customerId === target.id || (!!company && !!str(x.company) && str(x.company).toLowerCase() === company.toLowerCase()))) {
      pushDoc('lead', str(l.createdAt) || undefined, `Lead ${str(l.name)}`, `${str(l.stage)} · ${str(l.value)}`, { page: 'sales', tab: 'pipeline' });
    }
    for (const q of data.quotes.filter((x) => x.customerId === target.id)) {
      pushDoc('quote', str(q.issued) || undefined, `Quote ${str(q.number)}`, `${str(q.status)}`, { page: 'sales', tab: 'quotes' });
    }
    for (const i of customerInvoices(data.invoices, target.id, company)) {
      pushDoc('invoice', str(i.issued) || undefined, `Invoice ${str(i.number)}`, `${str(i.status)} · ${str(i.amount)}`, { page: 'sales', tab: 'invoices' });
    }
    for (const p of data.projects.filter((x) => x.customerId === target.id)) {
      pushDoc('project', str(p.createdAt) || undefined, `Project ${str(p.name)}`, `${str(p.status)}`, { page: 'projects' });
    }
  }

  if (target.kind === 'quote') {
    const quote = data.quotes.find((q) => q.id === target.id);
    if (quote) {
      pushDoc('quote', str(quote.issued) || undefined, `Quote ${str(quote.number)} issued`, `${str(quote.status)}`);
      const lid = str(quote.leadId);
      if (lid) {
        const l = data.leads.find((x) => x.id === lid);
        if (l) pushDoc('lead', str(l.createdAt) || undefined, `Lead ${str(l.name)}`, 'quoted from here', { page: 'sales', tab: 'pipeline' });
      }
      for (const i of data.invoices.filter((x) => quoteOfInvoice(x.externalRef) === target.id || x.id === str(quote.convertedInvoiceId))) {
        pushDoc('invoice', str(i.issued) || undefined, `Invoice ${str(i.number)}`, `${str(i.status)} · ${str(i.amount)}`, { page: 'sales', tab: 'invoices' });
      }
      const pid = str(quote.convertedProjectId);
      if (pid) {
        const p = data.projects.find((x) => x.id === pid);
        if (p) pushDoc('project', str(p.createdAt) || undefined, `Project ${str(p.name)}`, `${str(p.status)}`, { page: 'projects' });
      }
    }
  }

  if (target.kind === 'invoice') {
    const invoice = data.invoices.find((i) => i.id === target.id);
    if (invoice) {
      pushDoc('invoice', str(invoice.issued) || undefined, `Invoice ${str(invoice.number)} issued`, `${str(invoice.status)} · ${str(invoice.amount)}`);
      const qid = quoteOfInvoice(invoice.externalRef);
      const q = qid ? data.quotes.find((x) => x.id === qid) : undefined;
      if (q) pushDoc('quote', str(q.issued) || undefined, `Quote ${str(q.number)}`, 'converted into this invoice', { page: 'sales', tab: 'quotes' });
      const pid = str(invoice.projectId);
      if (pid) {
        const p = data.projects.find((x) => x.id === pid);
        if (p) pushDoc('project', str(p.createdAt) || undefined, `Project ${str(p.name)}`, `${str(p.status)}`, { page: 'projects' });
      }
    }
  }

  for (const a of data.activity) {
    if (a.ref?.id === target.id) notes.push({ at: null, kind: 'note', title: a.message, sub: `${a.agentName} · ${a.time}` });
  }

  dated.sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''));
  return [...dated, ...notes];
}
