import {
  LayoutDashboard,
  DollarSign,
  Megaphone,
  Inbox,
  Wallet,
  Boxes,
  Briefcase,
  Building2,
  Bot,
  PlugZap,
  Code2,
  Settings,
  FolderKanban,
  LifeBuoy,
} from 'lucide-react';

export type PageId =
  | 'overview'
  | 'sales'
  | 'marketing'
  | 'communications'
  | 'support'
  | 'finance'
  | 'inventory'
  | 'projects'
  | 'hr'
  | 'company'
  | 'ai'
  | 'integrations'
  | 'developers'
  | 'settings';

export interface PageTab {
  id: string;
  label: string;
}

export interface NavPage {
  id: PageId;
  label: string;
  icon: typeof LayoutDashboard;
  tabs?: PageTab[];
}

// Top-level themes. Each page renders its inner sections as a tabbed
// sub-menu; `tabs` doubles as the command-palette deep-link targets.
export const NAV_PAGES: NavPage[] = [
  {
    id: 'overview', label: 'Overview', icon: LayoutDashboard,
    tabs: [
      { id: 'command', label: 'Command Center' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'kpis', label: 'KPIs' },
    ],
  },
  {
    id: 'sales', label: 'Sales', icon: DollarSign,
    tabs: [
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'customers', label: 'Customers' },
      { id: 'invoices', label: 'Invoicing' },
    ],
  },
  {
    id: 'marketing', label: 'Marketing', icon: Megaphone,
    tabs: [
      { id: 'social', label: 'Social Media' },
      { id: 'advertising', label: 'Advertising' },
    ],
  },
  {
    id: 'communications', label: 'Communications', icon: Inbox,
    tabs: [
      { id: 'inbox', label: 'Unified Inbox' },
      { id: 'securechat', label: 'Encrypted Chat' },
      { id: 'calls', label: 'Calls' },
    ],
  },
  {
    id: 'support', label: 'Support Desk', icon: LifeBuoy,
    tabs: [
      { id: 'tickets', label: 'Tickets' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'settings', label: 'SLA & Mailbox' },
    ],
  },
  {
    id: 'finance', label: 'Finance', icon: Wallet,
    tabs: [
      { id: 'ledger', label: 'Ledger' },
      { id: 'accounting', label: 'Accounting' },
      { id: 'assets', label: 'Fixed Assets' },
      { id: 'banking', label: 'Banking' },
      { id: 'vendors', label: 'Vendors & AP' },
      { id: 'budgeting', label: 'Budgeting' },
      { id: 'revenue', label: 'Revenue Tracker' },
      { id: 'reports', label: 'Reports' },
      { id: 'closures', label: 'Book Closure' },
      { id: 'filing', label: 'Filing' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: Boxes,
    tabs: [
      { id: 'catalog', label: 'Catalog' },
      { id: 'stock', label: 'Stock & Costing' },
      { id: 'locations', label: 'Warehouses & Stores' },
      { id: 'pos', label: 'Point of Sale' },
    ],
  },
  {
    id: 'projects', label: 'Projects', icon: FolderKanban,
  },
  {
    id: 'hr', label: 'HR', icon: Briefcase,
    tabs: [
      { id: 'directory', label: 'Directory' },
      { id: 'timeoff', label: 'Time Off' },
      { id: 'timeclock', label: 'Time Clock' },
      { id: 'invites', label: 'Team Invites' },
      { id: 'teams', label: 'Teams' },
      { id: 'org', label: 'Organogram' },
    ],
  },
  {
    id: 'company', label: 'Company', icon: Building2,
    tabs: [
      { id: 'workspaces', label: 'Companies' },
      { id: 'valuation', label: 'Valuation' },
      { id: 'fundraising', label: 'Fundraising' },
      { id: 'knowledge', label: 'Knowledge Base' },
      { id: 'engine', label: 'Company Engine' },
    ],
  },
  {
    id: 'ai', label: 'AI Platform', icon: Bot,
    tabs: [
      { id: 'agents', label: 'Agents' },
      { id: 'runs', label: 'Runs & Queue' },
      { id: 'planner', label: 'Planner' },
      { id: 'activity', label: 'Activity Log' },
    ],
  },
  {
    id: 'integrations', label: 'Integrations', icon: PlugZap,
    tabs: [
      { id: 'toolkits', label: 'Composio Toolkits' },
      { id: 'ai-providers', label: 'AI & Voice' },
      { id: 'connected', label: 'Connected Apps' },
      { id: 'connections', label: 'Connections (Twilio, Meta, Ads)' },
    ],
  },
  {
    id: 'developers', label: 'Developers', icon: Code2,
    tabs: [
      { id: 'api-keys', label: 'API Keys' },
      { id: 'webhooks', label: 'Webhooks' },
      { id: 'requests', label: 'Feature Requests' },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: Settings,
  },
];

export function getPage(id: string): NavPage | undefined {
  return NAV_PAGES.find((p) => p.id === id);
}

export function isPageId(id: string): id is PageId {
  return NAV_PAGES.some((p) => p.id === id);
}

/** Deep-link payload carried by the `borga:nav` event. */
export interface NavTarget {
  page: PageId;
  tab?: string;
}
