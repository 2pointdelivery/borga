/**
 * Borga Public REST API (v1) — Single Source of Truth Catalog & OpenAPI 3.1.0 Generator.
 *
 * Powers:
 * 1. `GET /api/v1/openapi` (OpenAPI 3.1.0 JSON specification)
 * 2. `GET /api/v1` (API version & discovery index)
 * 3. `/developers` public documentation page
 * 4. `Developers → API Reference & OpenAPI` inside the dashboard
 */

export const BORGA_API_VERSION = 'v1';
export const BORGA_OPENAPI_SEMVER = '1.4.0';
export const BORGA_API_RELEASE_DATE = '2026-10-17';

export type ApiMethod = 'GET' | 'POST' | 'PATCH';

export type ApiTag =
  | 'Meta & Discovery'
  | 'Sales & CRM'
  | 'Invoicing & Quotes'
  | 'Finance & Payables'
  | 'Inventory & Procurement'
  | 'Projects & Operations'
  | 'Support Desk'
  | 'People, Payroll & Equity'
  | 'Knowledge & Shared Services'
  | 'Communications';

export interface ApiEndpointDoc {
  id: string;
  version: 'v1';
  method: ApiMethod;
  path: string;
  tag: ApiTag;
  summary: string;
  description: string;
  featureFlag?: string;
  queryParams: Array<{ name: string; required: boolean; description: string }>;
  requestExample?: Record<string, unknown>;
  responseExample: Record<string, unknown>;
}

export const V1_ENDPOINT_CATALOG: readonly ApiEndpointDoc[] = [
  {
    id: 'v1-discovery',
    version: 'v1',
    method: 'GET',
    path: '/api/v1',
    tag: 'Meta & Discovery',
    summary: 'API version & endpoint discovery index',
    description: 'Returns the active API version (v1 / 1.4.0), release date, OpenAPI spec URL, and available endpoint paths.',
    queryParams: [],
    responseExample: {
      ok: true,
      apiVersion: 'v1',
      specVersion: '1.4.0',
      releaseDate: '2026-10-17',
      openApiUrl: '/api/v1/openapi',
    },
  },
  {
    id: 'v1-openapi',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/openapi',
    tag: 'Meta & Discovery',
    summary: 'OpenAPI 3.1.0 machine-readable specification',
    description: 'Returns the full OpenAPI 3.1.0 JSON schema for all versioned /api/v1 endpoints, security schemes, and webhook payloads.',
    queryParams: [],
    responseExample: {
      openapi: '3.1.0',
      info: { title: 'Borga Company OS API', version: '1.4.0' },
    },
  },
  {
    id: 'leads-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/leads',
    tag: 'Sales & CRM',
    summary: 'List pipeline leads',
    description: 'Returns up to 100 pipeline leads for the workspace (newest first), including stage, priority, value, and contact details.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    responseExample: {
      ok: true,
      leads: [
        {
          id: 'l-101',
          name: 'Ada Lovelace',
          company: 'Analytical Engines Ltd',
          email: 'ada@engines.co',
          phone: '+15552345678',
          value: 12500,
          stage: 'proposal',
          source: 'API',
          priority: 'P1',
        },
      ],
    },
  },
  {
    id: 'leads-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/leads',
    tag: 'Sales & CRM',
    summary: 'Create a pipeline lead',
    description: 'Captures a new lead in the sales pipeline. Stage defaults to "new" and priority to "P2".',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      name: 'Ada Lovelace',
      company: 'Analytical Engines Ltd',
      email: 'ada@engines.co',
      phone: '+15552345678',
      value: 12500,
      stage: 'qualified',
      priority: 'P1',
    },
    responseExample: {
      ok: true,
      lead: {
        id: 'l-101',
        name: 'Ada Lovelace',
        company: 'Analytical Engines Ltd',
        stage: 'qualified',
        value: 12500,
        priority: 'P1',
      },
    },
  },
  {
    id: 'customers-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/customers',
    tag: 'Sales & CRM',
    summary: 'List customer accounts',
    description: 'Returns up to 100 customer accounts with industry, contact email/phone, location, status, and account owner.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    responseExample: {
      ok: true,
      customers: [
        {
          id: 'c-1',
          name: 'Acme Corp',
          industry: 'Logistics',
          email: 'billing@acme.com',
          phone: '+15550100',
          city: 'Austin',
          country: 'United States',
          status: 'active',
          owner: 'Atlas',
        },
      ],
    },
  },
  {
    id: 'customers-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/customers',
    tag: 'Sales & CRM',
    summary: 'Create a customer account',
    description: 'Creates a new customer account record in the CRM.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      name: 'Acme Corp',
      industry: 'Logistics',
      email: 'billing@acme.com',
      phone: '+15550100',
      country: 'United States',
      status: 'active',
    },
    responseExample: {
      ok: true,
      customer: {
        id: 'c-1',
        name: 'Acme Corp',
        industry: 'Logistics',
        email: 'billing@acme.com',
        status: 'active',
      },
    },
  },
  {
    id: 'quotes-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/quotes',
    tag: 'Invoicing & Quotes',
    summary: 'List quotes & estimates',
    description: 'Lists quotes with version history, computed total, expiry date, and conversion references.',
    featureFlag: 'quotes',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'status', required: false, description: 'Filter by draft | sent | accepted | expired | converted' },
    ],
    responseExample: {
      ok: true,
      quotes: [
        {
          id: 'q-1',
          number: 'Q-1',
          customer: 'Acme Corp',
          version: 1,
          status: 'sent',
          total: 4200,
          validUntil: '2026-11-15',
        },
      ],
    },
  },
  {
    id: 'quotes-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/quotes',
    tag: 'Invoicing & Quotes',
    summary: 'Create a draft quote',
    description: 'Creates a versioned quote with line items, optional discount %, and expiry date.',
    featureFlag: 'quotes',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      customerId: 'c-1',
      customerName: 'Acme Corp',
      validUntil: '2026-11-15',
      lines: [{ label: 'Dedicated Freight Lane', qty: 2, unitPrice: 2100, taxRate: 0 }],
    },
    responseExample: {
      ok: true,
      quote: { id: 'q-1', number: 'Q-1', status: 'draft', total: 4200 },
    },
  },
  {
    id: 'quotes-accept',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/quotes/accept',
    tag: 'Invoicing & Quotes',
    summary: 'Accept a sent quote & convert to invoice/project',
    description: 'Converts a sent, unexpired quote into an invoice, a delivery project, or both in a single atomic call.',
    featureFlag: 'quotes',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      quoteId: 'q-1',
      target: 'both',
    },
    responseExample: {
      ok: true,
      invoiceId: 'inv-101',
      projectId: 'p-101',
      total: 4200,
    },
  },
  {
    id: 'invoices-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/invoices',
    tag: 'Invoicing & Quotes',
    summary: 'List non-voided invoices',
    description: 'Returns up to 100 invoices for the workspace with optional status filtering.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'status', required: false, description: 'Filter by draft | sent | paid | overdue' },
    ],
    responseExample: {
      ok: true,
      invoices: [
        {
          id: 'inv-1',
          number: 'INV-1001',
          client: 'Acme Corp',
          amount: 4200,
          status: 'sent',
          issued: '2026-10-17',
          due: '2026-11-16',
        },
      ],
    },
  },
  {
    id: 'invoices-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/invoices',
    tag: 'Invoicing & Quotes',
    summary: 'Create an invoice',
    description: 'Creates a draft or sent customer invoice with line items or a lump-sum amount.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      client: 'Acme Corp',
      amount: 4200,
      due: '2026-11-16',
      status: 'draft',
      lines: [{ description: 'Dedicated Freight Lane', qty: 2, unitPrice: 2100 }],
    },
    responseExample: {
      ok: true,
      invoice: {
        id: 'inv-1',
        number: 'INV-1001',
        client: 'Acme Corp',
        amount: 4200,
        status: 'draft',
        due: '2026-11-16',
      },
    },
  },
  {
    id: 'bills-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/bills',
    tag: 'Finance & Payables',
    summary: 'List vendor bills (Accounts Payable)',
    description: 'Returns non-voided vendor bills with status (unpaid, scheduled, paid) and due dates.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'status', required: false, description: 'Filter by unpaid | scheduled | paid' },
    ],
    responseExample: {
      ok: true,
      bills: [
        {
          id: 'b-1',
          number: 'BILL-1',
          vendor: 'Nordic Parts Co',
          amount: 1850,
          status: 'unpaid',
          due: '2026-11-01',
        },
      ],
    },
  },
  {
    id: 'bills-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/bills',
    tag: 'Finance & Payables',
    summary: 'Record a vendor bill',
    description: 'Records an unpaid vendor bill against an existing vendor account.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      vendorId: 'v-1',
      due: '2026-11-01',
      lines: [{ label: 'Warehouse racking supply', amount: 1850 }],
    },
    responseExample: {
      ok: true,
      bill: { id: 'b-1', number: 'BILL-1', amount: 1850, status: 'unpaid' },
    },
  },
  {
    id: 'ratios-get',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/ratios',
    tag: 'Finance & Payables',
    summary: 'Compute financial ratios pack from posted GL journals',
    description: 'Computes 14 liquidity, profitability, leverage, and efficiency ratios from posted general-ledger journals.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'from', required: false, description: 'Period start YYYY-MM-DD' },
      { name: 'to', required: false, description: 'Period end YYYY-MM-DD' },
    ],
    responseExample: {
      ok: true,
      ratios: [
        { key: 'current_ratio', label: 'Current Ratio', category: 'liquidity', value: 2.4 },
      ],
    },
  },
  {
    id: 'purchase-orders-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/purchase-orders',
    tag: 'Inventory & Procurement',
    summary: 'List purchase orders',
    description: 'Lists purchase orders with supplier, status, total amount, and linked vendor bill ID.',
    featureFlag: 'procurement',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'status', required: false, description: 'Filter by draft | ordered | partial | received | billed | void' },
    ],
    responseExample: {
      ok: true,
      purchaseOrders: [
        { id: 'po-1', number: 'PO-1', vendor: 'Nordic Parts Co', status: 'ordered', total: 4800, billId: null },
      ],
    },
  },
  {
    id: 'purchase-orders-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/purchase-orders',
    tag: 'Inventory & Procurement',
    summary: 'Create a purchase order',
    description: 'Creates a new purchase order for a supplier with line items and expected delivery date.',
    featureFlag: 'procurement',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      vendorId: 'v-1',
      vendorName: 'Nordic Parts Co',
      expectedIso: '2026-11-10',
      lines: [{ label: 'Pallet Racks', qty: 12, unitCost: 400 }],
    },
    responseExample: {
      ok: true,
      purchaseOrder: { id: 'po-1', number: 'PO-1', vendor: 'Nordic Parts Co', status: 'draft', total: 4800 },
    },
  },
  {
    id: 'inventory-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/inventory',
    tag: 'Inventory & Procurement',
    summary: 'List catalog items & stock levels',
    description: 'Returns active and inactive catalog products and services with SKU, price, cost, and on-hand stock.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    responseExample: {
      ok: true,
      items: [
        { id: 'item-1', sku: 'SKU-100', name: 'Pallet Rack', type: 'product', price: 650, costPrice: 400, onHand: 24, active: true },
      ],
    },
  },
  {
    id: 'inventory-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/inventory',
    tag: 'Inventory & Procurement',
    summary: 'Create a catalog product or service',
    description: 'Adds a new product or service item to the workspace catalog.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      name: 'Pallet Rack',
      sku: 'SKU-100',
      type: 'product',
      category: 'Hardware',
      price: 650,
      costPrice: 400,
      trackStock: true,
      reorderPoint: 5,
    },
    responseExample: {
      ok: true,
      item: { id: 'item-1', sku: 'SKU-100', name: 'Pallet Rack', type: 'product', price: 650 },
    },
  },
  {
    id: 'projects-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/projects',
    tag: 'Projects & Operations',
    summary: 'List delivery projects',
    description: 'Lists workspace projects with status, budget, owner, and customer link.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'status', required: false, description: 'Filter by planning | active | on-hold | completed | cancelled' },
    ],
    responseExample: {
      ok: true,
      projects: [
        { id: 'p-1', name: 'Q4 Warehouse Rollout', status: 'active', budgetAmount: 25000, ownerId: 'a-ops' },
      ],
    },
  },
  {
    id: 'projects-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/projects',
    tag: 'Projects & Operations',
    summary: 'Create a project',
    description: 'Creates a new delivery project with budget and optional customer link.',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      name: 'Q4 Warehouse Rollout',
      description: 'Install racking and barcode scanners across 3 hubs.',
      budgetAmount: 25000,
      status: 'active',
    },
    responseExample: {
      ok: true,
      project: { id: 'p-1', name: 'Q4 Warehouse Rollout', status: 'active', budgetAmount: 25000 },
    },
  },
  {
    id: 'tickets-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/tickets',
    tag: 'Support Desk',
    summary: 'List support tickets',
    description: 'Lists support desk tickets with SLA status, priority, requester, and assignee.',
    featureFlag: 'tickets',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'status', required: false, description: 'Filter by open | in-progress | pending | resolved | closed' },
    ],
    responseExample: {
      ok: true,
      tickets: [
        { id: 'TKT-1', subject: 'Scanner offline at Hub B', status: 'open', priority: 'high', type: 'incident' },
      ],
    },
  },
  {
    id: 'tickets-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/tickets',
    tag: 'Support Desk',
    summary: 'Create a support ticket',
    description: 'Opens a new support ticket with SLA timers started automatically.',
    featureFlag: 'tickets',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      subject: 'Scanner offline at Hub B',
      description: 'Handheld barcode unit #4 is not syncing.',
      priority: 'high',
      type: 'incident',
      requesterEmail: 'ops@acme.com',
    },
    responseExample: {
      ok: true,
      ticket: { id: 'TKT-1', subject: 'Scanner offline at Hub B', status: 'open', priority: 'high' },
    },
  },
  {
    id: 'tickets-update',
    version: 'v1',
    method: 'PATCH',
    path: '/api/v1/tickets',
    tag: 'Support Desk',
    summary: 'Update a support ticket',
    description: 'Updates status, priority, assignee, labels, or project on an existing ticket.',
    featureFlag: 'tickets',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'id', required: true, description: 'Ticket ID (e.g. TKT-1)' },
    ],
    requestExample: {
      status: 'in-progress',
      priority: 'critical',
      assignee: 'Marcus',
    },
    responseExample: {
      ok: true,
      ticket: { id: 'TKT-1', status: 'in-progress', priority: 'critical', assignee: 'Marcus' },
    },
  },
  {
    id: 'equity-holdings-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/equity/holdings',
    tag: 'People, Payroll & Equity',
    summary: 'List cap-table holdings & SAFEs',
    description: 'Returns stakeholders, share classes, share grants, SAFEs/convertible notes, and fully-diluted ownership.',
    featureFlag: 'capTable',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    responseExample: {
      ok: true,
      stakeholders: [{ id: 'sh-1', name: 'Founder', role: 'founder' }],
      grants: [{ id: 'gr-1', stakeholderId: 'sh-1', shares: 8000000 }],
      safes: [],
    },
  },
  {
    id: 'equity-safes-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/equity/safes',
    tag: 'People, Payroll & Equity',
    summary: 'Record a SAFE or convertible note',
    description: 'Adds a post-money SAFE or convertible note for an existing cap-table stakeholder.',
    featureFlag: 'capTable',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      kind: 'safe',
      stakeholderId: 'sh-1',
      amount: 250000,
      valuationCap: 10000000,
      discountPct: 20,
    },
    responseExample: {
      ok: true,
      safe: { id: 'sf-1', kind: 'safe', amount: 250000, valuationCap: 10000000 },
    },
  },
  {
    id: 'payrolls-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/payrolls',
    tag: 'People, Payroll & Equity',
    summary: 'List released payroll runs',
    description: 'Returns monthly payroll runs with gross pay, deductions, employer taxes, net pay, and posted journal IDs.',
    featureFlag: 'payroll',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    responseExample: {
      ok: true,
      payrolls: [
        { id: 'pr-2026-10', monthKey: '2026-10', gross: 42000, net: 31500, employerTax: 3800, status: 'posted' },
      ],
    },
  },
  {
    id: 'knowledge-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/knowledge',
    tag: 'Knowledge & Shared Services',
    summary: 'List Knowledge Base entries',
    description: 'Returns verified facts in the company Knowledge Base used by the AI agent fleet.',
    featureFlag: 'knowledge',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
      { name: 'category', required: false, description: 'Filter by company | services | customers | funding | content | process' },
    ],
    responseExample: {
      ok: true,
      knowledge: [
        { id: 'kb-1', category: 'services', title: 'Core Services', answer: 'Cross-border freight and warehousing.', source: 'Website' },
      ],
    },
  },
  {
    id: 'knowledge-create',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/knowledge',
    tag: 'Knowledge & Shared Services',
    summary: 'Add a Knowledge Base entry',
    description: 'Adds a new fact to the workspace Knowledge Base.',
    featureFlag: 'knowledge',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      category: 'services',
      title: 'Cold-Chain SLA',
      answer: 'Temperature-controlled shipments are monitored every 15 minutes.',
      source: 'API',
    },
    responseExample: {
      ok: true,
      entry: { id: 'kb-2', category: 'services', title: 'Cold-Chain SLA' },
    },
  },
  {
    id: 'shared-services-list',
    version: 'v1',
    method: 'GET',
    path: '/api/v1/shared-services',
    tag: 'Knowledge & Shared Services',
    summary: 'List Shared Services engagements, proposals & bookings',
    description: 'Returns active external advisor engagements (with granted module scopes and 85/15 fee split totals), proposals, and call bookings for the workspace.',
    featureFlag: 'sharedServices',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    responseExample: {
      ok: true,
      engagements: [
        {
          id: 'eng-1',
          advisorName: 'Apex CPA',
          category: 'accounting',
          grantedScopes: ['finance'],
          status: 'active',
          paidTotalCents: 150000,
        },
      ],
      proposals: [],
      bookings: [],
    },
  },
  {
    id: 'communications-send',
    version: 'v1',
    method: 'POST',
    path: '/api/v1/communications/send',
    tag: 'Communications',
    summary: 'Send an outbound Email, SMS, or WhatsApp message',
    description: 'Dispatches an outbound message over the workspace’s configured SMTP/Postmark server, Twilio SMS connection, or WhatsApp connection and logs it to the CRM inbox.',
    featureFlag: 'inbox',
    queryParams: [
      { name: 'ws', required: true, description: 'Target workspace ID' },
    ],
    requestExample: {
      channel: 'email',
      to: 'client@acme.com',
      subject: 'Shipment update',
      body: 'Your container has cleared customs and is en route.',
    },
    responseExample: {
      ok: true,
      channel: 'email',
      delivered: true,
      messageId: 'm-1729182000',
    },
  },
];

/**
 * Builds a complete, valid OpenAPI 3.1.0 specification document from `V1_ENDPOINT_CATALOG`.
 */
export function buildOpenApiSpec(serverOrigin = 'https://app.borga.ai'): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of V1_ENDPOINT_CATALOG) {
    const pathItem = (paths[ep.path] ??= {});
    const methodKey = ep.method.toLowerCase();
    const isPublicMeta = ep.path === '/api/v1' || ep.path === '/api/v1/openapi';

    pathItem[methodKey] = {
      operationId: ep.id,
      tags: [ep.tag],
      summary: ep.summary,
      description: ep.featureFlag
        ? `${ep.description} (Requires feature flag: \`${ep.featureFlag}\`.)`
        : ep.description,
      ...(isPublicMeta ? {} : { security: [{ BearerAuth: [] }, { SessionCookie: [] }] }),
      parameters: ep.queryParams.map((qp) => ({
        name: qp.name,
        in: 'query',
        required: qp.required,
        description: qp.description,
        schema: { type: 'string' },
      })),
      ...(ep.requestExample
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object' },
                  example: ep.requestExample,
                },
              },
            },
          }
        : {}),
      responses: {
        [ep.method === 'POST' && ep.id.endsWith('-create') ? '201' : '200']: {
          description: 'Successful response',
          headers: {
            'X-Borga-API-Version': {
              description: 'Active API version identifier',
              schema: { type: 'string', example: `${BORGA_API_VERSION} (${BORGA_OPENAPI_SEMVER})` },
            },
          },
          content: {
            'application/json': {
              schema: { type: 'object' },
              example: ep.responseExample,
            },
          },
        },
        '400': {
          description: 'Validation error or workspace outside API key scope',
          content: {
            'application/json': {
              example: { ok: false, error: 'a valid ?ws= workspace id is required' },
            },
          },
        },
        '401': {
          description: 'Missing, expired, or revoked Bearer API key / session',
          content: {
            'application/json': {
              example: { ok: false, error: 'unauthorized: sign in or pass Authorization: Bearer borga_...' },
            },
          },
        },
        '429': {
          description: 'Rate limit exceeded (120 requests/min per credential)',
          content: {
            'application/json': {
              example: { ok: false, error: 'Too many requests. Slow down and try again.' },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Borga Company OS Public API',
      version: BORGA_OPENAPI_SEMVER,
      summary: `Versioned REST API (${BORGA_API_VERSION}) for the Borga AI Company OS`,
      description:
        'Programmatic access to Sales & CRM, Quotes & Invoicing, Finance & Payables, Inventory & Purchase Orders, Projects, Support Desk, Payroll, Cap Table & Equity, Knowledge Base, Shared Services, and Outbound Communications.',
      contact: {
        name: 'Borga Platform Support',
        url: `${serverOrigin}/developers`,
      },
      'x-api-version': BORGA_API_VERSION,
      'x-release-date': BORGA_API_RELEASE_DATE,
    },
    servers: [
      {
        url: serverOrigin,
        description: `Borga Production / Instance (${BORGA_API_VERSION})`,
      },
    ],
    tags: [
      { name: 'Meta & Discovery', description: 'API version metadata and OpenAPI 3.1.0 specification' },
      { name: 'Sales & CRM', description: 'Pipeline leads and customer accounts' },
      { name: 'Invoicing & Quotes', description: 'Quotes, quote-to-cash conversion, and customer invoices' },
      { name: 'Finance & Payables', description: 'Vendor bills (AP) and general-ledger financial ratios' },
      { name: 'Inventory & Procurement', description: 'Catalog items, stock levels, and supplier purchase orders' },
      { name: 'Projects & Operations', description: 'Delivery projects and budgets' },
      { name: 'Support Desk', description: 'Customer support tickets and SLA workflows' },
      { name: 'People, Payroll & Equity', description: 'Cap-table holdings, SAFEs, and payroll runs' },
      { name: 'Knowledge & Shared Services', description: 'AI fleet Knowledge Base and vetted external advisor engagements' },
      { name: 'Communications', description: 'Outbound Email (SMTP/Postmark), Twilio SMS, and WhatsApp dispatch' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'borga_<secret>',
          description: 'Workspace-scoped API key created under Developers → API Keys (`Authorization: Bearer borga_...`).',
        },
        SessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'borga_session',
          description: 'Signed browser session cookie (state-changing calls also require `X-Borga-Client: borga-dashboard`).',
        },
      },
    },
    paths,
  };
}
