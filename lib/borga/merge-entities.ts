import type { Contact, Customer, Invoice, Lead, Project } from './data';
import type { Quote } from './quotes';

/**
 * Duplicate merging, pure: the winner keeps its identity and stage, gains
 * anything the loser had that it lacks, inherits the loser's linked records,
 * and the loser goes away. The store applies the returned lists (or nothing
 * when the pair is unusable).
 */

function blank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && v === 0);
}

export interface LeadLists {
  leads: Lead[];
  quotes: Quote[];
}

export function applyLeadMerge(lists: LeadLists, winnerId: string, loserId: string): LeadLists | null {
  if (winnerId === loserId) return null;
  const winner = lists.leads.find((l) => l.id === winnerId);
  const loser = lists.leads.find((l) => l.id === loserId);
  if (!winner || !loser) return null;
  const filled: Lead = {
    ...winner,
    email: blank(winner.email) ? loser.email : winner.email,
    phone: blank(winner.phone) ? loser.phone : winner.phone,
    company: blank(winner.company) ? loser.company : winner.company,
    value: blank(winner.value) ? loser.value : winner.value,
    source: blank(winner.source) ? loser.source : winner.source,
    customerId: winner.customerId ?? loser.customerId,
    diagnosis: winner.diagnosis ?? loser.diagnosis,
    outcomeNote: winner.outcomeNote ?? loser.outcomeNote,
  };
  return {
    leads: [filled, ...lists.leads.filter((l) => l.id !== winnerId && l.id !== loserId)],
    quotes: lists.quotes.map((q) => (q.leadId === loserId ? { ...q, leadId: winnerId } : q)),
  };
}

export interface CustomerLists {
  customers: Customer[];
  leads: Lead[];
  quotes: Quote[];
  invoices: Invoice[];
  projects: Project[];
  contacts: Contact[];
}

export function applyCustomerMerge(lists: CustomerLists, winnerId: string, loserId: string): CustomerLists | null {
  if (winnerId === loserId) return null;
  const winner = lists.customers.find((c) => c.id === winnerId);
  const loser = lists.customers.find((c) => c.id === loserId);
  if (!winner || !loser) return null;
  const filled: Customer = {
    ...winner,
    email: blank(winner.email) ? loser.email : winner.email,
    phone: blank(winner.phone) ? loser.phone : winner.phone,
    industry: blank(winner.industry) ? loser.industry : winner.industry,
    website: blank(winner.website) ? loser.website : winner.website,
    addressLine: blank(winner.addressLine) ? loser.addressLine : winner.addressLine,
    city: blank(winner.city) ? loser.city : winner.city,
    state: blank(winner.state) ? loser.state : winner.state,
    country: blank(winner.country) ? loser.country : winner.country,
    owner: blank(winner.owner) ? loser.owner : winner.owner,
    notes: blank(winner.notes) ? loser.notes : winner.notes,
  };
  const move = <T extends { customerId?: string }>(list: T[]): T[] =>
    list.map((x) => (x.customerId === loserId ? { ...x, customerId: winnerId } : x));
  // Invoices also match by company name when unlinked: re-point those too.
  const invoices = lists.invoices.map((i) =>
    i.customerId === loserId || (!i.customerId && i.client.toLowerCase() === loser.name.toLowerCase()) ? { ...i, customerId: winnerId } : i,
  );
  return {
    customers: [filled, ...lists.customers.filter((c) => c.id !== winnerId && c.id !== loserId)],
    leads: move(lists.leads),
    quotes: move(lists.quotes),
    invoices,
    projects: move(lists.projects),
    contacts: move(lists.contacts),
  };
}
