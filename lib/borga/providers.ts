/**
 * Third-party integrations users configure with their OWN credentials
 * (bring-your-own app/token). Shared by client (forms) and server (validation).
 */

export type ProviderId = 'company_engine' | 'twilio' | 'meta' | 'google_ads' | 'linkedin' | 'chatgpt_ads' | 'supermemory';

export interface FieldDef {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  hint?: string;
  placeholder?: string;
  /** Server-side format check (anchored regex source). */
  pattern?: string;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  description: string;
  fields: FieldDef[];
  /** "How to get these" checklist shown in the UI. */
  steps: string[];
  docsUrl: string;
  /** False when no live credential check exists yet. */
  testable: boolean;
  /** Webhook path suffix, when the provider calls us back. */
  webhook?: 'meta' | 'twilio';
}

const E164 = '^\\+[1-9]\\d{6,14}$';

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'company_engine',
    label: 'Company Engine (your CRM / company API)',
    description: "This company's own API portal. Pulls customers and deals straight from your CRM into Borga, and runs engine workflows. Configure it under Company → Company Engine.",
    fields: [
      { key: 'baseUrl', label: 'API base URL', secret: false, required: true, placeholder: 'https://crm.yourcompany.com/api/v1', hint: 'https only (public address)', pattern: '^https?://\\S+' + '$' },
      { key: 'apiKey', label: 'API key / token', secret: true, required: true },
      { key: 'authHeader', label: 'Auth header', secret: false, required: false, placeholder: 'Authorization', hint: 'Default Authorization. Use X-API-Key etc. if your API expects it.' },
      { key: 'authPrefix', label: 'Auth prefix', secret: false, required: false, placeholder: 'Bearer', hint: 'Default "Bearer". Type none to send the raw key, or e.g. "Token".' },
      { key: 'customersPath', label: 'Customers path', secret: false, required: false, placeholder: '/customers', hint: 'Default /customers' },
      { key: 'leadsPath', label: 'Deals / leads path', secret: false, required: false, placeholder: '/leads', hint: 'Default /leads' },
      { key: 'listKey', label: 'List key', secret: false, required: false, placeholder: 'data', hint: 'Only if the records sit under a custom field of the response' },
    ],
    steps: [
      'Create an API key (read access is enough for pulling data) in your CRM or company API.',
      'Enter the base URL and the key. If your API uses a different header or paths, adjust the optional fields.',
      'Press Test connection, then Pull now under Company Engine → CRM data.',
    ],
    docsUrl: '',
    testable: true,
  },
  {
    id: 'twilio',
    label: 'Twilio (calls)',
    description: 'Real outbound/inbound calls and voicemail for USA, Canada and Ghana.',
    fields: [
      { key: 'accountSid', label: 'Account SID', secret: false, required: true, placeholder: 'ACxxxxxxxx…', pattern: '^AC[0-9a-fA-F]{32}$' },
      { key: 'authToken', label: 'Auth token', secret: true, required: true, pattern: '^[0-9a-fA-F]{32}$' },
      { key: 'phoneNumber', label: 'Caller ID / Twilio number', secret: false, required: true, placeholder: '+14155550100', hint: 'E.164 format', pattern: E164 },
      { key: 'forwardTo', label: 'Forward inbound calls to', secret: false, required: false, placeholder: '+233201234567', hint: 'Optional E.164 destination for inbound calls', pattern: E164 },
    ],
    steps: [
      'Create a Twilio account and copy the Account SID and Auth token from the console dashboard.',
      'Buy or verify a number that can place calls (check Ghana number availability and regulatory bundle requirements).',
      'In Voice → Settings → Geo permissions enable only United States, Canada and Ghana.',
      'Paste the values here and press Test connection.',
    ],
    docsUrl: 'https://www.twilio.com/docs/usage/api',
    testable: true,
    webhook: 'twilio',
  },
  {
    id: 'meta',
    label: 'Meta (Ads + WhatsApp)',
    description: 'Facebook/Instagram Ads reporting and WhatsApp Business Cloud API.',
    fields: [
      { key: 'appId', label: 'App ID', secret: false, required: true, pattern: '^\\d{5,20}$' },
      { key: 'appSecret', label: 'App secret', secret: true, required: true, hint: 'Also used to verify webhook signatures' },
      { key: 'accessToken', label: 'System-user access token', secret: true, required: true },
      { key: 'adAccountId', label: 'Ad account ID', secret: false, required: false, placeholder: 'act_1234567890', pattern: '^(act_)?\\d{5,20}$' },
      { key: 'whatsappPhoneNumberId', label: 'WhatsApp phone number ID', secret: false, required: false, pattern: '^\\d{5,20}$' },
      { key: 'whatsappBusinessAccountId', label: 'WhatsApp business account ID', secret: false, required: false, pattern: '^\\d{5,20}$' },
    ],
    steps: [
      'Create an app at developers.facebook.com and add the Marketing API and/or WhatsApp products.',
      'Create a system user in Business Settings, assign the ad account and WhatsApp account, and generate a long-lived token (ads_read, whatsapp_business_messaging, whatsapp_business_management).',
      'Paste the values here and Test connection.',
      'Copy the webhook URL and verify token shown after saving into the app’s WhatsApp → Configuration page.',
    ],
    docsUrl: 'https://developers.facebook.com/docs/',
    testable: true,
    webhook: 'meta',
  },
  {
    id: 'google_ads',
    label: 'Google Ads',
    description: 'Daily spend, clicks and conversions per campaign.',
    fields: [
      { key: 'developerToken', label: 'Developer token', secret: true, required: true, hint: 'From your Google Ads manager account (API Center)' },
      { key: 'clientId', label: 'OAuth client ID', secret: false, required: true },
      { key: 'clientSecret', label: 'OAuth client secret', secret: true, required: true },
      { key: 'refreshToken', label: 'OAuth refresh token', secret: true, required: true },
      { key: 'customerId', label: 'Customer ID', secret: false, required: true, placeholder: '123-456-7890', pattern: '^\\d{3}-?\\d{3}-?\\d{4}$' },
      { key: 'loginCustomerId', label: 'Manager (login) customer ID', secret: false, required: false, pattern: '^\\d{3}-?\\d{3}-?\\d{4}$' },
    ],
    steps: [
      'Apply for a developer token in your Google Ads manager account (API Center).',
      'Create an OAuth client in Google Cloud and enable the Google Ads API.',
      'Authorize once with scope https://www.googleapis.com/auth/adwords to obtain a refresh token.',
      'Paste the values here and Test connection.',
    ],
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
    testable: true,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Ads',
    description: 'Campaign spend and results from LinkedIn Marketing.',
    fields: [
      { key: 'clientId', label: 'Client ID', secret: false, required: true },
      { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
      { key: 'accessToken', label: 'Access token', secret: true, required: true },
      { key: 'refreshToken', label: 'Refresh token', secret: true, required: false },
      { key: 'adAccountId', label: 'Ad account ID', secret: false, required: true, pattern: '^\\d{4,20}$' },
    ],
    steps: [
      'Create an app in the LinkedIn developer portal and request the Advertising API product.',
      'Authorize with r_ads and r_ads_reporting scopes to obtain tokens.',
      'Paste the values here and Test connection.',
    ],
    docsUrl: 'https://learn.microsoft.com/linkedin/marketing/',
    testable: true,
  },
  {
    id: 'supermemory',
    label: 'Supermemory (AI memory)',
    description: 'Long-term semantic memory for agents, knowledge-base search and similar tickets. Optional: a deployment-wide SUPERMEMORY_API_KEY also works. Turn the feature on in Settings → Features.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'sm_…', hint: 'Stored encrypted; data is isolated per workspace by container tag.' }],
    steps: [
      'Create a key at console.supermemory.ai/keys.',
      'Paste it here and press Test connection.',
      'Enable "Supermemory" under Settings → Features, then choose which data sources may be sent (Knowledge Base → Supermemory).',
    ],
    docsUrl: 'https://supermemory.ai/docs',
    testable: true,
  },
  {
    id: 'chatgpt_ads',
    label: 'ChatGPT Ads',
    description: 'Awaiting the API specification. Until then, import reports as CSV.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      { key: 'accountId', label: 'Account ID', secret: false, required: false },
    ],
    steps: ['The connector is built once the API spec and a test credential are supplied. You can store credentials now.'],
    docsUrl: '',
    testable: false,
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as ProviderId[];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Last 4 chars only; never reveals short secrets. */
export function maskSecret(v: string): string {
  return v.length <= 8 ? '••••' : `••••${v.slice(-4)}`;
}
