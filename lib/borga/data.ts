// Borga — core domain types and seed data.

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type Bucket = 'today' | 'week' | 'month';

export type LlmModelTier = 'free' | 'paid' | 'credits';
export type LlmModelInfo = {
  id: string;
  label: string;
  tier: LlmModelTier;
  contextK?: number;
  tag?: string;
};

export interface Agent {
  id: string;
  name: string;
  role: string;
  department: string;
  status: 'active' | 'idle' | 'learning' | 'offline';
  avatarColor: string;
  skills: string[];
  model: string;
  tasksCompleted: number;
  accuracy: number; // 0-100
  brainLinked: boolean;
  description: string;
  persona?: string; // originating agency-agents persona file
  instructions?: string; // operating instructions shown to the agent
  type?: string; // agent division/type from the agency-agents catalog (e.g. "Engineering", "Healthcare")
  emoji?: string; // catalog emoji
  vibe?: string; // one-line tagline from the source persona
}

export interface Department {
  id: string;
  name: string;
  kpis: { label: string; value: number; target: number; unit: string; delta: number }[];
}

export interface Task {
  id: string;
  title: string;
  detail: string;
  priority: Priority;
  status: TaskStatus;
  bucket: Bucket;
  assignee: string;
  tags: string[];
  due: string;
  progress: number; // 0-100
  projectId?: string; // links this task to a Project
  customerId?: string; // links this task to a Customer account
}

export interface ActivityEvent {
  id: string;
  time: string;
  agentId: string;
  agentName: string;
  actor: 'agent' | 'system' | 'user';
  kind: 'task' | 'handoff' | 'learn' | 'sync' | 'voice' | 'system';
  message: string;
}

export interface Connector {
  id: string;
  name: string;
  provider: string;
  kind: 'crm' | 'mcp' | 'tool' | 'data' | 'composio';
  status: 'connected' | 'connecting' | 'error' | 'off';
  description: string;
  lastSync: string;
}

export type SocialChannel = 'linkedin' | 'twitter' | 'facebook' | 'instagram' | 'tiktok';
export type SocialStatus = 'draft' | 'scheduled' | 'published';

export interface SocialPost {
  id: string;
  channel: SocialChannel;
  content: string;
  status: SocialStatus;
  scheduledAt: string;
  author: string;
  engagement: { likes: number; comments: number; shares: number };
}

export type LeadStage = 'new' | 'qualified' | 'proposal' | 'won' | 'lost';

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  value: number;
  stage: LeadStage;
  source: string;
  ownerId: string;
  priority: Priority;
  customerId?: string; // links this deal to a Customer account once converted/matched
  crmId?: string; // id of this deal in the company CRM (Company Engine pull)
}

export interface Workflow {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  progress: number; // 0-100
  startedBy: string;
  engine: string;
}

// ---- Agent fleet: one specialist per department, personas from agency-agents ----
export const AGENTS: Agent[] = [
  {
    id: 'a-borga', name: 'Borga', role: 'Orchestrator — Brain Hub', department: 'Command',
    status: 'active', avatarColor: '#6366f1',
    skills: ['Orchestration', 'Planning', 'Voice', 'Calls', 'Memory', 'Shared brain'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 1284, accuracy: 97, brainLinked: true,
    description: 'The command-center orchestrator. Coordinates the whole fleet, runs the voice assistant and keeps the shared brain in sync.',
    persona: 'agents-orchestrator.md',
  },
  {
    id: 'a-design', name: 'Maya', role: 'Design Lead', department: 'Design',
    status: 'active', avatarColor: '#ec4899',
    skills: ['UI design', 'UX architecture', 'Design systems', 'Visual storytelling'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 764, accuracy: 95, brainLinked: true,
    description: 'UI/UX architect who turns ideas into pixel-perfect, inclusive interfaces.',
    persona: 'design-ui-designer.md',
  },
  {
    id: 'a-engineering', name: 'Devon', role: 'Engineering Lead', department: 'Engineering',
    status: 'active', avatarColor: '#0ea5e9',
    skills: ['Frontend', 'Backend', 'API design', 'Code review'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 1120, accuracy: 96, brainLinked: true,
    description: 'Full-stack engineer and API platform architect who ships reliable, reviewed code.',
    persona: 'engineering-api-platform-engineer.md',
  },
  {
    id: 'a-finance', name: 'Sage', role: 'Finance Lead', department: 'Finance',
    status: 'idle', avatarColor: '#f59e0b',
    skills: ['Financial analysis', 'FP&A', 'Forecasting', 'Tax strategy'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 501, accuracy: 97, brainLinked: true,
    description: 'Financial analyst and controller who reconciles, forecasts and keeps the books clean.',
    persona: 'finance-financial-analyst.md',
  },
  {
    id: 'a-integrations', name: 'Iris', role: 'Integrations Lead', department: 'Integrations',
    status: 'active', avatarColor: '#14b8a6',
    skills: ['API integrations', 'Composio toolkits', 'Connectors', 'Automation'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 688, accuracy: 94, brainLinked: true,
    description: 'Integration engineer who wires CRMs, Google, Stripe and social toolkits into the engine.',
    persona: 'engineering-api-platform-engineer.md',
  },
  {
    id: 'a-marketing', name: 'Nova', role: 'Marketing Lead', department: 'Marketing',
    status: 'learning', avatarColor: '#f472b6',
    skills: ['Content', 'SEO', 'Social media', 'Email', 'Growth'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 920, accuracy: 92, brainLinked: true,
    description: 'Content creator and social strategist who plans and publishes multi-channel campaigns.',
    persona: 'marketing-social-media-strategist.md',
  },
  {
    id: 'a-paidmedia', name: 'Paige', role: 'Paid Media Lead', department: 'Paid Media',
    status: 'idle', avatarColor: '#8b5cf6',
    skills: ['PPC', 'Paid social', 'Programmatic', 'Tracking'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 437, accuracy: 93, brainLinked: true,
    description: 'PPC and paid-social strategist who scales spend and protects ROAS.',
    persona: 'paid-media-ppc-strategist.md',
  },
  {
    id: 'a-product', name: 'Porter', role: 'Product Lead', department: 'Product',
    status: 'idle', avatarColor: '#f97316',
    skills: ['Roadmapping', 'Prioritization', 'Feedback synthesis', 'Sprint planning'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 388, accuracy: 91, brainLinked: true,
    description: 'Product manager who turns feedback into a sharp, prioritized roadmap.',
    persona: 'product-manager.md',
  },
  {
    id: 'a-pm', name: 'Rigby', role: 'Project Management', department: 'Project Management',
    status: 'active', avatarColor: '#22c55e',
    skills: ['Delivery', 'Jira workflows', 'Meeting notes', 'Risk tracking'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 1098, accuracy: 95, brainLinked: true,
    description: 'Senior project manager / project shepherd who keeps delivery on time and on scope.',
    persona: 'project-manager-senior.md',
  },
  {
    id: 'a-sales', name: 'Atlas', role: 'Sales & Pipeline', department: 'Sales',
    status: 'active', avatarColor: '#22d3ee',
    skills: ['Deal strategy', 'Pipeline analytics', 'Proposals', 'Outbound', 'Calls'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 842, accuracy: 94, brainLinked: true,
    description: 'Deal strategist who qualifies leads, moves pipelines and writes winning proposals.',
    persona: 'sales-deal-strategist.md',
  },
  {
    id: 'a-security', name: 'Guard', role: 'Security Lead', department: 'Security',
    status: 'idle', avatarColor: '#ef4444',
    skills: ['AppSec', 'Compliance', 'Secrets management', 'Incident response'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 298, accuracy: 98, brainLinked: true,
    description: 'AppSec engineer who audits code, protects secrets and responds to incidents.',
    persona: 'security-appsec-engineer.md',
  },
  {
    id: 'a-strategy', name: 'Elara', role: 'Strategy Lead', department: 'Strategy',
    status: 'learning', avatarColor: '#a3e635',
    skills: ['Business strategy', 'Market research', 'Scenario planning', 'Briefing'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 214, accuracy: 90, brainLinked: true,
    description: 'Nexus strategist who shapes direction from market signals and scenario planning.',
    persona: 'nexus-strategy.md',
  },
  {
    id: 'a-support', name: 'Spectra', role: 'Support & Success', department: 'Support',
    status: 'active', avatarColor: '#34d399',
    skills: ['Ticketing', 'Knowledge base', 'SLA', 'CSAT', 'Calls'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 987, accuracy: 95, brainLinked: true,
    description: 'Support responder who resolves tickets fast and keeps the knowledge base current.',
    persona: 'support-support-responder.md',
  },
  {
    id: 'a-testing', name: 'Zed', role: 'Testing Lead', department: 'Testing',
    status: 'active', avatarColor: '#facc15',
    skills: ['Test automation', 'QA', 'Accessibility', 'Performance'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 612, accuracy: 97, brainLinked: true,
    description: 'Test automation engineer and reality-checker who verifies everything ships clean.',
    persona: 'testing-test-automation-engineer.md',
  },
  {
    id: 'a-fundraising', name: 'Nadia', role: 'Fundraising — Grants', department: 'Fundraising',
    status: 'active', avatarColor: '#10b981',
    skills: ['Grant scouting', 'Proposal writing', 'Compliance', 'Deadline tracking', 'Auto-apply', 'Calls'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 156, accuracy: 93, brainLinked: true,
    description: 'Scouts grants and funding programs for the company, evaluates fit, and automatically drafts and submits applications on the company\u2019s behalf.',
    persona: 'fundraising-grants-agent.md',
    instructions: 'Continuously scan grant registries and funding programs relevant to logistics. Rank opportunities by fit score, draft compliant applications, and auto-submit those above an 85% match. Log every finding and submission to the shared brain.',
  },

  // ── Specialist bench — installed from github.com/msitarzewski/agency-agents ──
  // A curated set of specialist personas (2 per division) supplementing the
  // core department leads above. Each is idle/unlinked until activated.
  {
    id: 'a-academic-academic-anthropologist', name: 'Anthropologist', role: 'Anthropologist', department: 'Academic',
    status: 'idle', avatarColor: '#D97706',
    skills: ['Academic', 'Anthropologist'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert in cultural systems, rituals, kinship, belief systems, and ethnographic method — builds culturally coherent societies that feel lived-in rather than invented',
    persona: 'academic/academic-anthropologist.md',
    type: 'Academic', emoji: '🌍', vibe: 'No culture is random — every practice is a solution to a problem you might not see yet',
  },
  {
    id: 'a-academic-academic-geographer', name: 'Geographer', role: 'Geographer', department: 'Academic',
    status: 'idle', avatarColor: '#059669',
    skills: ['Academic', 'Geographer'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert in physical and human geography, climate systems, cartography, and spatial analysis — builds geographically coherent worlds where terrain, climate, resources, and settlement patterns make scientific sense',
    persona: 'academic/academic-geographer.md',
    type: 'Academic', emoji: '🗺️', vibe: 'Geography is destiny — where you are determines who you become',
  },
  {
    id: 'a-design-design-brand-guardian', name: 'Brand Guardian', role: 'Brand Guardian', department: 'Design',
    status: 'idle', avatarColor: '#3b82f6',
    skills: ['Design', 'Brand Guardian'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert brand strategist and guardian specializing in brand identity development, consistency maintenance, and strategic brand positioning',
    persona: 'design/design-brand-guardian.md',
    type: 'Design', emoji: '🎨', vibe: 'Your brand\'s fiercest protector and most passionate advocate.',
  },
  {
    id: 'a-design-design-image-prompt-engineer', name: 'Image Prompt Engineer', role: 'Image Prompt Engineer', department: 'Design',
    status: 'idle', avatarColor: '#f59e0b',
    skills: ['Design', 'Image Prompt Engineer'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert photography prompt engineer specializing in crafting detailed, evocative prompts for AI image generation. Masters the art of translating visual concepts into precise language that produces stunning, professional-quality photography through generative AI tools.',
    persona: 'design/design-image-prompt-engineer.md',
    type: 'Design', emoji: '📷', vibe: 'Translates visual concepts into precise prompts that produce stunning AI photography.',
  },
  {
    id: 'a-engineering-engineering-ai-data-remediation-engineer', name: 'AI Data Remediation Engineer', role: 'AI Data Remediation Engineer', department: 'Engineering',
    status: 'idle', avatarColor: '#22c55e',
    skills: ['Engineering', 'AI Data Remediation Engineer'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Specialist in self-healing data pipelines — uses air-gapped local SLMs and semantic clustering to automatically detect, classify, and fix data anomalies at scale. Focuses exclusively on the remediation layer: intercepting bad data, generating deterministic fix logic, and guaranteeing zero data loss.',
    persona: 'engineering/engineering-ai-data-remediation-engineer.md',
    type: 'Engineering', emoji: '🧬', vibe: 'Fixes your broken data with surgical AI precision — no rows left behind.',
  },
  {
    id: 'a-engineering-engineering-ai-engineer', name: 'AI Engineer', role: 'AI Engineer', department: 'Engineering',
    status: 'idle', avatarColor: '#3b82f6',
    skills: ['Engineering', 'AI Engineer'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert AI/ML engineer specializing in machine learning model development, deployment, and integration into production systems. Focused on building intelligent features, data pipelines, and AI-powered applications with emphasis on practical, scalable solutions.',
    persona: 'engineering/engineering-ai-engineer.md',
    type: 'Engineering', emoji: '🤖', vibe: 'Turns ML models into production features that actually scale.',
  },
  {
    id: 'a-finance-finance-bookkeeper-controller', name: 'Dana', role: 'Bookkeeper & Controller', department: 'Finance',
    status: 'idle', avatarColor: '#22c55e',
    skills: ['Finance', 'Bookkeeper & Controller'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert bookkeeper and controller specializing in day-to-day accounting operations, financial reconciliations, month-end close processes, and internal controls. Ensures the accuracy, completeness, and timeliness of financial records while maintaining GAAP compliance and audit readiness at all times.',
    persona: 'finance/finance-bookkeeper-controller.md',
    type: 'Finance', emoji: '📒', vibe: 'Every penny accounted for, every close on time — the backbone of financial trust.',
  },
  {
    id: 'a-finance-finance-tax-strategist', name: 'Cassandra', role: 'Tax Strategist', department: 'Finance',
    status: 'idle', avatarColor: '#22c55e',
    skills: ['Finance', 'Tax Strategist'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert tax strategist specializing in tax optimization, multi-jurisdictional compliance, transfer pricing, and strategic tax planning. Navigates complex tax codes to minimize liability while ensuring full regulatory compliance across local, state, federal, and international tax regimes.',
    persona: 'finance/finance-tax-strategist.md',
    type: 'Finance', emoji: '🏛️', vibe: 'Finds every legal dollar of savings in the tax code — compliance is the floor, optimization is the mission.',
  },
  {
    id: 'a-game-development-blender-addon-engineer', name: 'Blender Addon Engineer', role: 'Blender Add-on Engineer', department: 'Game Development',
    status: 'idle', avatarColor: '#3b82f6',
    skills: ['Game Development', 'Blender Add-on Engineer'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Blender tooling specialist — builds Python add-ons, asset validators, exporters, and pipeline automations that turn repetitive DCC work into reliable one-click workflows',
    persona: 'game-development/blender-addon-engineer.md',
    type: 'Game Development', emoji: '🧩', vibe: 'Turns repetitive Blender pipeline work into reliable one-click tools that artists actually use.',
  },
  {
    id: 'a-game-development-economy-designer', name: 'Economy Designer', role: 'Economy Designer', department: 'Game Development',
    status: 'idle', avatarColor: '#22c55e',
    skills: ['Game Development', 'Economy Designer'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Virtual economy architect — masters currency systems, sources and sinks, monetization modeling, inflation control, and data-driven economic balancing for live games',
    persona: 'game-development/economy-designer.md',
    type: 'Game Development', emoji: '💰', vibe: 'Sees every game as a flow of currencies, and every player decision as a transaction.',
  },
  {
    id: 'a-gis-gis-3d-scene-developer', name: '3D & Scene Developer', role: '3D & Scene Developer', department: 'GIS',
    status: 'idle', avatarColor: '#22d3ee',
    skills: ['GIS', '3D & Scene Developer'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Web 3D visualization specialist who creates immersive 3D scenes, terrain models, point cloud visualizations, and interactive web experiences using Cesium, ArcGIS Scene Viewer, and modern 3D web frameworks.',
    persona: 'gis/gis-3d-scene-developer.md',
    type: 'GIS', emoji: '🏔️', vibe: 'Bringing the third dimension to the web — one scene at a time.',
  },
  {
    id: 'a-gis-gis-analyst', name: 'GIS Analyst', role: 'GIS Analyst', department: 'GIS',
    status: 'idle', avatarColor: '#14b8a6',
    skills: ['GIS', 'GIS Analyst'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Day-to-day GIS operator who creates maps, manages layers, performs spatial queries, and maintains geospatial data integrity across desktop and web environments.',
    persona: 'gis/gis-analyst.md',
    type: 'GIS', emoji: '🖥️', vibe: 'The reliable hands-on operator who keeps the GIS running day to day.',
  },
  {
    id: 'a-healthcare-healthcare-clinical-evidence-agent', name: 'Clinical Evidence Agent', role: 'Clinical Evidence Agent', department: 'Healthcare',
    status: 'idle', avatarColor: '#1A5276',
    skills: ['Healthcare', 'Clinical Evidence Agent'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Evidence standards and clinical credibility framework for AI agents',
    persona: 'healthcare/healthcare-clinical-evidence-agent.md',
    type: 'Healthcare', emoji: '🩺', vibe: 'Clinical credibility is earned through evidence standards, not confidence.',
  },
  {
    id: 'a-healthcare-healthcare-innovation-strategist', name: 'Healthcare Innovation Strategist', role: 'Healthcare Innovation Strategist', department: 'Healthcare',
    status: 'idle', avatarColor: '#1B4F72',
    skills: ['Healthcare', 'Healthcare Innovation Strategist'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Strategic narrative architect for healthcare founders operating at the intersection of clinical credibility and product velocity.',
    persona: 'healthcare/healthcare-innovation-strategist.md',
    type: 'Healthcare', emoji: '🧭', vibe: 'Holds the narrative together when the team is heads-down building.',
  },
  {
    id: 'a-marketing-marketing-aeo-foundations', name: 'AEO Foundations Architect', role: 'AEO Foundations Architect', department: 'Marketing',
    status: 'idle', avatarColor: '#059669',
    skills: ['Marketing', 'AEO Foundations Architect'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert in AI Engine Optimization infrastructure — implements llms.txt, AI-aware robots.txt, token-budgeted content, structured Markdown availability, and agent discovery files so AI crawlers, citation engines, and browsing agents can find, parse, and act on your site',
    persona: 'marketing/marketing-aeo-foundations.md',
    type: 'Marketing', emoji: '🏗️', vibe: 'The foundation layer everyone skips — making sure AI systems can actually discover, read, and use your content.',
  },
  {
    id: 'a-marketing-marketing-agentic-search-optimizer', name: 'Agentic Search Optimizer', role: 'Agentic Search Optimizer', department: 'Marketing',
    status: 'idle', avatarColor: '#0891B2',
    skills: ['Marketing', 'Agentic Search Optimizer'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert in WebMCP readiness and agentic task completion — audits whether AI agents can actually accomplish tasks on your site (book, buy, register, subscribe), implements WebMCP patterns, and measures task completion rates across AI browsing agents',
    persona: 'marketing/marketing-agentic-search-optimizer.md',
    type: 'Marketing', emoji: '🤖', vibe: 'Makes sure AI can actually do the thing on your site, not just cite it.',
  },
  {
    id: 'a-paid-media-paid-media-auditor', name: 'Paid Media Auditor', role: 'Paid Media Auditor', department: 'Paid Media',
    status: 'idle', avatarColor: '#f97316',
    skills: ['Paid Media', 'Paid Media Auditor'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Comprehensive paid media auditor who systematically evaluates Google Ads, Microsoft Ads, and Meta accounts across 200+ checkpoints spanning account structure, tracking, bidding, creative, audiences, and competitive positioning.',
    persona: 'paid-media/paid-media-auditor.md',
    type: 'Paid Media', emoji: '📋', vibe: 'Finds the waste in your ad spend before your CFO does.',
  },
  {
    id: 'a-paid-media-paid-media-creative-strategist', name: 'Ad Creative Strategist', role: 'Ad Creative Strategist', department: 'Paid Media',
    status: 'idle', avatarColor: '#f97316',
    skills: ['Paid Media', 'Ad Creative Strategist'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Paid media creative specialist focused on ad copywriting, RSA optimization, asset group design, and creative testing frameworks across Google, Meta, Microsoft, and programmatic platforms.',
    persona: 'paid-media/paid-media-creative-strategist.md',
    type: 'Paid Media', emoji: '✍️', vibe: 'Turns ad creative from guesswork into a repeatable science.',
  },
  {
    id: 'a-product-product-behavioral-nudge-engine', name: 'Behavioral Nudge Engine', role: 'Behavioral Nudge Engine', department: 'Product',
    status: 'idle', avatarColor: '#FF8A65',
    skills: ['Product', 'Behavioral Nudge Engine'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Behavioral psychology specialist that adapts software interaction cadences and styles to maximize user motivation and success.',
    persona: 'product/product-behavioral-nudge-engine.md',
    type: 'Product', emoji: '🧠', vibe: 'Adapts software interactions to maximize user motivation through behavioral psychology.',
  },
  {
    id: 'a-product-product-feedback-synthesizer', name: 'Feedback Synthesizer', role: 'Feedback Synthesizer', department: 'Product',
    status: 'idle', avatarColor: '#3b82f6',
    skills: ['Product', 'Feedback Synthesizer'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert in collecting, analyzing, and synthesizing user feedback from multiple channels to extract actionable product insights. Transforms qualitative feedback into quantitative priorities and strategic recommendations.',
    persona: 'product/product-feedback-synthesizer.md',
    type: 'Product', emoji: '🔍', vibe: 'Distills a thousand user voices into the five things you need to build next.',
  },
  {
    id: 'a-project-management-project-management-experiment-tracker', name: 'Experiment Tracker', role: 'Experiment Tracker', department: 'Project Management',
    status: 'idle', avatarColor: '#a855f7',
    skills: ['Project Management', 'Experiment Tracker'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert project manager specializing in experiment design, execution tracking, and data-driven decision making. Focused on managing A/B tests, feature experiments, and hypothesis validation.',
    persona: 'project-management/project-management-experiment-tracker.md',
    type: 'Project Management', emoji: '🧪', vibe: 'Designs experiments, tracks results, and lets the data decide.',
  },
  {
    id: 'a-project-management-project-management-jira-workflow-steward', name: 'Jira Workflow Steward', role: 'Jira Workflow Steward', department: 'Project Management',
    status: 'idle', avatarColor: '#f97316',
    skills: ['Project Management', 'Jira Workflow Steward'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert delivery operations specialist who enforces Jira-linked Git workflows, traceable commits, structured pull requests, and release-safe branch strategy across software teams.',
    persona: 'project-management/project-management-jira-workflow-steward.md',
    type: 'Project Management', emoji: '📋', vibe: 'Enforces traceable commits, structured PRs, and release-safe branch strategy.',
  },
  {
    id: 'a-research-research-synthesist', name: 'Research Synthesist', role: 'Research Synthesist', department: 'Research',
    status: 'idle', avatarColor: '#9333EA',
    skills: ['Research', 'Research Synthesist'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert in literature review, source evaluation, and evidence synthesis — turns a scattered pile of sources into a structured, honestly-weighted map of what the evidence actually supports',
    persona: 'research/research-synthesist.md',
    type: 'Research', emoji: '🔍', vibe: 'A hundred citations pointing the same direction is still one piece of evidence if they all trace back to the same study.',
  },
  {
    id: 'a-sales-sales-account-strategist', name: 'Account Strategist', role: 'Account Strategist', department: 'Sales',
    status: 'idle', avatarColor: '#2E7D32',
    skills: ['Sales', 'Account Strategist'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert post-sale account strategist specializing in land-and-expand execution, stakeholder mapping, QBR facilitation, and net revenue retention.',
    persona: 'sales/sales-account-strategist.md',
    type: 'Sales', emoji: '🗺️', vibe: 'Maps the org, finds the whitespace, and turns customers into platforms.',
  },
  {
    id: 'a-sales-sales-coach', name: 'Sales Coach', role: 'Sales Coach', department: 'Sales',
    status: 'idle', avatarColor: '#E65100',
    skills: ['Sales', 'Sales Coach'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert sales coaching specialist focused on rep development, pipeline review facilitation, call coaching, deal strategy, and forecast accuracy.',
    persona: 'sales/sales-coach.md',
    type: 'Sales', emoji: '🏋️', vibe: 'Asks the question that makes the rep rethink the entire deal.',
  },
  {
    id: 'a-security-security-ai-generated-code-auditor', name: 'AI Code Security Auditor', role: 'AI-Generated Code Security Auditor', department: 'Security',
    status: 'idle', avatarColor: '#4F46E5',
    skills: ['Security', 'AI-Generated Code Security Auditor'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Security reviewer for AI-generated and vibe-coded apps — hunts the hardcoded secrets, broken row-level security, and prompt-injection sinks that coding assistants ship by default, then drives a scan, fix, and rescan loop with honest, CWE-mapped findings.',
    persona: 'security/security-ai-generated-code-auditor.md',
    type: 'Security', emoji: '🔎', vibe: 'Assumes the assistant optimized for the demo, not production, and finds exactly where it cut the corner.',
  },
  {
    id: 'a-security-security-penetration-tester', name: 'Penetration Tester', role: 'Penetration Tester', department: 'Security',
    status: 'idle', avatarColor: '#dc2626',
    skills: ['Security', 'Penetration Tester'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Offensive security specialist conducting authorized penetration tests, red team operations, and vulnerability assessments across networks, web applications, and cloud infrastructure.',
    persona: 'security/security-penetration-tester.md',
    type: 'Security', emoji: '🗡️', vibe: 'Breaks into your systems so the real attackers can\'t.',
  },
  {
    id: 'a-spatial-computing-macos-spatial-metal-engineer', name: 'macOS Spatial/Metal Engineer', role: 'macOS Spatial/Metal Engineer', department: 'Spatial Computing',
    status: 'idle', avatarColor: '#64748b',
    skills: ['Spatial Computing', 'macOS Spatial/Metal Engineer'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Native Swift and Metal specialist building high-performance 3D rendering systems and spatial computing experiences for macOS and Vision Pro',
    persona: 'spatial-computing/macos-spatial-metal-engineer.md',
    type: 'Spatial Computing', emoji: '🍎', vibe: 'Pushes Metal to its limits for 3D rendering on macOS and Vision Pro.',
  },
  {
    id: 'a-spatial-computing-terminal-integration-specialist', name: 'Terminal Integration Specialist', role: 'Terminal Integration Specialist', department: 'Spatial Computing',
    status: 'idle', avatarColor: '#22c55e',
    skills: ['Spatial Computing', 'Terminal Integration Specialist'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Terminal emulation, text rendering optimization, and SwiftTerm integration for modern Swift applications',
    persona: 'spatial-computing/terminal-integration-specialist.md',
    type: 'Spatial Computing', emoji: '🖥️', vibe: 'Masters terminal emulation and text rendering in modern Swift applications.',
  },
  {
    id: 'a-specialized-accounts-payable-agent', name: 'Accounts Payable Agent', role: 'Accounts Payable Agent', department: 'Specialized',
    status: 'idle', avatarColor: '#22c55e',
    skills: ['Specialized', 'Accounts Payable Agent'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Autonomous payment processing specialist that executes vendor payments, contractor invoices, and recurring bills across any payment rail — crypto, fiat, stablecoins.',
    persona: 'specialized/accounts-payable-agent.md',
    type: 'Specialized', emoji: '💸', vibe: 'Moves money across any rail — crypto, fiat, stablecoins — so you don\'t have to.',
  },
  {
    id: 'a-specialized-agentic-identity-trust', name: 'Identity & Trust Architect', role: 'Agentic Identity & Trust Architect', department: 'Specialized',
    status: 'idle', avatarColor: '#2d5a27',
    skills: ['Specialized', 'Agentic Identity & Trust Architect'],
    model: 'nvidia/llama-3.1-nemotron-70b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Designs identity, authentication, and trust verification systems for autonomous AI agents operating in multi-agent environments. Ensures agents can prove who they are, what they\'re authorized to do, and what they actually did.',
    persona: 'specialized/agentic-identity-trust.md',
    type: 'Specialized', emoji: '🔐', vibe: 'Ensures every AI agent can prove who it is, what it\'s allowed to do, and what it actually did.',
  },
  {
    id: 'a-support-support-analytics-reporter', name: 'Analytics Reporter', role: 'Analytics Reporter', department: 'Support',
    status: 'idle', avatarColor: '#14b8a6',
    skills: ['Support', 'Analytics Reporter'],
    model: 'nvidia/mistral-nemotron-12b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert data analyst transforming raw data into actionable business insights. Creates dashboards, performs statistical analysis, tracks KPIs, and provides strategic decision support.',
    persona: 'support/support-analytics-reporter.md',
    type: 'Support', emoji: '📊', vibe: 'Transforms raw data into the insights that drive your next decision.',
  },
  {
    id: 'a-support-support-executive-summary-generator', name: 'Executive Summary Generator', role: 'Executive Summary Generator', department: 'Support',
    status: 'idle', avatarColor: '#a855f7',
    skills: ['Support', 'Executive Summary Generator'],
    model: 'nvidia/deepseek-ai-r1', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Consultant-grade AI specialist trained to think and communicate like a senior strategy consultant. Transforms complex business inputs into concise, actionable executive summaries.',
    persona: 'support/support-executive-summary-generator.md',
    type: 'Support', emoji: '📝', vibe: 'Thinks like a McKinsey consultant, writes for the C-suite.',
  },
  {
    id: 'a-testing-testing-accessibility-auditor', name: 'Accessibility Auditor', role: 'Accessibility Auditor', department: 'Testing',
    status: 'idle', avatarColor: '#0077B6',
    skills: ['Testing', 'Accessibility Auditor'],
    model: 'nvidia/meta-llama-3.1-8b-instruct', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert accessibility specialist who audits interfaces against WCAG standards, tests with assistive technologies, and ensures inclusive design.',
    persona: 'testing/testing-accessibility-auditor.md',
    type: 'Testing', emoji: '♿', vibe: 'If it\'s not tested with a screen reader, it\'s not accessible.',
  },
  {
    id: 'a-testing-testing-api-tester', name: 'API Tester', role: 'API Tester', department: 'Testing',
    status: 'idle', avatarColor: '#a855f7',
    skills: ['Testing', 'API Tester'],
    model: 'nvidia/mixtral-8x22b', tasksCompleted: 0, accuracy: 90, brainLinked: false,
    description: 'Expert API testing specialist focused on comprehensive API validation, performance testing, and quality assurance across all systems and third-party integrations',
    persona: 'testing/testing-api-tester.md',
    type: 'Testing', emoji: '🔌', vibe: 'Breaks your API before your users do.',
  },
];

// Operational KPI baselines across every functional area. These seed the
// "KPIs & Reports" tab and are fully editable/additive per company.
export const DEPARTMENTS: Department[] = [
  { id: 'sales', name: 'Sales', kpis: [
      { label: 'Pipeline Coverage', value: 84, target: 100, unit: '%', delta: 6.2 },
      { label: 'Deals Closed', value: 47, target: 60, unit: '', delta: 3.1 },
      { label: 'Win Rate', value: 32, target: 40, unit: '%', delta: -1.4 },
      { label: 'Avg Deal Size', value: 28400, target: 35000, unit: '$', delta: 4.8 },
      { label: 'Sales Cycle', value: 38, target: 30, unit: '', delta: -2.6 },
    ] },
  { id: 'marketing', name: 'Marketing', kpis: [
      { label: 'MQLs', value: 342, target: 400, unit: '', delta: 12.8 },
      { label: 'Conv. Rate', value: 5.4, target: 6, unit: '%', delta: 0.9 },
      { label: 'Reach', value: 128000, target: 150000, unit: '', delta: 8.3 },
      { label: 'CAC', value: 412, target: 350, unit: '$', delta: -3.4 },
      { label: 'Pipeline Influence', value: 61, target: 70, unit: '%', delta: 2.2 },
    ] },
  { id: 'finance', name: 'Finance', kpis: [
      { label: 'Revenue', value: 892000, target: 1000000, unit: '$', delta: 4.6 },
      { label: 'Burn Rate', value: 62000, target: 50000, unit: '$', delta: -2.1 },
      { label: 'Gross Margin', value: 38, target: 45, unit: '%', delta: 1.7 },
      { label: 'Runway', value: 14, target: 18, unit: '', delta: 1.0 },
      { label: 'DPO', value: 32, target: 45, unit: '', delta: 2.5 },
    ] },
  { id: 'support', name: 'Support', kpis: [
      { label: 'CSAT', value: 4.6, target: 4.8, unit: '', delta: 0.2 },
      { label: 'Tickets Resolved', value: 214, target: 250, unit: '', delta: 9.4 },
      { label: 'SLA Met', value: 96, target: 98, unit: '%', delta: 1.1 },
      { label: 'FRT (min)', value: 12, target: 8, unit: '', delta: -3.0 },
      { label: 'NPS', value: 41, target: 50, unit: '', delta: 2.8 },
    ] },
  { id: 'engineering', name: 'Engineering', kpis: [
      { label: 'Velocity', value: 86, target: 100, unit: '%', delta: 5.1 },
      { label: 'Deploys', value: 41, target: 50, unit: '', delta: 2.4 },
      { label: 'Bug Density', value: 3.2, target: 2.5, unit: '', delta: -0.8 },
      { label: 'Uptime', value: 99.92, target: 99.95, unit: '%', delta: 0.1 },
      { label: 'Lead Time', value: 4.1, target: 3, unit: '', delta: -1.2 },
    ] },
  { id: 'design', name: 'Design', kpis: [
      { label: 'Adoption', value: 78, target: 90, unit: '%', delta: 4.2 },
      { label: 'Components', value: 132, target: 150, unit: '', delta: 6.0 },
      { label: 'Reviews', value: 19, target: 25, unit: '', delta: 2.1 },
      { label: 'A11y Score', value: 88, target: 95, unit: '%', delta: 1.4 },
    ] },
  { id: 'people', name: 'People (HR)', kpis: [
      { label: 'Headcount', value: 42, target: 55, unit: '', delta: 6.0 },
      { label: 'eNPS', value: 47, target: 55, unit: '', delta: 3.2 },
      { label: 'Time-to-Hire', value: 34, target: 28, unit: '', delta: -2.4 },
      { label: 'Attrition', value: 11, target: 8, unit: '%', delta: -0.9 },
      { label: 'Training Hrs', value: 28, target: 40, unit: '', delta: 4.1 },
    ] },
  { id: 'operations', name: 'Operations', kpis: [
      { label: 'On-Time', value: 96, target: 98, unit: '%', delta: 0.7 },
      { label: 'Utilization', value: 73, target: 80, unit: '%', delta: 1.9 },
      { label: 'Cost / Unit', value: 18.4, target: 16, unit: '$', delta: -2.2 },
      { label: 'Backlog', value: 64, target: 40, unit: '', delta: -4.5 },
      { label: 'Quality', value: 99.1, target: 99.5, unit: '%', delta: 0.3 },
    ] },
  { id: 'product', name: 'Product', kpis: [
      { label: 'Activation', value: 58, target: 65, unit: '%', delta: 3.4 },
      { label: 'Retention', value: 91, target: 94, unit: '%', delta: 1.2 },
      { label: 'Features Shipped', value: 23, target: 30, unit: '', delta: 2.0 },
      { label: 'Churn', value: 3.1, target: 2, unit: '%', delta: -0.6 },
    ] },
  { id: 'success', name: 'Customer Success', kpis: [
      { label: 'Renewal Rate', value: 89, target: 92, unit: '%', delta: 1.5 },
      { label: 'Expansion', value: 22, target: 30, unit: '%', delta: 2.8 },
      { label: 'Health Score', value: 74, target: 80, unit: '', delta: 1.1 },
      { label: 'Touchpoints', value: 312, target: 350, unit: '', delta: 5.2 },
    ] },
  { id: 'security', name: 'Security & Compliance', kpis: [
      { label: 'Critical Vulns', value: 2, target: 0, unit: '', delta: -1.0 },
      { label: 'MTTR (hrs)', value: 6.5, target: 4, unit: '', delta: -1.4 },
      { label: 'Audit Pass', value: 96, target: 100, unit: '%', delta: 1.0 },
      { label: 'Coverage', value: 82, target: 90, unit: '%', delta: 2.0 },
    ] },
  { id: 'strategy', name: 'Strategy & Exec', kpis: [
      { label: 'OKR Attain', value: 71, target: 80, unit: '%', delta: 2.6 },
      { label: 'Valuation', value: 268, target: 400, unit: '$', delta: 5.5 },
      { label: 'Market Share', value: 6.4, target: 9, unit: '%', delta: 0.8 },
      { label: 'Innovation Index', value: 63, target: 75, unit: '', delta: 1.7 },
    ] },
];

export const INITIAL_TASKS: Task[] = [];

export const CONNECTORS: Connector[] = [
  { id: 'c-hubspot', name: 'HubSpot', provider: 'Composio — CRM', kind: 'composio', status: 'off', description: 'Sync contacts, deals and activities via HubSpot toolkit.', lastSync: '…' },
  { id: 'c-gmail', name: 'Gmail', provider: 'Composio — Gmail', kind: 'composio', status: 'off', description: 'Read, draft and send email on demand.', lastSync: '…' },
  { id: 'c-calendar', name: 'Google Calendar', provider: 'Composio — Google Calendar', kind: 'composio', status: 'off', description: 'Schedule meetings and reminders.', lastSync: '…' },
  { id: 'c-slack', name: 'Slack', provider: 'Composio — Sync', kind: 'composio', status: 'off', description: 'Post updates and delegate tasks to channels.', lastSync: '…' },
  { id: 'c-stripe', name: 'Stripe', provider: 'Composio — Payments', kind: 'composio', status: 'off', description: 'Invoices, billing and payment events.', lastSync: '…' },
  { id: 'c-drive', name: 'Google Drive', provider: 'Composio — Drive', kind: 'composio', status: 'off', description: 'Search and summarise documents & schemas.', lastSync: '…' },
  { id: 'c-facebook', name: 'Facebook', provider: 'Composio — Social', kind: 'composio', status: 'off', description: 'Schedule and publish to Facebook pages.', lastSync: '…' },
  { id: 'c-linkedin', name: 'LinkedIn', provider: 'Composio — Social', kind: 'composio', status: 'off', description: 'Post updates and monitor engagement.', lastSync: '…' },
  { id: 'c-crm', name: 'Company CRM', provider: 'Company Engine API', kind: 'crm', status: 'off', description: 'Pull customers and deals from your CRM (AI Platform → Company Engine).', lastSync: '…' },
  { id: 'c-graphify', name: 'Graphify', provider: 'knowledge graph', kind: 'data', status: 'off', description: 'Queryable knowledge graph over docs & code.', lastSync: '…' },
];

export const INITIAL_POSTS: SocialPost[] = [];

export const INITIAL_LEADS: Lead[] = [];

export const INITIAL_WORKFLOWS: Workflow[] = [];

export const PRIORITY_LABEL: Record<Priority, string> = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low' };
export const PRIORITY_COLOR: Record<Priority, string> = {
  P0: 'text-red-500 bg-red-500/10 ring-red-500/30',
  P1: 'text-amber-500 bg-amber-500/10 ring-amber-500/30',
  P2: 'text-sky-500 bg-sky-500/10 ring-sky-500/30',
  P3: 'text-muted-foreground bg-muted/50 ring-border',
};

export const CHANNEL_LABEL: Record<SocialChannel, string> = {
  linkedin: 'LinkedIn', twitter: 'X / Twitter', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok',
};
export const CHANNEL_COLOR: Record<SocialChannel, string> = {
  linkedin: 'text-sky-600 bg-sky-500/10 ring-sky-500/30',
  twitter: 'text-slate-800 bg-slate-200/40 ring-slate-500/30 dark:text-slate-200',
  facebook: 'text-blue-600 bg-blue-500/10 ring-blue-500/30',
  instagram: 'text-pink-600 bg-pink-500/10 ring-pink-500/30',
  tiktok: 'text-cyan-600 bg-cyan-500/10 ring-cyan-500/30',
};

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New', qualified: 'Qualified', proposal: 'Proposal', won: 'Won', lost: 'Lost',
};
export const STAGE_COLOR: Record<LeadStage, string> = {
  new: 'text-sky-600 bg-sky-500/10 ring-sky-500/30',
  qualified: 'text-amber-600 bg-amber-500/10 ring-amber-500/30',
  proposal: 'text-violet-600 bg-violet-500/10 ring-violet-500/30',
  won: 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30',
  lost: 'text-rose-600 bg-rose-500/10 ring-rose-500/30',
};

// ---------------------------------------------------------------------------
// Finance, approvals, goals, toolkits & app connections (DB-backed)
// ---------------------------------------------------------------------------

export type GoalStatus = 'on-track' | 'at-risk' | 'behind' | 'done';

export interface Goal {
  id: string;
  title: string;
  objective: string;
  kpis: string;
  owner: string;
  due: string;
  status: GoalStatus;
  progress: number; // 0-100
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalCategory = 'budget' | 'spend' | 'hire' | 'policy' | 'other';

export interface Approval {
  id: string;
  title: string;
  description: string;
  category: ApprovalCategory;
  amount: number;
  status: ApprovalStatus;
  submittedBy: string;
  createdAt: string;
  journalId?: string; // when set, approving this request auto-posts the journal entry
  /** Autonomous-mode payment gate: when set, approving this request executes the deferred payment. */
  pendingPayment?: {
    kind: 'invoice' | 'bill';
    targetId: string; // Invoice.id or Bill.id
    method: PaymentMethod;
    paidOnIso: string;
    externalRef?: string;
  };
  /** Autonomous-mode outbound-communication gate: when set, approving this request sends the held message. */
  pendingSend?: {
    kind: 'invoice-email' | 'bill-email';
    targetId: string;
    to: string;
    subject: string;
    body: string;
  };
  /** Autonomous-agent gate: when set, approving this request executes the deferred third-party (Composio) action. */
  pendingComposio?: {
    app: string;
    action: string;
    parameters: Record<string, unknown>;
    entityId: string;
  };
  /** Tier 6 gate: approving executes the deferred MCP tool call. */
  pendingMcp?: {
    server: string;
    tool: string;
    params: Record<string, unknown>;
  };
  /** Tier 6 gate: approving runs the deferred company workflow. */
  pendingWorkflow?: {
    workflowName: string;
  };
}

/** Journal postings at or above this value require an approval before they hit the GL. */
export const POSTING_APPROVAL_THRESHOLD = 25000;

/** In autonomous mode, payments at or above this value are held for approval instead of executing immediately. */
export const AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD = 5000;

export type FinanceKind = 'revenue' | 'expense' | 'invoice' | 'credit';

export interface FinanceEntry {
  id: string;
  label: string;
  amount: number; // positive; kind determines sign
  category: string;
  kind: FinanceKind;
  dateIso?: string; // machine-readable transaction date
  dueDateIso?: string; // transaction due date
  paymentMethod?: PaymentMethod;
  createdAt?: string; // ISO timestamp
  externalRef?: string; // external system reference (cheque, bank txn, PO—)
  taxProfileName?: string; // tax profile applied when posted
  source?: 'manual' | 'auto'; // auto = system-posted (invoice/bill settlement) — locked against deletion
  voidedAt?: string; // ISO — set when the entry is voided (audit trace, never deleted)
  voidReason?: string;
  projectId?: string; // links this entry to a Project for project financial tracking
  accountId?: string; // GlAccount.id — categorizes this entry against the chart of accounts
}

export type ConnType = 'tool' | 'llm' | 'voice';

export interface AppConnection {
  id: string;
  type: ConnType;
  provider: string; // brand, e.g. gmail, slack, gemini, elevenlabs
  label: string;
  status: 'connected' | 'connecting' | 'off' | 'error';
  account?: string;
  scopes?: string;
  lastSync: string;
}

export interface Toolkit {
  id: string;
  name: string;
  category: string;
  description: string;
  composioAppName: string;
  installed?: boolean;
  installedAt?: string;
}

export const INITIAL_GOALS: Goal[] = [];

export const INITIAL_APPROVALS: Approval[] = [];

export const INITIAL_FINANCE: FinanceEntry[] = [];

// Toolkit catalog — mirrors composio.dev app categories, searchable in-app.
// When a live Composio API key is configured, the full catalog is fetched dynamically
// and merged with this list. This static list is the fallback / seed.
export const COMPOSIO_TOOLKITS: Toolkit[] = [
  // ── Email ──────────────────────────────────────────────────────────────────
  { id: 'tk-gmail', name: 'Gmail', category: 'Email', composioAppName: 'gmail', description: 'Read, draft and send email; manage threads and labels on demand.' },
  { id: 'tk-outlook', name: 'Outlook', category: 'Email', composioAppName: 'outlook', description: 'Read and send Outlook / Microsoft 365 mail and calendar.' },
  { id: 'tk-sendgrid', name: 'SendGrid', category: 'Email', composioAppName: 'sendgrid', description: 'Programmatic email delivery and templates.' },
  { id: 'tk-mailchimp', name: 'Mailchimp', category: 'Email', composioAppName: 'mailchimp', description: 'Email campaigns, audiences and marketing automation.' },
  { id: 'tk-mailgun', name: 'Mailgun', category: 'Email', composioAppName: 'mailgun', description: 'Transactional email delivery via API.' },
  { id: 'tk-postmark', name: 'Postmark', category: 'Email', composioAppName: 'postmark', description: 'Fast transactional email delivery and bounce tracking.' },
  { id: 'tk-klaviyo', name: 'Klaviyo', category: 'Email', composioAppName: 'klaviyo', description: 'E-commerce email and SMS marketing automation.' },

  // ── Scheduling ─────────────────────────────────────────────────────────────
  { id: 'tk-calendar', name: 'Google Calendar', category: 'Scheduling', composioAppName: 'googlecalendar', description: 'Create events, book meetings and reconcile schedules.' },
  { id: 'tk-calendly', name: 'Calendly', category: 'Scheduling', composioAppName: 'calendly', description: 'Automate scheduling and meeting invites.' },
  { id: 'tk-cal', name: 'Cal.com', category: 'Scheduling', composioAppName: 'cal', description: 'Open-source scheduling and availability management.' },
  { id: 'tk-acuity', name: 'Acuity Scheduling', category: 'Scheduling', composioAppName: 'acuityscheduling', description: 'Client booking and appointment management.' },

  // ── Docs & Storage ─────────────────────────────────────────────────────────
  { id: 'tk-drive', name: 'Google Drive', category: 'Docs & Storage', composioAppName: 'googledrive', description: 'Search, read and summarise documents and sheets.' },
  { id: 'tk-docs', name: 'Google Docs', category: 'Docs & Storage', composioAppName: 'googledocs', description: 'Create and edit shared documents and briefs.' },
  { id: 'tk-sheets', name: 'Google Sheets', category: 'Docs & Storage', composioAppName: 'googlesheets', description: 'Read, write and analyse spreadsheet data.' },
  { id: 'tk-notion', name: 'Notion', category: 'Docs & Storage', composioAppName: 'notion', description: 'Pages, wikis and structured knowledge for the fleet.' },
  { id: 'tk-dropbox', name: 'Dropbox', category: 'Docs & Storage', composioAppName: 'dropbox', description: 'File storage, sharing and collaboration.' },
  { id: 'tk-onedrive', name: 'OneDrive', category: 'Docs & Storage', composioAppName: 'onedrive', description: 'Microsoft cloud file storage and sharing.' },
  { id: 'tk-box', name: 'Box', category: 'Docs & Storage', composioAppName: 'box', description: 'Enterprise cloud content management and collaboration.' },
  { id: 'tk-confluence', name: 'Confluence', category: 'Docs & Storage', composioAppName: 'confluence', description: 'Team wikis, documentation and knowledge bases.' },
  { id: 'tk-airtable', name: 'Airtable', category: 'Docs & Storage', composioAppName: 'airtable', description: 'Flexible database and spreadsheet hybrid for structured data.' },
  { id: 'tk-coda', name: 'Coda', category: 'Docs & Storage', composioAppName: 'coda', description: 'Collaborative docs that combine text, tables and automations.' },

  // ── Messaging ─────────────────────────────────────────────────────────────
  { id: 'tk-slack', name: 'Slack', category: 'Messaging', composioAppName: 'slack', description: 'Post updates, create channels and delegate tasks to teams.' },
  { id: 'tk-telegram', name: 'Telegram', category: 'Messaging', composioAppName: 'telegram', description: 'Chat notifications and command routing.' },
  { id: 'tk-discord', name: 'Discord', category: 'Messaging', composioAppName: 'discord', description: 'Channel posts and role-based automation.' },
  { id: 'tk-teams', name: 'Microsoft Teams', category: 'Messaging', composioAppName: 'microsoftteams', description: 'Send messages and manage channels in Microsoft Teams.' },
  { id: 'tk-whatsapp-biz', name: 'WhatsApp Business', category: 'Messaging', composioAppName: 'whatsapp', description: 'Send templated and session messages to customers.' },
  { id: 'tk-intercom', name: 'Intercom', category: 'Messaging', composioAppName: 'intercom', description: 'Customer messaging, support tickets and live chat.' },
  { id: 'tk-zendesk', name: 'Zendesk', category: 'Messaging', composioAppName: 'zendesk', description: 'Support tickets, macros and customer conversation management.' },
  { id: 'tk-freshdesk', name: 'Freshdesk', category: 'Messaging', composioAppName: 'freshdesk', description: 'Helpdesk tickets, agents and SLA management.' },

  // ── CRM ───────────────────────────────────────────────────────────────────
  { id: 'tk-hubspot', name: 'HubSpot', category: 'CRM', composioAppName: 'hubspot', description: 'Sync contacts, deals, tickets and marketing activities.' },
  { id: 'tk-salesforce', name: 'Salesforce', category: 'CRM', composioAppName: 'salesforce', description: 'Manage accounts, opportunities and forecasting.' },
  { id: 'tk-pipedrive', name: 'Pipedrive', category: 'CRM', composioAppName: 'pipedrive', description: 'Sales pipeline, deals and activity tracking.' },
  { id: 'tk-zoho-crm', name: 'Zoho CRM', category: 'CRM', composioAppName: 'zohocrm', description: 'Leads, contacts, opportunities and sales automation.' },
  { id: 'tk-close', name: 'Close CRM', category: 'CRM', composioAppName: 'close', description: 'Inside sales CRM with built-in calling and email.' },
  { id: 'tk-copper', name: 'Copper', category: 'CRM', composioAppName: 'copper', description: 'Google Workspace—native CRM for relationship management.' },
  { id: 'tk-attio', name: 'Attio', category: 'CRM', composioAppName: 'attio', description: 'Data-driven CRM with flexible objects and workflows.' },

  // ── Payments & Finance ────────────────────────────────────────────────────
  { id: 'tk-stripe', name: 'Stripe', category: 'Payments', composioAppName: 'stripe', description: 'Invoices, subscriptions, refunds and payment events.' },
  { id: 'tk-paypal', name: 'PayPal', category: 'Payments', composioAppName: 'paypal', description: 'Send, receive and track PayPal payments.' },
  { id: 'tk-quickbooks', name: 'QuickBooks', category: 'Payments', composioAppName: 'quickbooks', description: 'Accounting, invoicing and financial reporting.' },
  { id: 'tk-xero', name: 'Xero', category: 'Payments', composioAppName: 'xero', description: 'Accounting, bank reconciliation and invoicing.' },
  { id: 'tk-braintree', name: 'Braintree', category: 'Payments', composioAppName: 'braintree', description: 'PayPal-owned payment gateway for subscriptions and transactions.' },
  { id: 'tk-chargebee', name: 'Chargebee', category: 'Payments', composioAppName: 'chargebee', description: 'Subscription billing and revenue operations.' },
  { id: 'tk-freshbooks', name: 'FreshBooks', category: 'Payments', composioAppName: 'freshbooks', description: 'Invoicing, expenses and time-tracking for small businesses.' },

  // ── Social ────────────────────────────────────────────────────────────────
  { id: 'tk-linkedin', name: 'LinkedIn', category: 'Social', composioAppName: 'linkedin', description: 'Publish posts and monitor engagement on company pages.' },
  { id: 'tk-facebook', name: 'Facebook', category: 'Social', composioAppName: 'facebook', description: 'Schedule and publish to Facebook pages and groups.' },
  { id: 'tk-twitter', name: 'X / Twitter', category: 'Social', composioAppName: 'twitter', description: 'Post threads, reply and track audience growth.' },
  { id: 'tk-instagram', name: 'Instagram', category: 'Social', composioAppName: 'instagram', description: 'Schedule posts and monitor brand engagement on Instagram.' },
  { id: 'tk-youtube', name: 'YouTube', category: 'Social', composioAppName: 'youtube', description: 'Upload videos, manage playlists and monitor analytics.' },
  { id: 'tk-tiktok', name: 'TikTok', category: 'Social', composioAppName: 'tiktok', description: 'Publish short-form video content and track performance.' },
  { id: 'tk-pinterest', name: 'Pinterest', category: 'Social', composioAppName: 'pinterest', description: 'Create and schedule pins and boards.' },
  { id: 'tk-reddit', name: 'Reddit', category: 'Social', composioAppName: 'reddit', description: 'Post, comment and monitor community threads.' },
  { id: 'tk-buffer', name: 'Buffer', category: 'Social', composioAppName: 'buffer', description: 'Schedule social media posts across multiple channels.' },
  { id: 'tk-hootsuite', name: 'Hootsuite', category: 'Social', composioAppName: 'hootsuite', description: 'Manage and schedule social media from a single dashboard.' },

  // ── Dev ───────────────────────────────────────────────────────────────────
  { id: 'tk-github', name: 'GitHub', category: 'Dev', composioAppName: 'github', description: 'Repos, issues, PRs and CI automation for the engineering floor.' },
  { id: 'tk-gitlab', name: 'GitLab', category: 'Dev', composioAppName: 'gitlab', description: 'Source control, CI/CD pipelines and merge requests.' },
  { id: 'tk-jira', name: 'Jira', category: 'Dev', composioAppName: 'jira', description: 'Issues, sprints and delivery reporting for PM.' },
  { id: 'tk-linear', name: 'Linear', category: 'Dev', composioAppName: 'linear', description: 'Fast issue tracking and project management for engineering teams.' },
  { id: 'tk-sentry', name: 'Sentry', category: 'Dev', composioAppName: 'sentry', description: 'Error tracking, performance monitoring and alerting.' },
  { id: 'tk-datadog', name: 'Datadog', category: 'Dev', composioAppName: 'datadog', description: 'Infrastructure monitoring, APM and log management.' },
  { id: 'tk-pagerduty', name: 'PagerDuty', category: 'Dev', composioAppName: 'pagerduty', description: 'On-call incident management and alert routing.' },
  { id: 'tk-circleci', name: 'CircleCI', category: 'Dev', composioAppName: 'circleci', description: 'Continuous integration and deployment pipelines.' },
  { id: 'tk-vercel', name: 'Vercel', category: 'Dev', composioAppName: 'vercel', description: 'Frontend deployments, previews and edge functions.' },
  { id: 'tk-supabase', name: 'Supabase', category: 'Dev', composioAppName: 'supabase', description: 'Open-source Firebase alternative — auth, DB, storage.' },
  { id: 'tk-figma', name: 'Figma', category: 'Dev', composioAppName: 'figma', description: 'Read design files, components and comments.' },

  // ── Project Mgmt ──────────────────────────────────────────────────────────
  { id: 'tk-asana', name: 'Asana', category: 'Project Mgmt', composioAppName: 'asana', description: 'Tasks, projects and portfolio-level tracking.' },
  { id: 'tk-trello', name: 'Trello', category: 'Project Mgmt', composioAppName: 'trello', description: 'Board-based task automation.' },
  { id: 'tk-clickup', name: 'ClickUp', category: 'Project Mgmt', composioAppName: 'clickup', description: 'Docs, tasks and goals in one workspace.' },
  { id: 'tk-monday', name: 'Monday.com', category: 'Project Mgmt', composioAppName: 'monday', description: 'Work OS for project planning and team collaboration.' },
  { id: 'tk-basecamp', name: 'Basecamp', category: 'Project Mgmt', composioAppName: 'basecamp', description: 'Project management with to-dos, messages and schedules.' },
  { id: 'tk-wrike', name: 'Wrike', category: 'Project Mgmt', composioAppName: 'wrike', description: 'Collaborative work management with Gantt and dashboards.' },
  { id: 'tk-smartsheet', name: 'Smartsheet', category: 'Project Mgmt', composioAppName: 'smartsheet', description: 'Grid-based project management and automation.' },
  { id: 'tk-height', name: 'Height', category: 'Project Mgmt', composioAppName: 'height', description: 'Autonomous project management with AI-driven workflows.' },

  // ── Comms & Calls ─────────────────────────────────────────────────────────
  { id: 'tk-twilio', name: 'Twilio', category: 'Comms', composioAppName: 'twilio', description: 'SMS and call workflows for outreach and alerts.' },
  { id: 'tk-zoom', name: 'Zoom', category: 'Comms', composioAppName: 'zoom', description: 'Schedule, join and summarise meetings.' },
  { id: 'tk-googlemet', name: 'Google Meet', category: 'Comms', composioAppName: 'googlemeet', description: 'Create and manage Google Meet video calls.' },
  { id: 'tk-webex', name: 'Webex', category: 'Comms', composioAppName: 'webex', description: 'Video meetings, messaging and calling on Cisco Webex.' },
  { id: 'tk-aircall', name: 'Aircall', category: 'Comms', composioAppName: 'aircall', description: 'Cloud phone system with call logging and analytics.' },
  { id: 'tk-ringcentral', name: 'RingCentral', category: 'Comms', composioAppName: 'ringcentral', description: 'Cloud communications, video and contact centre.' },

  // ── E-commerce ────────────────────────────────────────────────────────────
  { id: 'tk-shopify', name: 'Shopify', category: 'E-commerce', composioAppName: 'shopify', description: 'Orders, products, customers and inventory management.' },
  { id: 'tk-woocommerce', name: 'WooCommerce', category: 'E-commerce', composioAppName: 'woocommerce', description: 'WordPress e-commerce orders, products and customers.' },
  { id: 'tk-bigcommerce', name: 'BigCommerce', category: 'E-commerce', composioAppName: 'bigcommerce', description: 'Multi-channel e-commerce catalogue and fulfilment.' },

  // ── HR & Recruiting ────────────────────────────────────────────────────────
  { id: 'tk-workday', name: 'Workday', category: 'HR', composioAppName: 'workday', description: 'HR, payroll and workforce management.' },
  { id: 'tk-greenhouse', name: 'Greenhouse', category: 'HR', composioAppName: 'greenhouse', description: 'Applicant tracking and structured hiring workflows.' },
  { id: 'tk-lever', name: 'Lever', category: 'HR', composioAppName: 'lever', description: 'Recruiting CRM and ATS for talent acquisition.' },
  { id: 'tk-bamboohr', name: 'BambooHR', category: 'HR', composioAppName: 'bamboohr', description: 'Employee records, onboarding and performance tracking.' },
  { id: 'tk-gusto', name: 'Gusto', category: 'HR', composioAppName: 'gusto', description: 'Payroll, benefits and HR for small and medium businesses.' },
  { id: 'tk-rippling', name: 'Rippling', category: 'HR', composioAppName: 'rippling', description: 'Unified HR, IT and finance workforce platform.' },

  // ── Analytics & BI ────────────────────────────────────────────────────────
  { id: 'tk-ga4', name: 'Google Analytics', category: 'Analytics', composioAppName: 'googleanalytics', description: 'Website traffic, conversions and audience insights.' },
  { id: 'tk-mixpanel', name: 'Mixpanel', category: 'Analytics', composioAppName: 'mixpanel', description: 'Product analytics: funnels, retention and user journeys.' },
  { id: 'tk-amplitude', name: 'Amplitude', category: 'Analytics', composioAppName: 'amplitude', description: 'Behavioural analytics and A/B testing for product teams.' },
  { id: 'tk-segment', name: 'Segment', category: 'Analytics', composioAppName: 'segment', description: 'Customer data platform: collect, unify and route events.' },
  { id: 'tk-tableau', name: 'Tableau', category: 'Analytics', composioAppName: 'tableau', description: 'Business intelligence dashboards and data visualisation.' },
  { id: 'tk-looker', name: 'Looker', category: 'Analytics', composioAppName: 'looker', description: 'Data exploration and embedded analytics (Google Cloud).' },

  // ── AI & Automation ────────────────────────────────────────────────────────
  { id: 'tk-zapier', name: 'Zapier', category: 'Automation', composioAppName: 'zapier', description: 'Trigger and manage Zapier workflows from agents.' },
  { id: 'tk-make', name: 'Make (Integromat)', category: 'Automation', composioAppName: 'make', description: 'Visual automation scenarios across hundreds of apps.' },
  { id: 'tk-n8n', name: 'n8n', category: 'Automation', composioAppName: 'n8n', description: 'Open-source workflow automation with self-hosted option.' },
  { id: 'tk-openai-api', name: 'OpenAI', category: 'Automation', composioAppName: 'openai', description: 'Call GPT models and DALL-E from agent workflows.' },
  { id: 'tk-replicate', name: 'Replicate', category: 'Automation', composioAppName: 'replicate', description: 'Run open-source ML models via API.' },

  // ── Cloud & Infrastructure ─────────────────────────────────────────────────
  { id: 'tk-aws', name: 'AWS', category: 'Cloud', composioAppName: 'aws', description: 'Manage S3, Lambda, EC2 and other AWS services.' },
  { id: 'tk-gcp', name: 'Google Cloud', category: 'Cloud', composioAppName: 'googlecloud', description: 'Interact with GCS, BigQuery and GCP services.' },
  { id: 'tk-azure', name: 'Microsoft Azure', category: 'Cloud', composioAppName: 'azure', description: 'Manage Azure resources, storage and AI services.' },

  // ── Support & Surveys ──────────────────────────────────────────────────────
  { id: 'tk-typeform', name: 'Typeform', category: 'Surveys', composioAppName: 'typeform', description: 'Create forms, surveys and collect responses.' },
  { id: 'tk-surveymonkey', name: 'SurveyMonkey', category: 'Surveys', composioAppName: 'surveymonkey', description: 'Design surveys, collect responses and analyse results.' },
  { id: 'tk-hotjar', name: 'Hotjar', category: 'Analytics', composioAppName: 'hotjar', description: 'Heatmaps, session recordings and user feedback.' },
  { id: 'tk-delighted', name: 'Delighted', category: 'Surveys', composioAppName: 'delighted', description: 'NPS, CSAT and CES surveys for customer feedback.' },
];

export interface LlmProvider {
  id: string;
  label: string;
  baseUrl: string;
  accent: string;
  connectionId?: string;
  freeTierNote?: string;
  /** When the model list was last loaded live from the provider (epoch ms). */
  modelsLoadedAt?: number;
  /** Env var holding this provider's API key. Resolved server-side; never sent to the client. */
  envVar?: string;
  models: LlmModelInfo[];
}

// The catalog below is the SEED. At runtime it is stored per-workspace in the
// `llmCatalog` entity (DB-backed) so each company can add, remove or rename
// providers and models without code changes — including free OpenRouter models.
export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: 'llm-demo', label: 'Demo (no key)', baseUrl: '', accent: '#64748B', connectionId: 'cn-demo',
    envVar: '',
    freeTierNote: 'Always on — no signup needed',
    models: [
      { id: 'demo', label: 'Demo', tier: 'free', tag: 'built-in' },
    ],
  },
  {
    id: 'llm-groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', accent: '#F55036', connectionId: 'cn-groq',
    envVar: 'GROQ_API_KEY',
    freeTierNote: 'Free tier — console.groq.com',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'llama3-70b-8192', label: 'Llama 3 70B', tier: 'free', contextK: 8 },
      { id: 'llama3-8b-8192', label: 'Llama 3 8B', tier: 'free', contextK: 8, tag: 'fast' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8×7B', tier: 'free', contextK: 32 },
      { id: 'gemma2-9b-it', label: 'Gemma 2 9B', tier: 'free', contextK: 8 },
      { id: 'qwen-qwq-32b', label: 'QwQ 32B', tier: 'free', contextK: 128, tag: 'reasoning' },
      { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B', tier: 'free', contextK: 128, tag: 'reasoning' },
      { id: 'compound-beta', label: 'Compound Beta', tier: 'free', contextK: 128, tag: 'tool-use' },
    ],
  },
  {
    id: 'llm-ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', accent: '#FF6B35', connectionId: 'cn-ollama',
    envVar: '',
    freeTierNote: 'Free — runs on your hardware',
    models: [
      { id: 'llama3.3', label: 'Llama 3.3 70B', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'llama3.2', label: 'Llama 3.2 3B', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'mistral', label: 'Mistral 7B', tier: 'free', contextK: 32, tag: 'fast' },
      { id: 'phi4', label: 'Phi-4 14B', tier: 'free', contextK: 16, tag: 'coding' },
      { id: 'qwen2.5', label: 'Qwen 2.5 7B', tier: 'free', contextK: 128 },
      { id: 'deepseek-r1', label: 'DeepSeek R1 8B', tier: 'free', contextK: 64, tag: 'reasoning' },
      { id: 'gemma3', label: 'Gemma 3 12B', tier: 'free', contextK: 128 },
      { id: 'codellama', label: 'Code Llama 34B', tier: 'free', contextK: 16, tag: 'coding' },
    ],
  },
  {
    id: 'llm-gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', accent: '#4285F4', connectionId: 'cn-gemini',
    envVar: 'GEMINI_API_KEY',
    freeTierNote: 'Free tier — aistudio.google.com',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'free', contextK: 1000, tag: 'fast' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'paid', contextK: 1000, tag: 'powerful' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'free', contextK: 1000 },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', tier: 'free', contextK: 1000, tag: 'fast' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'free', contextK: 1000 },
      { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B', tier: 'free', contextK: 1000, tag: 'fast' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tier: 'paid', contextK: 2000 },
    ],
  },
  {
    id: 'llm-openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', accent: '#8B5CF6', connectionId: 'cn-openrouter',
    envVar: 'OPENROUTER_API_KEY',
    freeTierNote: 'Free + paid — openrouter.ai',
    models: [
      // ── Stealth / alpha drops (free during preview) ──────────────────────────
      { id: 'stealth/ox-alpha', label: 'Ox Alpha', tier: 'free', contextK: 1024, tag: 'stealth' },
      { id: 'openrouter/owl-alpha', label: 'Owl Alpha', tier: 'free', contextK: 1024, tag: 'stealth' },
      { id: 'openrouter/elephant-alpha', label: 'Elephant Alpha', tier: 'free', contextK: 256, tag: 'stealth' },
      // ── Free models ──────────────────────────────────────────────────────────
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'meta-llama/llama-3.2-3b-instruct:free', label: 'Llama 3.2 3B', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'meta-llama/llama-3.2-1b-instruct:free', label: 'Llama 3.2 1B', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'google/gemma-2-9b-it:free', label: 'Gemma 2 9B', tier: 'free', contextK: 8, tag: 'fast' },
      { id: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'google/gemini-flash-1.5:free', label: 'Gemini Flash 1.5', tier: 'free', contextK: 1000, tag: 'fast' },
      { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash Exp', tier: 'free', contextK: 1000, tag: 'fast' },
      { id: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B', tier: 'free', contextK: 32, tag: 'fast' },
      { id: 'mistralai/mixtral-8x7b-instruct:free', label: 'Mixtral 8×7B', tier: 'free', contextK: 32, tag: 'powerful' },
      { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1', tier: 'free', contextK: 64, tag: 'reasoning' },
      { id: 'deepseek/deepseek-chat:free', label: 'DeepSeek Chat', tier: 'free', contextK: 64 },
      { id: 'deepseek/deepseek-v3:free', label: 'DeepSeek V3', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'qwen/qwq-32b:free', label: 'QwQ 32B', tier: 'free', contextK: 128, tag: 'reasoning' },
      { id: 'qwen/qwen2.5-72b-instruct:free', label: 'Qwen 2.5 72B', tier: 'free', contextK: 32, tag: 'powerful' },
      { id: 'qwen/qwen2.5-coder-32b-instruct:free', label: 'Qwen 2.5 Coder 32B', tier: 'free', contextK: 32, tag: 'coding' },
      { id: 'qwen/qwen2.5-7b-instruct:free', label: 'Qwen 2.5 7B', tier: 'free', contextK: 32, tag: 'fast' },
      { id: 'qwen/qwen3-32b:free', label: 'Qwen 3 32B', tier: 'free', contextK: 128, tag: 'reasoning' },
      { id: 'microsoft/phi-3.5-mini-128k-instruct:free', label: 'Phi 3.5 Mini', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'microsoft/phi-4-mini-reasoning:free', label: 'Phi 4 Mini Reasoning', tier: 'free', contextK: 128, tag: 'reasoning' },
      { id: 'moonshotai/kimi-dev-72b:free', label: 'Kimi Dev 72B', tier: 'free', contextK: 128, tag: 'coding' },
      { id: 'liquid/lfm-40b:free', label: 'LFM 40B', tier: 'free', contextK: 32, tag: 'powerful' },
      { id: 'allenai/olmo-2-1124-13b-instruct:free', label: 'OLMo 2 13B', tier: 'free', contextK: 32 },
      { id: 'cognitivecomputations/dolphin-mistral-24b:free', label: 'Dolphin Mistral 24B', tier: 'free', contextK: 16 },
      { id: 'openchat/openchat-7b:free', label: 'OpenChat 7B', tier: 'free', contextK: 32 },
      { id: 'huggingfaceh4/zephyr-7b-beta:free', label: 'Zephyr 7B', tier: 'free', contextK: 32 },
      { id: 'teknium/openhermes-2.5-mistral-7b:free', label: 'OpenHermes 7B', tier: 'free', contextK: 32 },
      { id: 'thudm/glm-4-32b:free', label: 'GLM 4 32B', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'zhipu/glm-z1-32b:free', label: 'GLM Z1 32B', tier: 'free', contextK: 32, tag: 'reasoning' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', label: 'Nemotron 70B', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'sapientlab/sapient-expanse-8b:free', label: 'Sapient Expanse 8B', tier: 'free', contextK: 32 },
      { id: 'infermatic/mn-instruct-fimbul-3b:free', label: 'Fimbul 3B', tier: 'free', contextK: 8, tag: 'fast' },
      // ── Premium (paid) ───────────────────────────────────────────────────────
      { id: 'openai/gpt-4o', label: 'GPT-4o', tier: 'paid', contextK: 128 },
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tier: 'paid', contextK: 200 },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'paid', contextK: 1000 },
      { id: 'x-ai/grok-3', label: 'Grok 3', tier: 'paid', contextK: 131 },
    ],
  },
  {
    id: 'llm-nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', accent: '#76B900', connectionId: 'cn-nvidia',
    envVar: 'NVIDIA_API_KEY',
    freeTierNote: 'Free credits — build.nvidia.com',
    models: [
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Llama 3.1 Nemotron 70B', tier: 'credits', contextK: 128, tag: 'powerful' },
      { id: 'nvidia/mistral-nemotron-12b-instruct', label: 'Mistral NeMo 12B', tier: 'credits', contextK: 128, tag: 'fast' },
      { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', tier: 'credits', contextK: 128 },
      { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B', tier: 'credits', contextK: 128 },
      { id: 'mistralai/mixtral-8x22b-instruct-v0.1', label: 'Mixtral 8×22B', tier: 'credits', contextK: 65 },
      { id: 'google/gemma-3-27b-it', label: 'Gemma 3 27B', tier: 'credits', contextK: 128 },
      { id: 'qwen/qwen2.5-72b-instruct', label: 'Qwen 2.5 72B', tier: 'credits', contextK: 32 },
      { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1', tier: 'credits', contextK: 64, tag: 'reasoning' },
    ],
  },
  {
    id: 'llm-claude', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', accent: '#D97757', connectionId: 'cn-claude',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4', label: 'Claude Opus 4', tier: 'paid', contextK: 200, tag: 'powerful' },
      { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'paid', contextK: 200 },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', tier: 'paid', contextK: 200, tag: 'fast' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', tier: 'paid', contextK: 200, tag: 'fast' },
      { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', tier: 'paid', contextK: 200 },
    ],
  },
  {
    id: 'llm-openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', accent: '#10A37F', connectionId: 'cn-openai',
    envVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', tier: 'paid', contextK: 128, tag: 'powerful' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', tier: 'paid', contextK: 128, tag: 'fast' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', tier: 'paid', contextK: 128, tag: 'fast' },
      { id: 'gpt-4o', label: 'GPT-4o', tier: 'paid', contextK: 128, tag: 'powerful' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', tier: 'paid', contextK: 128, tag: 'fast' },
      { id: 'o1', label: 'o1', tier: 'paid', contextK: 200, tag: 'reasoning' },
      { id: 'o3-mini', label: 'o3 Mini', tier: 'paid', contextK: 200, tag: 'reasoning' },
      { id: 'o4-mini', label: 'o4 Mini', tier: 'paid', contextK: 200, tag: 'reasoning' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', tier: 'paid', contextK: 128 },
    ],
  },
  {
    id: 'llm-cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', accent: '#F15A29',
    envVar: 'CEREBRAS_API_KEY',
    freeTierNote: 'Free tier — cloud.cerebras.ai. Use "Load free models" for the current list.',
    models: [
      { id: 'llama-3.3-70b', label: 'Llama 3.3 70B', tier: 'free', contextK: 128, tag: 'powerful' },
      { id: 'llama3.1-8b', label: 'Llama 3.1 8B', tier: 'free', contextK: 128, tag: 'fast' },
    ],
  },
  {
    id: 'llm-sambanova', label: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1', accent: '#EE7624',
    envVar: 'SAMBANOVA_API_KEY',
    freeTierNote: 'Free tier — cloud.sambanova.ai. Use "Load free models" for the current list.',
    models: [
      { id: 'Meta-Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', tier: 'free', contextK: 128, tag: 'powerful' },
    ],
  },
  {
    id: 'llm-mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', accent: '#FA520F',
    envVar: 'MISTRAL_API_KEY',
    freeTierNote: 'Free Experiment plan — console.mistral.ai. Use "Load free models" for the current list.',
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small', tier: 'free', contextK: 128, tag: 'fast' },
      { id: 'open-mistral-nemo', label: 'Mistral NeMo', tier: 'free', contextK: 128 },
    ],
  },
  {
    id: 'llm-custom', label: 'Custom endpoint', baseUrl: '', accent: '#94A3B8', connectionId: 'cn-custom',
    envVar: 'LLM_API_KEY',
    models: [
      { id: 'custom', label: 'Custom model', tier: 'paid' },
    ],
  },
];

export const VOICE_PROVIDERS: { id: string; label: string; kind: string; accent: string }[] = [
  { id: 'voice-elevenlabs', label: 'ElevenLabs', kind: 'Text-to-speech — 100+ voices', accent: '#000000' },
  { id: 'voice-fish', label: 'Fish Audio', kind: 'Text-to-speech — Fish Bowl models', accent: '#22C55E' },
];

export type EmailAppStatus = 'connected' | 'connecting' | 'off';
export interface EmailApp {
  id: string;
  label: string;
  provider: string;
  composioAppName: string;
  accent: string;
  description: string;
}
export const EMAIL_APPS: EmailApp[] = [
  { id: 'email-gmail', label: 'Gmail', provider: 'Google', composioAppName: 'gmail', accent: '#EA4335', description: 'Read, send, label and search Gmail' },
  { id: 'email-outlook', label: 'Outlook', provider: 'Microsoft', composioAppName: 'outlook', accent: '#0078D4', description: 'Read, send and manage Outlook / Microsoft 365 mail' },
  { id: 'email-yahoo', label: 'Yahoo Mail', provider: 'Yahoo', composioAppName: 'yahoo_mail', accent: '#6001D2', description: 'Read and send Yahoo Mail messages' },
];

export const INITIAL_CONNECTIONS: AppConnection[] = [
  { id: 'cn-gmail', type: 'tool', provider: 'gmail', label: 'Gmail', status: 'off', account: '', scopes: 'read, send, manage labels', lastSync: '…' },
  { id: 'cn-calendar', type: 'tool', provider: 'google-calendar', label: 'Google Calendar', status: 'off', account: '', scopes: 'read, write events', lastSync: '…' },
  { id: 'cn-slack', type: 'tool', provider: 'slack', label: 'Slack', status: 'off', account: '', scopes: 'post, read channels', lastSync: '…' },
  { id: 'cn-hubspot', type: 'tool', provider: 'hubspot', label: 'HubSpot', status: 'off', account: '', scopes: 'contacts, deals, tickets', lastSync: '…' },
  { id: 'cn-stripe', type: 'tool', provider: 'stripe', label: 'Stripe', status: 'off', account: '', scopes: 'invoices, payments', lastSync: '…' },
  { id: 'cn-drive', type: 'tool', provider: 'google-drive', label: 'Google Drive', status: 'off', account: '', scopes: 'read, search', lastSync: '…' },
  { id: 'cn-demo', type: 'llm', provider: 'demo', label: 'Demo (no key)', status: 'connected', account: 'built-in', scopes: 'chat completions — always on', lastSync: 'Just now' },
  { id: 'cn-ollama', type: 'llm', provider: 'ollama', label: 'Ollama (local)', status: 'off', account: '', scopes: 'chat completions — local', lastSync: '…' },
  { id: 'cn-groq', type: 'llm', provider: 'groq', label: 'Groq', status: 'off', account: '', scopes: 'chat completions — free tier', lastSync: '…' },
  { id: 'cn-nvidia', type: 'llm', provider: 'nvidia', label: 'NVIDIA NIM', status: 'off', account: '', scopes: 'chat completions', lastSync: '…' },
  { id: 'cn-gemini', type: 'llm', provider: 'gemini', label: 'Google Gemini', status: 'off', account: '', scopes: 'chat completions', lastSync: '…' },
  { id: 'cn-claude', type: 'llm', provider: 'claude', label: 'Anthropic Claude', status: 'off', account: '', scopes: 'chat completions', lastSync: '…' },
  { id: 'cn-openai', type: 'llm', provider: 'openai', label: 'OpenAI', status: 'off', account: '', scopes: 'chat completions', lastSync: '…' },
  { id: 'cn-openrouter', type: 'llm', provider: 'openrouter', label: 'OpenRouter', status: 'off', account: '', scopes: 'chat completions', lastSync: '…' },
  { id: 'cn-custom', type: 'llm', provider: 'custom', label: 'Custom endpoint', status: 'off', account: '', scopes: 'chat completions — OpenAI-compatible', lastSync: '…' },
  { id: 'cn-elevenlabs', type: 'voice', provider: 'elevenlabs', label: 'ElevenLabs', status: 'off', account: '', scopes: 'text-to-speech — outbound calls', lastSync: '…' },
  { id: 'cn-fish', type: 'voice', provider: 'fish', label: 'Fish Audio', status: 'off', account: '', scopes: 'text-to-speech', lastSync: '…' },
  { id: 'cn-whatsapp', type: 'tool', provider: 'whatsapp', label: 'WhatsApp Business', status: 'off', account: '', scopes: 'send, receive, templates', lastSync: '…' },
];

export const APPROVAL_LABEL: Record<ApprovalCategory, string> = {
  budget: 'Budget', spend: 'Spend', hire: 'Hire', policy: 'Policy', other: 'Other',
};

// ---------------------------------------------------------------------------
// Company operations sample: clients, bookings, drivers, SLA, tracking, analytics
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  name: string;
  contact: string;
  city: string;
  segment: string;
  active: boolean;
  bookingCount: number;
}

export type BookingStatus = 'pending' | 'confirmed' | 'in-transit' | 'delivered' | 'cancelled';

export interface Booking {
  id: string;
  ref: string;
  client: string;
  origin: string;
  dest: string;
  date: string;
  status: BookingStatus;
  value: number;
  vehicle: string;
  driver?: string;
}

export interface Driver {
  id: string;
  name: string;
  status: 'pending' | 'onboarding' | 'active';
  vehicle: string;
  joined: string;
  licence: string;
}

export interface SlaMetric {
  id: string;
  label: string;
  value: number;
  target: number;
  unit: string;
}

export interface OpsSeriesPoint {
  label: string;
  bookings: number;
  revenue: number;
  onTime: number; // %
}

export interface TrackingEvent {
  id: string;
  time: string;
  ref: string;
  location: string;
  state: string;
  note: string;
}

export interface OpsState {
  clients: Client[];
  bookings: Booking[];
  drivers: Driver[];
  sla: SlaMetric[];
  analytics: { series: OpsSeriesPoint[]; byStatus: Record<BookingStatus, number>; revenue: number; activeFleet: number };
  tracking: TrackingEvent[];
}

export const INITIAL_OPS: OpsState = {
  clients: [
    { id: 'c1', name: 'Northwind Logistics', contact: 'j.parker@northwind.io', city: 'Chicago', segment: 'Enterprise', active: true, bookingCount: 42 },
    { id: 'c2', name: 'Ferry Freight', contact: 'm.diaz@ferryfreight.com', city: 'Newark', segment: 'Mid-market', active: true, bookingCount: 27 },
    { id: 'c3', name: 'Gulfstream Marine', contact: 'r.lee@gulfstreammar.com', city: 'Houston', segment: 'Enterprise', active: true, bookingCount: 18 },
    { id: 'c4', name: 'Atlas Distribution', contact: 's.kim@atlasdist.net', city: 'LA', segment: 'Mid-market', active: false, bookingCount: 9 },
  ],
  bookings: [
    { id: 'b1', ref: 'BK-11024', client: 'Northwind Logistics', origin: 'Chicago IL', dest: 'Columbus OH', date: 'Today 09:00', status: 'in-transit', value: 12400, vehicle: 'TLX-420', driver: 'O. Rahman' },
    { id: 'b2', ref: 'BK-11025', client: 'Ferry Freight', origin: 'Newark NJ', dest: 'Baltimore MD', date: 'Today 11:30', status: 'confirmed', value: 8600, vehicle: 'TLX-118', driver: 'D. Whitfield' },
    { id: 'b3', ref: 'BK-11026', client: 'Gulfstream Marine', origin: 'Houston TX', dest: 'Dallas TX', date: 'Today 14:00', status: 'pending', value: 15900, vehicle: 'TRL-77', driver: '…' },
    { id: 'b4', ref: 'BK-11022', client: 'Northwind Logistics', origin: 'Cleveland OH', dest: 'Detroit MI', date: 'Yesterday', status: 'delivered', value: 7300, vehicle: 'TLX-306', driver: 'O. Rahman' },
    { id: 'b5', ref: 'BK-11020', client: 'Atlas Distribution', origin: 'LA CA', dest: 'Phoenix AZ', date: 'Mon', status: 'delivered', value: 10900, vehicle: 'TLX-512', driver: 'R. Osei' },
    { id: 'b6', ref: 'BK-11019', client: 'Ferry Freight', origin: 'Newark NJ', dest: 'Boston MA', date: 'Sun', status: 'cancelled', value: 6200, vehicle: '…', driver: '…' },
  ],
  drivers: [
    { id: 'd1', name: 'Omar Rahman', status: 'active', vehicle: 'TLX-420', joined: '2021', licence: 'CDL-A — HAZMAT' },
    { id: 'd2', name: 'DeShawn Whitfield', status: 'active', vehicle: 'TLX-118', joined: '2022', licence: 'CDL-A' },
    { id: 'd3', name: 'Roselyn Osei', status: 'active', vehicle: 'TLX-512', joined: '2022', licence: 'CDL-A — Tanker' },
    { id: 'd4', name: 'Mateo Silva', status: 'onboarding', vehicle: 'TLX-221', joined: 'This week', licence: 'CDL-B (in review)' },
    { id: 'd5', name: 'Grace Okafor', status: 'pending', vehicle: '…', joined: 'Screening', licence: 'CDL-A pending' },
  ],
  sla: [
    { id: 's1', label: 'On-time delivery', value: 96, target: 98, unit: '%' },
    { id: 's2', label: 'Avg pickup delay', value: 9, target: 15, unit: 'min' },
    { id: 's3', label: 'Booking confirm time', value: 42, target: 60, unit: 'min' },
    { id: 's4', label: 'Tracking coverage', value: 100, target: 95, unit: '%' },
  ],
  analytics: {
    series: [
      { label: 'W1', bookings: 118, revenue: 384, onTime: 95 },
      { label: 'W2', bookings: 132, revenue: 412, onTime: 96 },
      { label: 'W3', bookings: 141, revenue: 455, onTime: 94 },
      { label: 'W4', bookings: 158, revenue: 491, onTime: 97 },
      { label: 'W5', bookings: 149, revenue: 473, onTime: 96 },
      { label: 'W6', bookings: 172, revenue: 528, onTime: 97 },
    ],
    byStatus: { pending: 14, confirmed: 22, 'in-transit': 31, delivered: 118, cancelled: 9 },
    revenue: 528000,
    activeFleet: 14,
  },
  tracking: [
    { id: 't1', time: '14:32', ref: 'BK-11024', location: 'Toledo OH — I-75', state: 'in-transit', note: 'Arrived at hub 3, ETA 16:40.' },
    { id: 't2', time: '13:05', ref: 'BK-11022', location: 'Detroit MI', state: 'delivered', note: 'Signed off by A. Mercer.' },
    { id: 't3', time: '11:47', ref: 'BK-11025', location: 'Trenton NJ', state: 'confirmed', note: 'Loaded, awaiting departure window.' },
    { id: 't4', time: '09:58', ref: 'BK-11026', location: 'Houston TX', state: 'pending', note: 'Awaiting vehicle assignment.' },
  ],
};

export const BOOKING_STATUS_ORDER: BookingStatus[] = ['pending', 'confirmed', 'in-transit', 'delivered', 'cancelled'];

export const BOOKING_STATUS_STYLE: Record<BookingStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  confirmed: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  'in-transit': 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  delivered: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  cancelled: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

export interface ComposioConfig {
  apiKey: string;
  baseUrl: string;
  configured: boolean;
  account?: string;
  connections?: Array<{
    appId: string;
    appName: string;
    entityId: string;
    status: 'connected' | 'expired' | 'revoked';
    connectedAt: string;
    expiresAt?: string;
    lastUsed: string;
  }>;
}

export const DEFAULT_COMPOSIO: ComposioConfig = {
  apiKey: '',
  baseUrl: 'https://backend.composio.dev',
  configured: false,
};

// ---------------------------------------------------------------------------
// Communications: email / SMS / WhatsApp (single + bulk)
// ---------------------------------------------------------------------------

export type CommsChannel = 'email' | 'sms' | 'whatsapp' | 'telegram';
export type CommsStatus = 'sent' | 'scheduled' | 'failed';

export interface CommsMessage {
  id: string;
  channel: CommsChannel;
  to: string; // recipient display, e.g. "Rachel Kim <rachel@northwind.io>"
  recipients: string[]; // one address/phone per recipient reached
  subject: string;
  body: string;
  status: CommsStatus;
  mode: 'single' | 'bulk';
  count: number; // recipients reached (1 for single)
  sentAt: string;
}

export const COMMS_CHANNEL_LABEL: Record<CommsChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};
export const COMMS_CHANNEL_COLOR: Record<CommsChannel, string> = {
  email: 'text-sky-600 bg-sky-500/10 ring-sky-500/30',
  sms: 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30',
  whatsapp: 'text-green-700 bg-green-600/10 ring-green-600/30',
  telegram: 'text-sky-500 bg-sky-500/10 ring-sky-500/30',
};

export const INITIAL_MESSAGES: CommsMessage[] = [];

// ---------------------------------------------------------------------------
// Paid advertising campaigns + social summaries
// ---------------------------------------------------------------------------

export type AdPlatform = 'google' | SocialChannel;

export const AD_PLATFORM_LABEL: Record<AdPlatform, string> = {
  ...CHANNEL_LABEL,
  google: 'Google Ads',
};

export const AD_STATUS_STYLE: Record<AdCampaign['status'], string> = {
  active: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  paused: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  ended: 'bg-muted text-muted-foreground ring-border',
};

export function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export interface AdCampaign {
  id: string;
  name: string;
  platform: AdPlatform;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number; // return on ad spend (x)
  status: 'active' | 'paused' | 'ended';
  startDate?: string; // ISO — flight window start (pacing uses month-to-date when absent)
  endDate?: string; // ISO — flight window end
}

export type PacingVerdict = 'on-pace' | 'overspending' | 'underspending';

/** Budget pacing: actual spend % vs the expected % of the flight window elapsed. */
export function campaignPacing(
  c: Pick<AdCampaign, 'budget' | 'spent' | 'startDate' | 'endDate'>,
  todayIso = new Date().toISOString().slice(0, 10),
): { spentPct: number; expectedPct: number; verdict: PacingVerdict; dailyRunRate: number } {
  const spentPct = c.budget > 0 ? (c.spent / c.budget) * 100 : 0;
  let startMs = c.startDate ? new Date(c.startDate).getTime() : NaN;
  let endMs = c.endDate ? new Date(c.endDate).getTime() : NaN;
  if (!Number.isFinite(startMs)) {
    // No flight window — pace against the current calendar month.
    const d = new Date(todayIso);
    startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    endMs = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  }
  if (!Number.isFinite(endMs)) endMs = startMs + 30 * 86400000;
  const nowMs = new Date(todayIso).getTime();
  const span = Math.max(86400000, endMs - startMs);
  const expectedPct = Math.min(100, Math.max(0, ((nowMs - startMs) / span) * 100));
  const daysElapsed = Math.max(1, Math.round((nowMs - startMs) / 86400000));
  const dailyRunRate = c.spent / daysElapsed;
  const verdict: PacingVerdict =
    spentPct > expectedPct + 15 ? 'overspending' : spentPct < expectedPct - 15 ? 'underspending' : 'on-pace';
  return { spentPct, expectedPct, verdict, dailyRunRate };
}

export const INITIAL_ADS: AdCampaign[] = [];

// ---------------------------------------------------------------------------
// Webhook configuration for the Company Engine API
// ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  name: string;
  event: string;
  url: string;
  secret: string;
  active: boolean;
  lastDelivery: string;
  deliveries: number;
}

export const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.updated',
  'booking.delivered',
  'driver.onboarded',
  'client.created',
  'sla.breached',
  'tracking.updated',
  'payment.received',
] as const;

export const INITIAL_WEBHOOKS: Webhook[] = [];

// ---------------------------------------------------------------------------
// KPIs (additive, per department) + LLM selection
// ---------------------------------------------------------------------------

export interface KpiEntry {
  label: string;
  value: number;
  target: number;
  unit: string; // '', '%' or '$'
  delta: number;
  live?: boolean; // true when the value is computed from live company data
}

export interface KpiGroup {
  id: string;
  name: string;
  kpis: KpiEntry[];
}

export const INITIAL_KPI_GROUPS: KpiGroup[] = DEPARTMENTS.map((d) => ({
  id: d.id,
  name: d.name,
  kpis: d.kpis.map((k) => ({ ...k })),
}));

export interface KpiOverride {
  value: number;
  unit?: string;
  live?: boolean;
}

/**
 * Derive live KPI values from the company's real data (finance entries, leads,
 * employees, knowledge base and the valuation model). Returns a sparse map of
 * `{ departmentId: { kpiLabel: { value, unit?, live } } }` that the UI merges
 * on top of the editable seed baselines. Anything not present here keeps its
 * manual/editable value.
 */
export function deriveKpiOverrides(state: {
  finance?: FinanceEntry[];
  leads?: Lead[];
  employees?: Employee[];
  knowledge?: KnowledgeEntry[];
  ws?: Workspace | null;
}): Record<string, Record<string, KpiOverride>> {
  const fin = state.finance ?? [];
  const leads = state.leads ?? [];
  const emps = state.employees ?? [];
  const know = state.knowledge ?? [];
  const out: Record<string, Record<string, KpiOverride>> = {};
  const set = (dept: string, label: string, value: number, unit?: string) => {
    (out[dept] ??= {})[label] = { value, unit, live: true };
  };

  const revenue = fin.filter((f) => f.kind === 'revenue').reduce((s, f) => s + f.amount, 0);
  const burn = fin.filter((f) => f.kind === 'expense').reduce((s, f) => s + f.amount, 0);
  set('finance', 'Revenue', Math.round(revenue), '$');
  set('finance', 'Burn Rate', Math.round(burn), '$');
  if (revenue > 0) set('finance', 'Gross Margin', Math.round(((revenue - burn) / Math.max(1, revenue)) * 100), '%');

  const pipeline = leads
    .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
    .reduce((s, l) => s + (l.value || 0), 0);
  set('sales', 'Pipeline Coverage', Math.round(pipeline), '$');
  set('sales', 'Deals Closed', leads.filter((l) => l.stage === 'won').length, '');

  set('people', 'Headcount', emps.filter((e) => e.status !== 'offboarded').length, '');

  set('strategy', 'Valuation', Math.round(deriveValuation(fin, know, state.ws).fmv * 100), '$');
  set('strategy', 'Knowledge Base', know.length, '');

  return out;
}

export const KPI_UNITS: { value: string; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: '%', label: 'Percentage %' },
  { value: '$', label: 'Currency $' },
];

export interface LlmSelection {
  providerId: string;
  model: string;
  online: boolean;
  latency: number; // ms
}

export const DEFAULT_LLM: LlmSelection = {
  providerId: 'llm-demo',
  model: 'demo',
  online: false,
  latency: 0,
};

// ---------------------------------------------------------------------------
// Fundraising: opportunities scouted + auto-applied by the Nadia agent
// ---------------------------------------------------------------------------

export type FundingStage = 'identified' | 'evaluating' | 'applying' | 'applied' | 'won' | 'rejected';

export interface FundingOpportunity {
  id: string;
  source: string; // registry / program host
  program: string;
  amount: number;
  stage: FundingStage;
  deadline: string;
  matchScore: number; // 0-100 fit
  url: string;
  note: string;
}

export const INITIAL_FUNDRAISING: FundingOpportunity[] = [];

export const FUNDING_STAGE_LABEL: Record<FundingStage, string> = {
  identified: 'Identified', evaluating: 'Evaluating', applying: 'Applying', applied: 'Applied', won: 'Won', rejected: 'Rejected',
};
export const FUNDING_STAGE_COLOR: Record<FundingStage, string> = {
  identified: 'text-sky-600 bg-sky-500/10 ring-sky-500/30',
  evaluating: 'text-violet-600 bg-violet-500/10 ring-violet-500/30',
  applying: 'text-amber-600 bg-amber-500/10 ring-amber-500/30',
  applied: 'text-sky-700 bg-sky-600/10 ring-sky-600/30',
  won: 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30',
  rejected: 'text-rose-600 bg-rose-500/10 ring-rose-500/30',
};

// ---------------------------------------------------------------------------
// Agent browser tool: agents browse websites on their own
// ---------------------------------------------------------------------------

export interface BrowseResult {
  id: string;
  url: string;
  title: string;
  browsedBy: string; // agent name
  summary: string;
  links: string[];
  at: string;
}

export const INITIAL_BROWSES: BrowseResult[] = [];

// ---------------------------------------------------------------------------
// WhatsApp connection + agent-to-client chat threads
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  connected: boolean;
  phone: string;
  waId: string; // whatsapp business id
  lastSync: string;
}

export const DEFAULT_WHATSAPP: WhatsAppConfig = { connected: false, phone: '', waId: '', lastSync: '…' };

// ---------------------------------------------------------------------------
// Generic MCP (Model Context Protocol) server connections — lets agents call
// tools on ANY user-configured MCP server (not just the built-in wigolo
// integration), with either no auth, a pasted bearer token, or a real
// standards-based OAuth flow (RFC 8414 discovery + RFC 7591 dynamic client
// registration + PKCE) when the server supports it.
// ---------------------------------------------------------------------------

export type McpAuthType = 'none' | 'bearer' | 'oauth';
export type McpServerStatus = 'connected' | 'error' | 'off';

export interface McpServer {
  id: string;
  name: string;
  url: string; // MCP Streamable-HTTP endpoint, e.g. https://mcp.example.com/mcp
  authType: McpAuthType;
  status: McpServerStatus;
  lastSync: string;
  toolCount?: number;
  tools?: { name: string; description?: string }[];
  lastError?: string;
  // OAuth discovery results (non-secret — safe to keep in regular workspace state).
  oauth?: {
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    clientId?: string;
    scope?: string;
  };
}

export const INITIAL_MCP_SERVERS: McpServer[] = [];

// ---------------------------------------------------------------------------
// ElevenLabs voice + outbound call capability for agents
// ---------------------------------------------------------------------------

export interface ElevenLabsConfig {
  connected: boolean;
  voice: string; // active voice id (see ELEVENLABS_VOICES)
  defaultVoice: string;
  lastSync: string;
}

export const ELEVENLABS_VOICES: { id: string; label: string; tag: string }[] = [
  { id: 'antoni', label: 'Antoni', tag: 'Deep — male' },
  { id: 'adam', label: 'Adam', tag: 'Deep — male' },
  { id: 'george', label: 'George', tag: 'Confident — male' },
  { id: 'rachel', label: 'Rachel', tag: 'Warm — female' },
  { id: 'bella', label: 'Bella', tag: 'Soft — female' },
  { id: 'domi', label: 'Domi', tag: 'Clear — female' },
];

export const DEFAULT_ELEVENLABS: ElevenLabsConfig = {
  connected: false,
  voice: 'george',
  defaultVoice: 'george',
  lastSync: '…',
};

export type CallStatus = 'dialing' | 'active' | 'voicemail' | 'completed' | 'failed';
export interface CallRecord {
  id: string;
  agentId: string;
  agentName: string;
  contact: string; // phone number dialed
  leadName: string;
  voice: string;
  status: CallStatus;
  durationSec: number;
  note: string;
  at: string;
  /** 'real' = an actual Twilio call was dialed with ElevenLabs audio; 'simulated' = ElevenLabs audio played locally only (no Twilio configured). */
  mode?: 'real' | 'simulated';
  callSid?: string;
}

export const INITIAL_CALLS: CallRecord[] = [];

// ---------------------------------------------------------------------------
// Company knowledge base — what agents know and what they still need
// ---------------------------------------------------------------------------

export type KnowledgeCategoryId = 'company' | 'services' | 'customers' | 'funding' | 'content' | 'process';

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategoryId;
  title: string; // question or fact
  answer: string;
  source: string; // e.g. 'Website', 'Blog', 'Collected'
  updatedAt: string;
}

export interface KbQuestion {
  id: string;
  category: KnowledgeCategoryId;
  question: string;
  source: string;
}

export const KNOWLEDGE_CATEGORIES: { id: KnowledgeCategoryId; label: string; hint: string }[] = [
  { id: 'company', label: 'Company & Brand', hint: 'Who the company is, mission and markets' },
  { id: 'services', label: 'Services & Products', hint: 'Offerings, pricing and SLAs' },
  { id: 'customers', label: 'Customers & Case Studies', hint: 'Who we serve and proof points' },
  { id: 'funding', label: 'Funding & Grants', hint: 'Programs, applications and deadlines' },
  { id: 'content', label: 'Website, Blog & Content', hint: 'URLs, posts and FAQs' },
  { id: 'process', label: 'Process & Playbooks', hint: 'How agents should operate' },
];

export const KNOWLEDGE_SEED: KnowledgeEntry[] = [
  {
    id: 'kb1', category: 'company',
    title: 'What is our company name, purpose and mission?',
    answer: 'Replace this placeholder with your company overview. Provide the company name, primary purpose, core mission and key differentiators.',
    source: 'Company dashboard', updatedAt: 'Today 08:00',
  },
  {
    id: 'kb2', category: 'services',
    title: 'What products and services do we offer?',
    answer: 'Replace this placeholder with details of your products, services, pricing tiers, SLAs and any unique value propositions. Include key specifications and delivery models.',
    source: 'Product docs', updatedAt: 'Today 08:05',
  },
  {
    id: 'kb3', category: 'funding',
    title: 'What funding programs and grants are available?',
    answer: 'Replace this placeholder with current funding programs, grant opportunities, application deadlines and funding status.',
    source: 'Finance', updatedAt: 'Today 08:30',
  },
  {
    id: 'kb4', category: 'content',
    title: 'Where can we find our public content and resources?',
    answer: 'Replace this placeholder with links to your website, blog, documentation, brand assets and any public resources agents should reference.',
    source: 'Web', updatedAt: 'Today 09:00',
  },
  {
    id: 'kb-valuation', category: 'company',
    title: 'What is our current valuation and financial position?',
    answer: 'Replace this placeholder with key financial metrics: valuation, revenue multiples, enterprise value, share price, financial projections, margins and funding status.',
    source: 'Finance + Eqvista', updatedAt: 'Today 09:00',
  },
];

export const KNOWLEDGE_QUESTIONS: KbQuestion[] = [
  { id: 'q1', category: 'services', question: 'What are our exact service packages, pricing tiers and contract SLAs?', source: 'Sales team' },
  { id: 'q2', category: 'customers', question: 'Who are our reference customers and what problems did we solve for each?', source: 'CRM' },
  { id: 'q3', category: 'customers', question: 'Which case studies and testimonials can agents cite in outreach?', source: 'Website' },
  { id: 'q4', category: 'company', question: 'What is our value proposition and how do we differ from competitors?', source: 'Brand guide' },
  { id: 'q5', category: 'content', question: 'Which blog posts exist, when were they published and what do they cover?', source: 'Blog' },
  { id: 'q6', category: 'funding', question: 'Which grants and accelerators have we applied to and what are the deadlines?', source: 'Nadia' },
  { id: 'q7', category: 'process', question: 'What are the sales and support playbooks, and which SLAs apply?', source: 'Operations' },
  { id: 'q8', category: 'company', question: 'What are our target industries, geographies and ideal customer profile?', source: 'Go-to-market' },
];

// ---------------------------------------------------------------------------
// Agent memory — runtime observations agents store across sessions
// ---------------------------------------------------------------------------

export type MemoryKind = 'fact' | 'context' | 'instruction' | 'observation';

export interface AgentMemory {
  id: string;
  agentId: string;
  agentName: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  confidence: number; // 0—100
  createdAt: string;
  lastAccessed: string;
}

export const INITIAL_MEMORIES: AgentMemory[] = [];

export type ChatChannel = 'whatsapp' | 'sms' | 'email' | 'telegram';

export interface ChatMessage {
  id: string;
  role: 'agent' | 'client';
  sender: string;
  text: string;
  at: string;
}

export interface ChatThread {
  id: string;
  leadId: string;
  clientName: string;
  contact: string; // phone or email
  channel: ChatChannel;
  agent: string; // responding agent name
  messages: ChatMessage[];
}

export const INITIAL_CHATS: ChatThread[] = [];

// ---------------------------------------------------------------------------
// Settings — persisted preferences for the command center
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  tasks: boolean;
  handoffs: boolean;
  sync: boolean;
  voice: boolean;
  kpi: boolean;
}

export interface SettingsState {
  notifications: NotificationPrefs;
  crmUrl: string; // per-company engine / CRM endpoint
  engineApiKey?: string; // legacy: replaced by the encrypted Company Engine connection
  /** Pull customers and deals from the Company Engine automatically while the dashboard is open. */
  crmAutoPull?: boolean;
  /** Result of the last CRM pull. */
  crmLastPull?: { at: string; customers?: { added: number; updated: number; unchanged: number }; leads?: { added: number; updated: number; unchanged: number }; skipped?: number; error?: string };
  lastAutoMatchAt?: string; // ISO timestamp of last banking end-of-day auto-reconciliation
  autonomousMode?: boolean; // when true, agents may act on the company's behalf but must route payments and outbound third-party sends through approval
  lastAutoTrainAt?: string; // ISO timestamp of last automatic agent-memory / knowledge-base sync
  /** Tier 5 kill switch: when true, the heartbeat never fires — chat/voice still work. */
  heartbeatPaused?: boolean;
  /** Tier 5 quiet window (24h "HH:MM"); non-urgent checks wait until after `end`. */
  quietHours?: { start: string; end: string };
  /** Tier 6: per-workspace override for the payment approval threshold (USD). Falls back to AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD. */
  approvalThresholdUsd?: number;
}

export const DEFAULT_SETTINGS: SettingsState = {
  notifications: { tasks: true, handoffs: true, sync: false, voice: true, kpi: false },
  crmUrl: '', // Configure in Company Settings
  autonomousMode: false,
};

// ---------------------------------------------------------------------------
// Valuation — derived from the live financial ledger + the knowledge base
// (authoritative facts live in the `kb-valuation` knowledge entry).
// ---------------------------------------------------------------------------

export interface ValuationFacts {
  fmv: number; // blended FMV $M CAD
  revenue: number; // NTM revenue $M CAD
  multiple: number; // NTM EV/Rev multiple
  ev: number; // enterprise value $M CAD
  impliedShare: number; // USD
  momentum: number; // 0-100
  floor: number; // $M bear-case
  ceiling: number; // $M bull-case
  growthPct: number; // YoY %
  netDebt: number; // $M CAD
  sharesM: number; // shares outstanding M
  growthSource: 'trailing-actuals' | 'industry-proxy'; // whether growthPct is grounded in the company's own ledger or an industry estimate
}

export const VALUATION_DEFAULTS: ValuationFacts = {
  fmv: 2.68, revenue: 1.91, multiple: 1.4, ev: 2.84, impliedShare: 0.27,
  momentum: 72, floor: 1.2, ceiling: 6.1, growthPct: 40.7, netDebt: 0.16, sharesM: 9.9,
  growthSource: 'industry-proxy',
};

// Per-company, DB-backed valuation configuration. This replaces the previously
// hard-coded method inputs and market assumptions so each workspace can define
// its own peer set, multiple range and baseline facts.
export interface ValuationMethod {
  name: string;
  weight: number; // %
  value: number; // implied $M
  note: string;
}

export interface ValuationConfig {
  baseline: ValuationFacts;
  methods: ValuationMethod[];
}

export const VALUATION_CONFIG_SEED: ValuationConfig = {
  baseline: { ...VALUATION_DEFAULTS },
  methods: [
    { name: 'Market Comparables (M&A)', weight: 40, value: 3.1, note: 'Industry peer band — see Market Assumptions' },
    { name: 'Industry Revenue Multiple', weight: 30, value: 2.4, note: 'NTM revenue multiple × live revenue' },
    { name: 'Real-Time Reference', weight: 20, value: 2.68, note: 'Live valuation platform reference' },
    { name: 'Asset + Technology Premium', weight: 10, value: 1.8, note: 'IP, platform, brand, footprint' },
  ],
};

// ---------------------------------------------------------------------------
// Autonomous agent run infrastructure
// ---------------------------------------------------------------------------

export type ScheduleInterval = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface ScheduledTask {
  id: string;
  name: string;
  agentId: string;
  goal: string;
  interval: ScheduleInterval;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null; // ISO timestamp
  runCount: number;
  lastResult?: string;
  /** Tier 5 overlap guard: ISO timestamp when a run started; cleared on finish. */
  runningSince?: string | null;
  /** Tier 5: urgent tasks may surface during quiet hours; others wait. */
  urgent?: boolean;
}

/**
 * Tier 5 held inbox: everything the heartbeat surfaces while you were away
 * waits here until you dismiss it — never deliver-once-and-lose-it.
 */
export type NoticeSeverity = 'info' | 'noteworthy' | 'urgent';

export interface ProactiveNotice {
  id: string;
  title: string;
  body: string;
  severity: NoticeSeverity;
  source: 'scheduler' | 'agent';
  taskId?: string;
  runId?: string;
  createdAt: string;
  readAt: string | null;
}

export const INITIAL_NOTICES: ProactiveNotice[] = [];

export type AgentRunStatus = 'running' | 'complete' | 'error' | 'stopped';

export interface AgentRunStep {
  type: 'thought' | 'tool_call' | 'tool_result' | 'summary';
  content: string;
  tool?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  at: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  goal: string;
  status: AgentRunStatus;
  steps: AgentRunStep[];
  startedAt: string;
  completedAt?: string;
  summary?: string;
  triggeredBy: 'user' | 'scheduler' | 'webhook' | 'handoff';
}

export const INITIAL_SCHEDULED_TASKS: ScheduledTask[] = [
  {
    id: 'sched-1', name: 'Morning Fleet Brief', agentId: 'a-borga',
    goal: 'Review all department KPIs, flag any below-target metrics, create follow-up tasks for issues found, store key observations as memories, and log a morning brief summary to the activity feed.',
    interval: 'daily', enabled: true, lastRun: null, nextRun: null, runCount: 0,
  },
  {
    id: 'sched-2', name: 'Lead Pipeline Review', agentId: 'a-sales',
    goal: 'Review all open leads, move stale leads to the next stage or flag them at-risk, create follow-up tasks for P0 and P1 leads, and summarize pipeline health as a memory.',
    interval: 'daily', enabled: true, lastRun: null, nextRun: null, runCount: 0,
  },
  {
    id: 'sched-3', name: 'Grant Opportunity Scan', agentId: 'a-fundraising',
    goal: 'Query current funding opportunities, score unreviewed ones by mission fit, create evaluation tasks for top matches above 80% fit, and store findings as observations.',
    interval: 'weekly', enabled: true, lastRun: null, nextRun: null, runCount: 0,
  },
  {
    id: 'sched-4', name: 'Content Calendar Build', agentId: 'a-marketing',
    goal: 'Review engagement on recent social posts, draft 3 new content ideas for LinkedIn and Twitter based on the company expertise, and create social post drafts in the queue.',
    interval: 'weekly', enabled: false, lastRun: null, nextRun: null, runCount: 0,
  },
  {
    id: 'sched-5', name: 'Ops Dispatch Review', agentId: 'a-borga',
    goal: 'Check all pending and confirmed bookings, flag any without assigned drivers, create dispatch tasks for unassigned bookings, and log the ops status to the activity feed.',
    interval: 'daily', enabled: false, lastRun: null, nextRun: null, runCount: 0,
  },
];

// ---------------------------------------------------------------------------
// Inbound webhook routing — maps event sources to responsible agents
// ---------------------------------------------------------------------------

export const WEBHOOK_AGENT_ROUTING: Record<string, string> = {
  'booking.created': 'a-borga',
  'booking.updated': 'a-borga',
  'booking.delivered': 'a-borga',
  'sla.breached': 'a-borga',
  'driver.onboarded': 'a-borga',
  'client.created': 'a-sales',
  'payment.received': 'a-finance',
  'lead.created': 'a-sales',
  'support.ticket': 'a-support',
  'github.push': 'a-engineering',
  'github.issue': 'a-engineering',
  'stripe.payment_intent.succeeded': 'a-finance',
  'stripe.invoice.payment_failed': 'a-finance',
  'hubspot.contact.created': 'a-sales',
  'hubspot.deal.stage_changed': 'a-sales',
};

export interface IndustryValuation {
  label: string;
  baseMultiple: number; // EV/Revenue
  lowMultiple: number;
  highMultiple: number;
  growthProxy: number; // YoY %
  marginProxy: number; // gross margin %
}

// Revenue-multiple bands and growth/margin proxies by sector. Used to make the
// valuation model dynamic per company rather than hard-coded to one business.
export const INDUSTRY_VALUATION: { match: string[]; profile: IndustryValuation }[] = [
  { match: ['saas', 'software', 'cloud', 'platform', 'ai', 'data', 'tech'], profile: { label: 'Software / SaaS', baseMultiple: 6.5, lowMultiple: 3.5, highMultiple: 12, growthProxy: 55, marginProxy: 75 } },
  { match: ['fintech', 'finance tech', 'payments', 'banking'], profile: { label: 'Fintech', baseMultiple: 4.5, lowMultiple: 2.5, highMultiple: 9, growthProxy: 45, marginProxy: 60 } },
  { match: ['logistics', 'freight', 'delivery', 'supply', 'transport', 'shipping'], profile: { label: 'Logistics & Transport', baseMultiple: 1.6, lowMultiple: 0.8, highMultiple: 3.2, growthProxy: 22, marginProxy: 28 } },
  { match: ['ecommerce', 'retail', 'commerce', 'consumer', 'd2c', 'marketplace'], profile: { label: 'E-commerce / Retail', baseMultiple: 1.8, lowMultiple: 0.9, highMultiple: 3.6, growthProxy: 30, marginProxy: 40 } },
  { match: ['agency', 'creative', 'studio', 'marketing services', 'consulting', 'advisory'], profile: { label: 'Agency / Consulting', baseMultiple: 2.2, lowMultiple: 1.2, highMultiple: 4, growthProxy: 25, marginProxy: 55 } },
  { match: ['manufactur', 'industrial', 'factory', 'hardware'], profile: { label: 'Manufacturing', baseMultiple: 1.4, lowMultiple: 0.7, highMultiple: 2.8, growthProxy: 14, marginProxy: 32 } },
  { match: ['health', 'medtech', 'biotech', 'pharma', 'care'], profile: { label: 'Healthcare / Medtech', baseMultiple: 3.8, lowMultiple: 2, highMultiple: 7.5, growthProxy: 35, marginProxy: 65 } },
  { match: ['real estate', 'property', 'proptech', 'construction'], profile: { label: 'Real Estate / Construction', baseMultiple: 1.1, lowMultiple: 0.6, highMultiple: 2.2, growthProxy: 10, marginProxy: 25 } },
  { match: ['media', 'entertainment', 'content', 'publish'], profile: { label: 'Media & Content', baseMultiple: 2.6, lowMultiple: 1.3, highMultiple: 5, growthProxy: 28, marginProxy: 50 } },
  { match: ['energy', 'clean', 'renewable', 'utility'], profile: { label: 'Energy / Cleantech', baseMultiple: 2.0, lowMultiple: 1, highMultiple: 4.2, growthProxy: 24, marginProxy: 38 } },
  { match: ['education', 'edtech', 'learning'], profile: { label: 'Education / EdTech', baseMultiple: 3.0, lowMultiple: 1.5, highMultiple: 6, growthProxy: 32, marginProxy: 60 } },
  { match: ['food', 'beverage', 'restaurant', 'hospitality'], profile: { label: 'Food & Hospitality', baseMultiple: 1.5, lowMultiple: 0.8, highMultiple: 3, growthProxy: 18, marginProxy: 35 } },
];

export function industryProfile(industry?: string): IndustryValuation {
  const key = (industry ?? '').toLowerCase();
  if (key) {
    for (const entry of INDUSTRY_VALUATION) {
      if (entry.match.some((m) => key.includes(m))) return entry.profile;
    }
  }
  // Generic small-business default.
  return { label: industry?.trim() || 'General business', baseMultiple: 2.0, lowMultiple: 1.0, highMultiple: 4.0, growthProxy: 25, marginProxy: 45 };
}

/**
 * Real trailing revenue growth from the company's own ledger: compares the
 * last 90 days of recognized revenue against the 90 days before that, then
 * compounds the quarter-over-quarter rate out to an annualized figure.
 * Returns null when there isn't enough transaction history in both windows
 * to trust the comparison — callers should fall back to the industry proxy.
 */
function trailingRevenueGrowthPct(finance: FinanceEntry[]): number | null {
  const DAY = 24 * 3600_000;
  const now = Date.now();
  const dateOf = (f: FinanceEntry) => new Date(f.dateIso ?? f.createdAt ?? 0).getTime();
  const revenue = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt);
  let recent = 0;
  let prior = 0;
  for (const f of revenue) {
    const age = now - dateOf(f);
    if (age < 0) continue;
    if (age <= 90 * DAY) recent += f.amount;
    else if (age <= 180 * DAY) prior += f.amount;
  }
  if (recent <= 0 || prior <= 0) return null;
  const qoqPct = (recent - prior) / prior;
  const annualized = (Math.pow(1 + qoqPct, 4) - 1) * 100;
  return Math.round(Math.max(-80, Math.min(300, annualized)) * 10) / 10;
}

/**
 * Computes a dynamic blended FMV from real numbers plus the company's industry:
 * NTM revenue is annualized from the persisted ledger, growth is grounded in the
 * company's own trailing revenue trend when there's enough history (falling back
 * to the industry proxy otherwise), the revenue multiple is chosen from the
 * industry band (overridable by the knowledge base), and the bear/bull floor &
 * ceiling come from the industry's low/high multiples. This is a comparable-
 * multiple estimate grounded in the company's own data — not a live market feed.
 */
export function deriveValuation(finance: FinanceEntry[], knowledge: KnowledgeEntry[], ws?: Workspace | null, config?: ValuationConfig | null): ValuationFacts {
  const v: ValuationFacts = { ...(config?.baseline ?? VALUATION_DEFAULTS) };
  const profile = industryProfile(ws?.industry);

  // 1) NTM revenue from the live ledger: recurring + AR, annualized to $M.
  const recurring = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const ar = finance.filter((f) => (f.kind === 'invoice' || f.kind === 'credit') && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const monthly = recurring + ar;
  if (monthly > 0) v.revenue = Math.round((monthly * 12) / 1e5) / 10;

  // 2) Authoritative assumptions from the knowledge base when present.
  let multiple = profile.baseMultiple;
  const kb = knowledge.find((k) => k.id === 'kb-valuation');
  if (kb) {
    const mult = kb.answer.match(/(\d+(?:\.\d+)?)\s*×/);
    const momentum = kb.answer.match(/momentum score\s*(\d+)/i);
    if (mult) multiple = parseFloat(mult[1]);
    if (momentum) v.momentum = parseInt(momentum[1], 10);
  }
  v.multiple = multiple;

  // 3) Growth is grounded in the company's own trailing revenue trend when
  // there's enough ledger history; otherwise it falls back to the industry
  // proxy. Either way it's nudged by the momentum signal from the knowledge base.
  const trailingGrowth = trailingRevenueGrowthPct(finance);
  if (trailingGrowth !== null) {
    v.growthPct = Math.round((trailingGrowth * 0.65 + profile.growthProxy * 0.35 + (v.momentum - 70) * 0.4) * 10) / 10;
    v.growthSource = 'trailing-actuals';
  } else {
    v.growthPct = Math.round((profile.growthProxy + (v.momentum - 70) * 0.4) * 10) / 10;
    v.growthSource = 'industry-proxy';
  }

  // 4) Blended FMV and derived figures from the real inputs above.
  v.fmv = Math.round(v.revenue * v.multiple * 100) / 100;
  v.ev = Math.round((v.fmv + v.netDebt) * 100) / 100;
  v.impliedShare = Math.round((v.fmv / v.sharesM) * 1000) / 1000;
  v.floor = Math.round(v.revenue * profile.lowMultiple * 100) / 100;
  v.ceiling = Math.round(v.revenue * profile.highMultiple * 100) / 100;
  return v;
}

// ---------------------------------------------------------------------------
// Workspaces — multi-company tenancy. Every domain collection is scoped to
// the active workspace; the registry itself is global.
// ---------------------------------------------------------------------------

export type WorkspacePlan = 'trial' | 'growth' | 'scale' | 'enterprise';

/** Display symbol per workspace currency — single source of truth for every money() helper. */
export const CURRENCY_SYMBOL: Record<'USD' | 'CAD' | 'EUR' | 'GBP', string> = {
  USD: '$', CAD: 'C$', EUR: '€', GBP: '£',
};

// ---------------------------------------------------------------------------
// Onboarding — when a company is created we collect structured context so the
// agents and the valuation model have sufficient grounding. Each step has a
// deeplink into the app so a partially-onboarded account can resume anywhere.
// ---------------------------------------------------------------------------

export type OnboardingStepId =
  | 'profile' | 'industry' | 'financials' | 'team' | 'knowledge' | 'valuation';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  href: string;
  completed: boolean;
}

export interface WorkspaceOnboarding {
  started: boolean;
  completed: boolean;
  currentStep?: OnboardingStepId;
  steps: OnboardingStep[];
}

export const ONBOARDING_STEP_DEFS: Omit<OnboardingStep, 'completed'>[] = [
  { id: 'profile', title: 'Company profile', description: 'Legal name, industry, location and tax details.', href: '/app/company/workspaces' },
  { id: 'industry', title: 'Industry & operations', description: 'What you do, your services and key differentiators.', href: '/app/company/knowledge' },
  { id: 'financials', title: 'Financials', description: 'Log revenue and run-rate so valuation can derive a number.', href: '/app/finance' },
  { id: 'team', title: 'Team', description: 'Add employees and org structure.', href: '/app/hr' },
  { id: 'knowledge', title: 'Knowledge base', description: 'Answer key questions so agents have context.', href: '/app/company/knowledge' },
  { id: 'valuation', title: 'Valuation', description: 'Review your derived valuation model.', href: '/app/company/valuation' },
];

export function makeOnboarding(): WorkspaceOnboarding {
  return {
    started: false,
    completed: false,
    currentStep: 'profile',
    steps: ONBOARDING_STEP_DEFS.map((d) => ({ ...d, completed: false })),
  };
}

export function onboardingProgress(o?: WorkspaceOnboarding): { done: number; total: number; pct: number; complete: boolean } {
  const steps = o?.steps ?? [];
  const done = steps.filter((s) => s.completed).length;
  const total = steps.length || ONBOARDING_STEP_DEFS.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, complete: !!o?.completed };
}

export interface Workspace {
  id: string;
  name: string;
  industry: string;
  plan: WorkspacePlan;
  color: string; // avatar accent, same convention as agents
  currency: 'USD' | 'CAD' | 'EUR' | 'GBP';
  createdAt: string;

  // ── Full company profile (Settings → Company information) ────────────────
  legalName?: string;
  tradingName?: string;
  businessNumber?: string; // e.g. CRA business number
  taxNumber?: string; // VAT / GST / EIN
  incorporationDate?: string; // ISO or display
  addressLine?: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string; // IANA zone
  fiscalYearEndMonth?: number; // 1—12
  fiscalYearEndDay?: number; // 1—31
  email?: string;
  phone?: string;
  website?: string;
  logoDataUrl?: string; // branded logo for reports, invoices and PDFs
  /** Services/products the company sells (captured at onboarding). The Revenue Tracker keeps one line per service. */
  services?: string[];

  // Onboarding state — drives the post-signup knowledge-gathering flow.
  onboarding?: WorkspaceOnboarding;
}

export const INITIAL_WORKSPACES: Workspace[] = [];

export const PLAN_LABEL: Record<WorkspacePlan, string> = {
  trial: 'Trial',
  growth: 'Growth',
  scale: 'Scale',
  enterprise: 'Enterprise',
};

// ---------------------------------------------------------------------------
// HR — employees, leave and headcount for the People module
// ---------------------------------------------------------------------------

export type EmployeeStatus = 'active' | 'onboarding' | 'on-leave' | 'offboarded';
export type EmploymentType = 'full-time' | 'part-time' | 'contract';

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  email: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  salary: number; // annual, workspace currency
  manager?: string;
  location: string;
  startedAt: string; // display date e.g. "Jan 2024"
  performance: number; // 0-100
  leaveBalanceDays?: number; // optional override — otherwise derived from tenure accrual
}

export const LEAVE_BASE_DAYS = 20;
export const LEAVE_ACCRUAL_PER_MONTH = 1.67;

/** Dynamic leave entitlement: base + monthly accrual since start date, minus approved paid leave. */
export function computeLeaveBalance(
  employee: Pick<Employee, 'id' | 'startedAt' | 'leaveBalanceDays'>,
  leaveRequests: { employeeId: string; status: LeaveStatus; days: number; kind: LeaveKind }[],
): { entitlement: number; taken: number; remaining: number } {
  if (typeof employee.leaveBalanceDays === 'number') {
    const taken = leaveRequests
      .filter((l) => l.employeeId === employee.id && l.status === 'approved' && l.kind !== 'unpaid')
      .reduce((s, l) => s + l.days, 0);
    return { entitlement: employee.leaveBalanceDays, taken, remaining: employee.leaveBalanceDays - taken };
  }
  const monthsSince = Math.max(0, Math.floor((Date.now() - new Date(employee.startedAt).getTime()) / (30 * 86400000)));
  const entitlement = LEAVE_BASE_DAYS + monthsSince * LEAVE_ACCRUAL_PER_MONTH;
  const taken = leaveRequests
    .filter((l) => l.employeeId === employee.id && l.status === 'approved' && l.kind !== 'unpaid')
    .reduce((s, l) => s + l.days, 0);
  return { entitlement: Math.round(entitlement * 10) / 10, taken, remaining: Math.round((entitlement - taken) * 10) / 10 };
}

export const EMPLOYEE_STATUS_STYLE: Record<EmployeeStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  onboarding: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  'on-leave': 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  offboarded: 'bg-muted text-muted-foreground ring-border',
};

export type LeaveKind = 'vacation' | 'sick' | 'parental' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: LeaveKind;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
}

export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = {
  vacation: 'Vacation',
  sick: 'Sick leave',
  parental: 'Parental',
  unpaid: 'Unpaid',
};

export const INITIAL_EMPLOYEES: Employee[] = [];

export const INITIAL_LEAVE: LeaveRequest[] = [];

// ---------------------------------------------------------------------------
// Finance suite — invoices complement the transaction ledger
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

export type PaymentMethod =
  | 'cash' | 'bank-transfer' | 'mobile-wallet' | 'wise'
  | 'paypal' | 'stripe' | 'credit-card' | 'cheque';

export const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'bank-transfer', 'mobile-wallet', 'wise', 'paypal', 'stripe', 'credit-card', 'cheque',
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  'bank-transfer': 'Bank transfer',
  'mobile-wallet': 'Mobile wallet',
  wise: 'Wise',
  paypal: 'PayPal',
  stripe: 'Stripe',
  'credit-card': 'Credit card',
  cheque: 'Cheque',
};

export interface InvoiceLine {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  number: string;
  client: string;
  amount: number; // computed total (subtotal + tax) — kept for reports
  status: InvoiceStatus;
  issued: string;
  due: string;
  notes?: string;
  description?: string; // transaction description (IFRS-aligned: every transaction is described)
  lines?: InvoiceLine[];
  taxRate?: number; // percent (snapshot at creation)
  taxProfileId?: string; // legacy single tax profile used to derive taxRate
  taxProfileIds?: string[]; // multiple stacked tax profiles (e.g. GST + PST) — combined rate = sum
  taxProfileName?: string; // human label for the applied tax profile(s)
  externalRef?: string; // external reference (PO, client ref, cheque—)
  paymentMethod?: PaymentMethod; // requested settlement method
  sentAt?: string; // ISO
  paidAt?: string; // ISO
  paidMethod?: PaymentMethod;
  voidedAt?: string; // ISO — voided documents are kept for the audit trail
  voidReason?: string;
  customerId?: string; // links this invoice to a Customer account
  projectId?: string; // links this invoice to a Project
  accountId?: string; // GlAccount.id — the revenue account this invoice recognizes against
}

export const INVOICE_STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft: 'bg-muted text-muted-foreground ring-border',
  sent: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  paid: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  overdue: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

export const INITIAL_INVOICES: Invoice[] = [];

// ---------------------------------------------------------------------------
// Messaging channels — unified inbox across email / SMS / WhatsApp / Telegram.
// Channel accounts are linked through composio.dev OAuth.
// ---------------------------------------------------------------------------

export interface MessagingChannelConfig {
  channel: CommsChannel;
  composioAppName: string; // toolkit slug used for the OAuth connect link
  connected: boolean;
  account: string; // linked address / number
  providerLabel: string;
}

export const DEFAULT_MESSAGING_CHANNELS: MessagingChannelConfig[] = [
  { channel: 'email', composioAppName: 'gmail', connected: false, account: '', providerLabel: 'Gmail via Composio OAuth' },
  { channel: 'sms', composioAppName: 'twilio', connected: false, account: '', providerLabel: 'Twilio SMS via Composio OAuth' },
  { channel: 'whatsapp', composioAppName: 'whatsapp', connected: false, account: '', providerLabel: 'WhatsApp Business Cloud API' },
  { channel: 'telegram', composioAppName: 'telegram', connected: false, account: '', providerLabel: 'Telegram Bot API' },
];

// ---------------------------------------------------------------------------
// Secure chats — end-to-end encrypted live chat between workspace members.
// Only ciphertext + IV are ever persisted; plaintext exists exclusively in
// the memory of the two participants' browsers (WebCrypto ECDH + AES-GCM).
// ---------------------------------------------------------------------------

export interface SecureMessage {
  id: string;
  fromId: string;
  ciphertext: string; // base64 AES-GCM payload
  iv: string; // base64 96-bit initialisation vector
  at: string; // ISO timestamp
  fingerprint?: string; // sender key fingerprint snapshot
}

export interface SecureThread {
  id: string;
  participantId: string;
  participantName: string;
  messages: SecureMessage[];
  updatedAt: string;
}

export interface SecureIdentity {
  userId: string;
  publicKeyJwk: JsonWebKey; // shared with peers
  fingerprint: string; // short SHA-256 digest of the public key
}

// ---------------------------------------------------------------------------
// Sales suite — customer accounts (companies) and their contacts
// ---------------------------------------------------------------------------

export type CustomerStatus = 'active' | 'prospect' | 'churned';

export interface Customer {
  id: string;
  name: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state?: string;
  country: string;
  status: CustomerStatus;
  owner: string; // internal team member responsible for the account
  createdAt: string;
  notes: string;
  crmId?: string; // id of this account in the company CRM (Company Engine pull)
}

export const CUSTOMER_STATUS_STYLE: Record<CustomerStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  prospect: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  churned: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

export interface Contact {
  id: string;
  customerId: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  primary: boolean;
}

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_CONTACTS: Contact[] = [];

// ---------------------------------------------------------------------------
// Vendor management (AP) — vendor directory and bills
// ---------------------------------------------------------------------------

export type PaymentTerms = 'due-on-receipt' | 'net15' | 'net30' | 'net60';

export type VendorRiskLevel = 'low' | 'medium' | 'high';

export interface Vendor {
  id: string;
  name: string;
  service: string;
  email: string;
  phone: string;
  website: string;
  terms: PaymentTerms;
  status: 'active' | 'paused';
  since: string;
  legalName?: string;
  tradingName?: string;
  addressLine?: string;
  city?: string;
  country?: string;
  billingAddress?: string; // if different from the main address
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  taxNumber?: string;
  riskLevel?: VendorRiskLevel; // dynamically derived from payment patterns
}

/**
 * Dynamic vendor risk from payment patterns: share of overdue/unpaid bills
 * and total exposure. low <25% problem bills, medium <50%, high otherwise.
 */
export function computeVendorRisk(
  vendorId: string,
  bills: { vendorId: string; status: 'unpaid' | 'scheduled' | 'paid'; amount: number }[],
): { level: VendorRiskLevel; overdueShare: number; unpaidAmount: number } {
  const vendorBills = bills.filter((b) => b.vendorId === vendorId);
  const total = vendorBills.reduce((s, b) => s + b.amount, 0);
  const unpaid = vendorBills.filter((b) => b.status === 'unpaid');
  const unpaidAmount = unpaid.reduce((s, b) => s + b.amount, 0);
  const overdueShare = total > 0 ? unpaidAmount / total : 0;
  const level: VendorRiskLevel = overdueShare >= 0.5 ? 'high' : overdueShare >= 0.25 ? 'medium' : 'low';
  return { level, overdueShare, unpaidAmount };
}

export const VENDOR_RISK_STYLE: Record<VendorRiskLevel, string> = {
  low: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  medium: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  high: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

export interface BillLine {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
}

export interface Bill {
  id: string;
  vendorId: string;
  vendorName: string;
  number: string;
  amount: number;
  received: string;
  due: string;
  status: 'unpaid' | 'scheduled' | 'paid';
  lines?: BillLine[];
  taxRate?: number;
  taxProfileId?: string; // legacy single tax profile used to derive taxRate
  taxProfileIds?: string[]; // multiple stacked tax profiles (e.g. GST + PST) — combined rate = sum
  taxProfileName?: string; // human label for the applied tax profile(s)
  externalRef?: string; // external reference (vendor invoice no, PO—)
  notes?: string;
  description?: string; // transaction description (IFRS-aligned: every transaction is described)
  paymentMethod?: PaymentMethod;
  paidAt?: string;
  paidMethod?: PaymentMethod;
  voidedAt?: string; // ISO — voided bills stay on the books for audit
  voidReason?: string;
  projectId?: string; // links this bill to a Project
  accountId?: string; // GlAccount.id — the expense/cost account this bill posts against
}

export const PAYMENT_TERMS_LABEL: Record<PaymentTerms, string> = {
  'due-on-receipt': 'Due on receipt',
  net15: 'Net 15',
  net30: 'Net 30',
  net60: 'Net 60',
};

export const INITIAL_VENDORS: Vendor[] = [];

export const INITIAL_BILLS: Bill[] = [];

// ---------------------------------------------------------------------------
// Accounting — chart of accounts and double-entry journal
// ---------------------------------------------------------------------------

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'cost' | 'expense';

export interface GlAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  description?: string;
  archived?: boolean;
  isCash?: boolean; // cash & equivalents — drives the cash-flow statement
}

export const ACCOUNT_TYPE_STYLE: Record<AccountType, string> = {
  asset: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  liability: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  equity: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  revenue: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  cost: 'bg-orange-500/10 text-orange-600 ring-orange-500/30',
  expense: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  cost: 'Cost (COGS)',
  expense: 'Expense',
};

export interface JournalLine {
  accountId: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  date: string; // display label
  dateIso: string; // YYYY-MM-DD — machine-readable, drives period reporting
  memo: string;
  description?: string; // full transaction description
  reference?: string;
  dueDateIso?: string; // transaction due date
  paymentMethod?: PaymentMethod;
  externalRef?: string; // external system reference (cheque, bank txn, PO—)
  taxProfileName?: string; // tax profile applied to the underlying document
  status: 'draft' | 'posted' | 'voided';
  lines: JournalLine[];
  createdAt?: string; // ISO timestamp — every transaction is stamped
  auto?: 'closing' | 'reversal'; // system-generated closing/reversal entries
  closesPeriod?: string; // closure id that produced this entry
  voidedAt?: string; // ISO — posted entries are never deleted, only voided
  voidReason?: string;
  reversalOf?: string; // id of the original entry this reversal cancels
  projectId?: string; // links this journal entry to a Project
}

/** Accounting lock rule: drafts are freely editable/deletable; anything that has been posted, paid or approved is immutable and can only be voided. */
export function isLockedEntry(status: 'draft' | 'posted' | 'voided' | string): boolean {
  return status !== 'draft';
}

// ── Budgeting & forecasting ──────────────────────────────────────────────────
// A budget mirrors the chart of accounts (same rows as the P&L) so it renders
// as a real financial-statement template rather than a flat wishlist.
export interface BudgetLine {
  id: string;
  accountId: string; // GlAccount.id
  monthly: Record<string, number>; // key 'YYYY-MM' -> planned amount
  growthPct?: number; // per-account month-over-month override; falls back to the type-level assumption
}

export interface BudgetAssumptions {
  revenueGrowthPct: number; // default month-over-month % for revenue accounts
  costGrowthPct: number; // default month-over-month % for cost-of-sales accounts
  expenseGrowthPct: number; // default month-over-month % for operating-expense accounts
}

export const DEFAULT_BUDGET_ASSUMPTIONS: BudgetAssumptions = { revenueGrowthPct: 5, costGrowthPct: 2, expenseGrowthPct: 2 };

/** The type-level default growth assumption applied to a line unless it has its own override. */
export function resolveLineGrowthPct(line: BudgetLine, accountType: AccountType | undefined, assumptions: BudgetAssumptions): number {
  if (line.growthPct !== undefined) return line.growthPct;
  if (accountType === 'revenue') return assumptions.revenueGrowthPct;
  if (accountType === 'cost') return assumptions.costGrowthPct;
  return assumptions.expenseGrowthPct;
}

export interface Budget {
  id: string;
  name: string; // e.g. "FY2026 Operating Budget"
  fiscalYear: number;
  status: 'draft' | 'active' | 'closed';
  lines: BudgetLine[];
  notes?: string;
  createdAt: string;
  assumptions?: BudgetAssumptions; // carried forward to future years unless changed
}

export const INITIAL_BUDGETS: Budget[] = [];

// ── Revenue tracker (targets vs actuals) ────────────────────────────────────
// A revenue tracker compares planned (target) net revenue against booked
// actuals across service lines and months (one line per company service).
// Actuals are entered inline in the Finance →
// Revenue Tracker tab and persist per workspace.
export interface RevenueLine {
  id: string; // e.g. 'sameday'
  name: string; // e.g. 'Same-Day Delivery'
  color: string; // chart accent hex
  targets: number[]; // net revenue target per month (same length as months)
  actuals: number[]; // booked actual per month (0 = not entered)
  /** Set when the line was created from a company service (kept in step with Workspace.services). */
  service?: string;
}

export interface RevenueTrack {
  id: string;
  name: string;
  periodLabel: string; // e.g. "Oct 2026 → Mar 2027"
  months: string[]; // column labels, e.g. "Oct '26"
  monthContexts?: string[]; // optional per-month context (e.g. city rollout)
  takeRates?: number[]; // optional take-rate % per month
  lines: RevenueLine[];
  createdAt: string;
}

// No sample plan: a company's tracker is created from the services it gave at onboarding.
export const INITIAL_REVENUE_TRACKS: RevenueTrack[] = [];

/**
 * Fill every month after the first with a compounding month-over-month
 * change, for any line that has a first-month value set. Lets a user enter
 * just the first month plus a growth assumption (per-account, or the
 * type-level default) and have the rest of the fiscal year forecast itself.
 */
export function generateBudgetForecast(lines: BudgetLine[], months: string[], resolveGrowthPct: (line: BudgetLine) => number): BudgetLine[] {
  return lines.map((line) => {
    const base = line.monthly[months[0]];
    if (base === undefined) return line;
    const factor = 1 + resolveGrowthPct(line) / 100;
    const monthly = { ...line.monthly };
    let prev = base;
    for (let i = 1; i < months.length; i++) {
      prev = prev * factor;
      monthly[months[i]] = Math.round(prev);
    }
    return { ...line, monthly };
  });
}

/**
 * Roll a budget's lines into a new fiscal year: the new year's first month
 * continues compounding from the prior year's last month at the same growth
 * rate, and the rest of the new year is generated the same way — so a
 * forecast carries forward year over year unless its assumptions change.
 */
export function rollBudgetForward(lines: BudgetLine[], fromMonths: string[], toMonths: string[], resolveGrowthPct: (line: BudgetLine) => number): BudgetLine[] {
  return lines.map((line) => {
    const lastValue = line.monthly[fromMonths[fromMonths.length - 1]];
    if (lastValue === undefined) return { ...line, monthly: {} };
    const factor = 1 + resolveGrowthPct(line) / 100;
    const monthly: Record<string, number> = {};
    let prev = lastValue;
    toMonths.forEach((m) => {
      prev = prev * factor;
      monthly[m] = Math.round(prev);
    });
    return { ...line, monthly };
  });
}

/** The 12 'YYYY-MM' month keys of a fiscal year (Jan–Dec). */
export function fiscalYearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Net actual amount posted to `accountId` for each calendar month between
 * fromIso and toIso (inclusive), signed to the account's normal balance side.
 * Mirrors the debit/credit convention used by the P&L and account reports in
 * ReportsCenter (DEBIT_NORMAL = asset | expense) so budget-vs-actual figures
 * tie out to the rest of the financial reports.
 */
export function computeAccountMonthlyActuals(
  journals: JournalEntry[],
  coa: GlAccount[],
  accountId: string,
  fromIso: string,
  toIso: string,
): Record<string, number> {
  const account = coa.find((a) => a.id === accountId);
  const debitNormal = account ? account.type === 'asset' || account.type === 'expense' : true;
  const out: Record<string, number> = {};
  journals
    .filter((j) => j.status === 'posted' && j.dateIso >= fromIso && j.dateIso <= toIso)
    .forEach((j) => {
      const month = j.dateIso.slice(0, 7);
      j.lines
        .filter((l) => l.accountId === accountId)
        .forEach((l) => {
          const delta = debitNormal ? l.debit - l.credit : l.credit - l.debit;
          out[month] = (out[month] ?? 0) + delta;
        });
    });
  return out;
}

/**
 * Simple run-rate forecast: months that have already elapsed use their actual
 * value; remaining months default to the average of the elapsed months'
 * actuals (flat run-rate carried forward).
 */
export function forecastRemainingMonths(
  actualsByMonth: Record<string, number>,
  months: string[],
  elapsedMonths: string[],
): Record<string, number> {
  const elapsedSet = new Set(elapsedMonths);
  const elapsedTotal = elapsedMonths.reduce((s, m) => s + (actualsByMonth[m] ?? 0), 0);
  const avg = elapsedMonths.length > 0 ? elapsedTotal / elapsedMonths.length : 0;
  const out: Record<string, number> = {};
  months.forEach((m) => {
    out[m] = elapsedSet.has(m) ? (actualsByMonth[m] ?? 0) : avg;
  });
  return out;
}

// ── Project management ───────────────────────────────────────────────────────
export type ProjectStatus = 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled';

export interface Milestone {
  id: string;
  title: string;
  dueDateIso?: string;
  done: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  ownerId?: string; // Agent.id
  customerId?: string; // links this project to a Customer account
  startDateIso?: string;
  targetDateIso?: string;
  budgetAmount: number; // allocated budget for this project
  createdAt: string;
  teamAgentIds?: string[]; // Agent.id[] — the project team
  milestones?: Milestone[];
}

export const INITIAL_PROJECTS: Project[] = [];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PROJECT_STATUS_STYLE: Record<ProjectStatus, string> = {
  planning: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  active: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  'on-hold': 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  completed: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  cancelled: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

/** Actual spend posted against a project — the sum of its linked expense entries (project financial tracking). */
export function computeProjectActualSpend(finance: FinanceEntry[], projectId: string): number {
  return finance
    .filter((f) => f.projectId === projectId && f.kind === 'expense' && !f.voidedAt)
    .reduce((s, f) => s + f.amount, 0);
}

// ---------------------------------------------------------------------------
// Country accounting standards — determines which financial-reporting
// framework and statement terminology a company's books follow, based on its
// country of incorporation. This drives report labelling and the "Notes to
// the Accounts" policy disclosures; it is not a substitute for advice from a
// qualified accountant in that jurisdiction.
// ---------------------------------------------------------------------------

export type AccountingFramework = 'IFRS' | 'US-GAAP' | 'ASPE';

export interface AccountingStandard {
  framework: AccountingFramework;
  label: string;
  regulator: string;
  statementNames: { balanceSheet: string; incomeStatement: string; cashFlow: string; equity: string };
  policyNotes: string[]; // representative disclosures for "Notes to the Accounts"
}

const IFRS_STATEMENT_NAMES = {
  balanceSheet: 'Statement of Financial Position',
  incomeStatement: 'Statement of Profit or Loss',
  cashFlow: 'Statement of Cash Flows',
  equity: 'Statement of Changes in Equity',
};

const GAAP_STATEMENT_NAMES = {
  balanceSheet: 'Balance Sheet',
  incomeStatement: 'Income Statement',
  cashFlow: 'Statement of Cash Flows',
  equity: 'Statement of Stockholders’ Equity',
};

export const COUNTRY_ACCOUNTING_STANDARDS: Record<string, AccountingStandard> = {
  Denmark: {
    framework: 'IFRS',
    label: 'Danish Financial Statements Act, aligned with IFRS as adopted by the EU',
    regulator: 'Erhvervsstyrelsen (Danish Business Authority)',
    statementNames: IFRS_STATEMENT_NAMES,
    policyNotes: [
      'Financial statements are prepared on the historical cost basis, as modified for the revaluation of certain assets, in accordance with the Danish Financial Statements Act and applicable IFRS.',
      'Revenue is recognised when control of goods or services transfers to the customer, per IFRS 15.',
      'Functional and presentation currency is DKK unless otherwise stated.',
    ],
  },
  'United States': {
    framework: 'US-GAAP',
    label: 'U.S. Generally Accepted Accounting Principles (US GAAP)',
    regulator: 'Financial Accounting Standards Board (FASB)',
    statementNames: GAAP_STATEMENT_NAMES,
    policyNotes: [
      'Financial statements are prepared in accordance with U.S. GAAP as issued by the FASB Accounting Standards Codification (ASC).',
      'Revenue is recognised under ASC 606 upon satisfaction of performance obligations.',
      'Presentation currency is USD unless otherwise stated.',
    ],
  },
  Canada: {
    framework: 'ASPE',
    label: 'Accounting Standards for Private Enterprises (ASPE) — Canada',
    regulator: 'Accounting Standards Board / CPA Canada',
    statementNames: GAAP_STATEMENT_NAMES,
    policyNotes: [
      'Financial statements are prepared in accordance with Accounting Standards for Private Enterprises (Part II of the CPA Canada Handbook).',
      'Revenue is recognised when performance is complete, the amount is determinable, and collection is reasonably assured.',
      'Presentation currency is CAD unless otherwise stated.',
    ],
  },
  Ghana: {
    framework: 'IFRS',
    label: 'International Financial Reporting Standards (IFRS) — Ghana',
    regulator: 'Institute of Chartered Accountants, Ghana (ICAG)',
    statementNames: IFRS_STATEMENT_NAMES,
    policyNotes: [
      'Financial statements are prepared in accordance with IFRS as adopted in Ghana, per ICAG pronouncements.',
      'Revenue is recognised when control of goods or services transfers to the customer, per IFRS 15.',
      'Presentation currency is GHS unless otherwise stated.',
    ],
  },
};

export const DEFAULT_ACCOUNTING_STANDARD: AccountingStandard = {
  framework: 'IFRS',
  label: 'IFRS (default — set the company’s country of incorporation for a jurisdiction-specific framework)',
  regulator: 'IFRS Foundation',
  statementNames: IFRS_STATEMENT_NAMES,
  policyNotes: [
    'Financial statements are presented under IFRS as a neutral default in the absence of a mapped country of incorporation.',
  ],
};

export function getAccountingStandard(country?: string): AccountingStandard {
  return COUNTRY_ACCOUNTING_STANDARDS[country ?? ''] ?? DEFAULT_ACCOUNTING_STANDARD;
}

export const INITIAL_COA: GlAccount[] = [
  { id: 'gl-1000', code: '1000', name: 'Cash & Bank', type: 'asset', description: 'Operating accounts', isCash: true },
  { id: 'gl-1100', code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { id: 'gl-1200', code: '1200', name: 'Prepaid Expenses', type: 'asset' },
  { id: 'gl-2000', code: '2000', name: 'Accounts Payable', type: 'liability' },
  { id: 'gl-2100', code: '2100', name: 'Credit Card Payable', type: 'liability' },
  { id: 'gl-3000', code: '3000', name: "Owner's Equity", type: 'equity' },
  { id: 'gl-3100', code: '3100', name: 'Retained Earnings', type: 'equity' },
  { id: 'gl-4000', code: '4000', name: 'Sales Revenue', type: 'revenue' },
  { id: 'gl-4100', code: '4100', name: 'Service Revenue', type: 'revenue' },
  { id: 'gl-4200', code: '4200', name: 'Cost of Goods Sold', type: 'cost', description: 'Direct costs of services delivered' },
  { id: 'gl-4300', code: '4300', name: 'Delivery & Fulfilment Costs', type: 'cost' },
  { id: 'gl-4400', code: '4400', name: 'Payment Processing Fees', type: 'cost', description: 'Stripe / PayPal / Wise fees' },
  { id: 'gl-4500', code: '4500', name: 'Subcontractor & Fleet Costs', type: 'cost' },
  { id: 'gl-5000', code: '5000', name: 'Payroll Expense', type: 'expense' },
  { id: 'gl-5100', code: '5100', name: 'Cloud & Infrastructure', type: 'expense' },
  { id: 'gl-5200', code: '5200', name: 'Marketing & Ads', type: 'expense' },
  { id: 'gl-5300', code: '5300', name: 'Rent & Facilities', type: 'expense' },
  { id: 'gl-5400', code: '5400', name: 'Office Supplies & Software', type: 'expense' },
  { id: 'gl-5500', code: '5500', name: 'Utilities', type: 'expense' },
  { id: 'gl-5600', code: '5600', name: 'Professional & Legal Fees', type: 'expense' },
  { id: 'gl-5700', code: '5700', name: 'Travel & Entertainment', type: 'expense' },
  { id: 'gl-5800', code: '5800', name: 'Insurance', type: 'expense' },
  { id: 'gl-5900', code: '5900', name: 'Depreciation & Amortisation', type: 'expense' },
  { id: 'gl-6000', code: '6000', name: 'Interest Expense', type: 'expense' },
  { id: 'gl-1300', code: '1300', name: 'Inventory', type: 'asset' },
  { id: 'gl-1400', code: '1400', name: 'Fixed Assets', type: 'asset' },
  { id: 'gl-2200', code: '2200', name: 'Sales Tax Payable', type: 'liability' },
  { id: 'gl-2300', code: '2300', name: 'Payroll Liabilities', type: 'liability' },
  { id: 'gl-2400', code: '2400', name: 'Deferred Revenue', type: 'liability' },
  { id: 'gl-3200', code: '3200', name: 'Share Capital', type: 'equity' },
  { id: 'gl-4600', code: '4600', name: 'Other Income', type: 'revenue' },
];

export const INITIAL_JOURNAL: JournalEntry[] = [];

// ---------------------------------------------------------------------------
// Tax configuration — named tax profiles applied across invoices, bills,
// ledgers and journals. Each profile carries a rate; documents snapshot the
// rate and profile name so historical records stay accurate after edits.
// ---------------------------------------------------------------------------

export type TaxCategory = 'vat' | 'gst' | 'sales' | 'income' | 'withholding' | 'custom';

export interface TaxProfile {
  id: string;
  name: string; // e.g. "VAT (Standard)"
  rate: number; // percentage, e.g. 20 for 20%
  category: TaxCategory;
  description?: string;
}

export const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  vat: 'VAT',
  gst: 'GST',
  sales: 'Sales tax',
  income: 'Income tax',
  withholding: 'Withholding',
  custom: 'Custom',
};

export const INITIAL_TAX_PROFILES: TaxProfile[] = [
  { id: 'tax-standard', name: 'Standard', rate: 20, category: 'vat', description: 'Default taxable rate', },
  { id: 'tax-reduced', name: 'Reduced', rate: 5, category: 'vat', description: 'Reduced-rate goods & services' },
  { id: 'tax-gst', name: 'GST', rate: 5, category: 'gst', description: 'Goods & Services Tax' },
  { id: 'tax-vat-ca', name: 'VAT (Canada)', rate: 13, category: 'vat', description: 'Harmonized VAT' },
  { id: 'tax-zero', name: 'Zero-rated', rate: 0, category: 'custom', description: 'Exempt / zero-rated supplies' },
];

export const DEFAULT_TAX_PROFILE_ID = 'tax-standard';

// ---------------------------------------------------------------------------
// Banking — connected accounts, imported statements and reconciliation
// ---------------------------------------------------------------------------

export type BankSource = 'manual' | 'csv' | 'composio-plaid';

/** Account kind: the two classic bank account types plus every payment method (cash, mobile wallet, PayPal, Stripe, ...). */
export type BankAccountKind = 'checking' | 'savings' | PaymentMethod;

export const BANK_ACCOUNT_KIND_LABEL: Record<BankAccountKind, string> = {
  checking: 'Checking account',
  savings: 'Savings account',
  ...PAYMENT_METHOD_LABEL,
};

export const BANK_ACCOUNT_KINDS = Object.keys(BANK_ACCOUNT_KIND_LABEL) as BankAccountKind[];

export interface BankAccount {
  id: string;
  name: string;
  institution: string;
  currency: string;
  last4: string;
  kind: BankAccountKind;
  balance: number;
  source: BankSource;
  status: 'connected' | 'disconnected';
}

export interface BankTxn {
  id: string;
  bankAccountId: string;
  date: string;
  dateIso?: string; // optional machine-readable date for period filtering
  description: string;
  amount: number; // negative = money out
  method?: PaymentMethod; // cash, mobile wallet, wise, paypal, stripe—
  status: 'unmatched' | 'matched' | 'excluded';
  matchedRef?: string; // ledger label or journal memo it reconciles against
  accountId?: string; // GlAccount.id — the GL account this reconciled line posts against
}

/**
 * Reconciliation rule memory: every time a bank line is matched to a GL
 * account, the description pattern is remembered here so future statement
 * lines with a similar description auto-suggest (and can auto-apply) the
 * same account — the auto-reconciler gets smarter with use.
 */
export interface ReconciliationRule {
  id: string;
  pattern: string; // normalized (lowercased, digits stripped) description fragment
  accountId: string;
  matchCount: number;
  lastMatchedAt: string; // ISO
  createdAt: string; // ISO
}

export const INITIAL_RECONCILIATION_RULES: ReconciliationRule[] = [];

/** Normalize a bank line description into a stable rule-matching key (strip digits/punctuation noise, collapse whitespace). */
export function normalizeReconciliationPattern(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const INITIAL_BANK_ACCOUNTS: BankAccount[] = [];

export const INITIAL_BANK_TXNS: BankTxn[] = [];

// ---------------------------------------------------------------------------
// HR — time clock & team invites
// ---------------------------------------------------------------------------

export interface TimeEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  clockInIso: string; // ISO timestamp
  clockInLabel: string;
  clockOutIso?: string;
  clockOutLabel?: string;
  durationMin?: number;
  note?: string;
  editedBy?: 'user' | 'system';
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface TeamInvite {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string;
  token: string; // invite token — the accept link carries it
  status: InviteStatus;
  invitedAt: string; // ISO
  expiresAt: string; // ISO (14 days)
  acceptedAt?: string;
  invitedBy: string;
}

export const INVITE_STATUS_STYLE: Record<InviteStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  accepted: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  revoked: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  expired: 'bg-muted text-muted-foreground ring-border',
};

// ---------------------------------------------------------------------------
// Book closure — period locking with closing entries (monthly / quarterly /
// annual). The closing entry transfers revenue & expense balances into
// retained earnings; reopening posts an exact reversal.
// ---------------------------------------------------------------------------

export type ClosurePeriodType = 'monthly' | 'quarterly' | 'annual';

export interface ClosureChecklist {
  unpostedDrafts: number;
  unbalancedEntries: number;
  unreconciledBankTxns: number;
  openInvoicesOverdue: number;
}

export type SignoffReport = 'pl' | 'bs' | 'cf' | 'equity';
export type SignoffStatus = 'pending' | 'ready' | 'approved';

export interface ReportSignoff {
  reportId: SignoffReport;
  status: SignoffStatus;
  issues: string[]; // live report issues surfaced as notifications
  approvedAt?: string;
  approvedBy?: string;
}

export interface BookClosure {
  id: string;
  periodType: ClosurePeriodType;
  label: string; // e.g. "August 2026" / "Q3 2026" / "FY 2026"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  closedAt: string; // ISO
  closedBy: string;
  closingEntryId?: string;
  checklist: ClosureChecklist;
  netIncome: number; // P&L result rolled into retained earnings
  signoffs?: ReportSignoff[]; // per-report approval trail
  finalizedAt?: string; // ISO — set once every report sign-off is approved
  finalizedBy?: string;
}

// ---------------------------------------------------------------------------
// Localization option lists for the company form
// ---------------------------------------------------------------------------

export const COUNTRY_OPTIONS = [
  'Canada', 'United States', 'United Kingdom', 'Australia', 'Germany', 'France',
  'Denmark', 'Netherlands', 'Ireland', 'Singapore', 'South Africa', 'Nigeria', 'Kenya',
  'Ghana', 'India', 'United Arab Emirates', 'Brazil', 'Mexico', 'Japan', 'New Zealand',
] as const;

export const TIMEZONE_OPTIONS = [
  'UTC',
  'America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg',
  'America/Edmonton', 'America/Vancouver', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Dublin', 'Europe/Berlin', 'Europe/Paris',
  'Europe/Amsterdam', 'Europe/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
] as const;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const QUARTER_NAMES: Record<number, string> = {
  1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4',
};

/** Compute period start/end (YYYY-MM-DD) for a closure, honouring fiscal year end. */
export function closurePeriod(
  type: ClosurePeriodType,
  year: number,
  index: number, // month 1-12 | quarter 1-4 | 0 for annual
  fyEndMonth = 12,
): { start: string; end: string; label: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fyEnd = `${year}-${pad(fyEndMonth)}-${pad(new Date(year, fyEndMonth, 0).getDate())}`;
  const fyStartYear = fyEndMonth === 12 ? year : year - 1;
  const fyStart = `${fyStartYear}-${pad(fyEndMonth % 12 + 1)}-01`;
  if (type === 'annual') {
    return { start: fyStart, end: fyEnd, label: `FY ${year}` };
  }
  if (type === 'monthly') {
    const start = `${year}-${pad(index)}-01`;
    const end = `${year}-${pad(index)}-${pad(new Date(year, index, 0).getDate())}`;
    return { start, end, label: `${MONTH_NAMES[index - 1]} ${year}` };
  }
  const qStartMonth = (index - 1) * 3 + 1;
  const qEndMonth = index * 3;
  const start = `${year}-${pad(qStartMonth)}-01`;
  const end = `${year}-${pad(qEndMonth)}-${pad(new Date(year, qEndMonth, 0).getDate())}`;
  return { start, end, label: `${QUARTER_NAMES[index]} ${year}` };
}

// ---------------------------------------------------------------------------
// Localization datasets — power the dropdown/datalist widgets on company,
// customer and HR forms. Regions fall back to free text for countries that
// are not listed.
// ---------------------------------------------------------------------------

export const INDUSTRY_OPTIONS = [
  'Logistics & Supply Chain', 'Freight & Forwarding', 'Retail & E-commerce',
  'Manufacturing', 'Construction', 'Professional Services', 'Creative & Media',
  'Technology & SaaS', 'Financial Services', 'Investments', 'Healthcare',
  'Education', 'Hospitality & Tourism', 'Agriculture', 'Energy & Utilities',
  'Real Estate', 'Transportation', 'Wholesale & Distribution', 'Non-profit',
  'Government', 'Legal', 'Insurance', 'Telecommunications', 'Other',
] as const;

export const REGIONS_BY_COUNTRY: Partial<Record<string, string[]>> = {
  Canada: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'],
  'United States': ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'],
  'United Kingdom': ['England — Greater London', 'England — South East', 'England — South West', 'England — North West', 'England — North East', 'England — Midlands', 'England — Yorkshire', 'Scotland', 'Wales', 'Northern Ireland'],
  Australia: ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'],
  Germany: ['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'],
  India: ['Delhi', 'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Gujarat', 'Rajasthan', 'Uttar Pradesh', 'West Bengal', 'Kerala', 'Punjab', 'Haryana'],
  'South Africa': ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape'],
  Nigeria: ['Lagos', 'Abuja FCT', 'Rivers', 'Kano', 'Oyo', 'Kaduna', 'Enugu', 'Delta', 'Edo', 'Ogun'],
  'United Arab Emirates': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'],
};

export const CITIES_BY_COUNTRY: Partial<Record<string, string[]>> = {
  Canada: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton', 'Winnipeg', 'Halifax', 'Saskatoon', 'Regina', 'Quebec City', 'Victoria'],
  'United States': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Austin', 'Seattle', 'Denver', 'Boston', 'Miami', 'Atlanta', 'San Francisco'],
  'United Kingdom': ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Bristol', 'Edinburgh', 'Cardiff', 'Belfast', 'Newcastle'],
  Australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Hobart', 'Darwin'],
  Germany: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dortmund'],
  France: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Bordeaux', 'Lille'],
  Netherlands: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven', 'Groningen'],
  Ireland: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford'],
  Singapore: ['Singapore (Downtown)', 'Jurong', 'Tampines', 'Woodlands'],
  'South Africa': ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth', 'Bloemfontein'],
  Nigeria: ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Benin City', 'Enugu'],
  Kenya: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'],
  India: ['Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur'],
  'United Arab Emirates': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain'],
  Brazil: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte'],
  Mexico: ['Mexico City', 'Guadalajara', 'Monterrey', 'Cancún', 'Tijuana', 'Puebla'],
  Japan: ['Tokyo', 'Osaka', 'Yokohama', 'Nagoya', 'Sapporo', 'Kyoto', 'Fukuoka'],
  'New Zealand': ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Dunedin'],
};
