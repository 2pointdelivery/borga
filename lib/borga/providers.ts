/**
 * Third-party integrations users configure with their OWN credentials
 * (bring-your-own app/token). Shared by client (forms) and server (validation).
 */

import { MAILDOG_HOST, MAILDOG_URL } from './maildog';

export type ProviderId = 'company_engine' | 'twilio' | 'meta' | 'google_ads' | 'linkedin' | 'chatgpt_ads' | 'supermemory' | 'saltedge' | 'smtp' | 'elevenlabs' | 'deepgram' | 'fish';

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
  /** A service the company can create an account with to get these details, shown at the top of the form. */
  signup?: { title: string; text: string; label: string; url: string };
  /** Ready-made values for a known service: one click fills the fields that are the same for everybody. */
  presets?: Array<{ id: string; label: string; values: Record<string, string>; note: string }>;
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
    id: 'smtp',
    label: 'Email (your own SMTP server)',
    description: "Send this company's mail (ticket replies, update emails) from its own address through its own mail server, instead of the shared sender. Optional: without it, mail goes out from the deployment's shared sender if there is one.",
    fields: [
      { key: 'host', label: 'SMTP server', secret: false, required: true, placeholder: 'smtp.gmail.com', hint: 'A host name, not an IP address' },
      { key: 'port', label: 'Port', secret: false, required: false, placeholder: '587', hint: '587 (STARTTLS) is the usual one; 465 is always encrypted. Allowed: 25, 465, 587, 2525.', pattern: '^\\d{2,5}' + '$' },
      { key: 'secure', label: 'Encrypted from the start', secret: false, required: false, placeholder: 'no', hint: 'yes for port 465, no for 587. The connection is always encrypted either way.' },
      { key: 'user', label: 'User name', secret: false, required: false, placeholder: 'you@yourcompany.com' },
      { key: 'password', label: 'Password or app password', secret: true, required: false, hint: 'Gmail and Microsoft need an app password. Stored encrypted; never shown again.' },
      { key: 'fromAddress', label: 'Send from', secret: false, required: true, placeholder: 'billing@yourcompany.com', hint: 'An address your mail provider lets this account send as' },
      { key: 'fromName', label: 'Sender name', secret: false, required: false, placeholder: 'Your Company' },
    ],
    steps: [
      `No mail server yet? Create a MailDog account at ${MAILDOG_URL}: it gives you your email address and SMTP details, with a sending domain that is already verified.`,
      'Otherwise ask your mail provider (Google Workspace, Microsoft 365, Zoho, your host) for its SMTP server name and port, and create an app password if it requires one.',
      'Enter them here with the address mail should come from, then press Test connection.',
      'Press Send me a test email to see it arrive in your own inbox.',
    ],
    docsUrl: MAILDOG_URL,
    testable: true,
    signup: {
      title: 'No mail server? Get one with MailDog',
      text: 'MailDog gives your company its own email address and the SMTP details to send from it, on a domain that is already set up so your mail is trusted. Create an account, then come back and fill in the user name, password and address it gives you.',
      label: 'Create a MailDog account',
      url: MAILDOG_URL,
    },
    presets: [
      {
        id: 'maildog',
        label: 'Use MailDog settings',
        values: { host: MAILDOG_HOST, port: '587', secure: 'no' },
        note: 'Fills in the server and port. Then add your MailDog user name, password and the address mail should come from (it must be on your MailDog domain).',
      },
    ],
  },
  {
    id: 'saltedge',
    label: 'Salt Edge (bank statements)',
    description: "Connects the company's bank accounts and imports their transactions for reconciliation. Optional: a deployment-wide SALTEDGE_APP_ID and SALTEDGE_SECRET also work, so each company does not need its own.",
    fields: [
      { key: 'appId', label: 'App ID', secret: false, required: true, placeholder: 'Salt Edge App-id', pattern: '^\\S{6,64}' + '$' },
      { key: 'secret', label: 'Secret', secret: true, required: true, hint: 'Stored encrypted; never shown again.' },
    ],
    steps: [
      'Create a Salt Edge client (the test client is free) and copy its App ID and Secret from the Salt Edge dashboard.',
      'Paste them here and press Test connection.',
      "Press Connect a bank and sign in to the bank on Salt Edge's page. Borga never sees the bank password.",
      'A Live client also needs request signing: set SALTEDGE_PRIVATE_KEY on the server and upload the matching public key in the Salt Edge dashboard.',
    ],
    docsUrl: 'https://docs.saltedge.com/v6/',
    testable: true,
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs (voices)',
    description: "Gives this company's agents a spoken voice, in the dashboard and on phone calls. Bring your own key: the usage is billed to your ElevenLabs account.",
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, hint: 'Stored encrypted; never shown again.' }],
    steps: ['Open elevenlabs.io/app/api-key and create an API key.', 'Copy the secret key (it starts with sk_ and is shown once when created). The key ID shown in the list is not the key.', 'Paste it here and press Test connection.'],
    docsUrl: 'https://elevenlabs.io/docs/api-reference',
    testable: true,
  },
  {
    id: 'deepgram',
    label: 'Deepgram (speech to text)',
    description: 'Turns push-to-talk recordings into text. Without it the browser built-in recognition is used. Bring your own key.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, hint: 'Stored encrypted; never shown again.' }],
    steps: ['Open console.deepgram.com and create an API key.', 'Paste it here and press Test connection.'],
    docsUrl: 'https://developers.deepgram.com/docs',
    testable: true,
  },
  {
    id: 'fish',
    label: 'Fish Audio (voices)',
    description: 'An alternative spoken voice for the dashboard assistant and agent replies. Phone calls still use ElevenLabs. Bring your own key: usage is billed to your Fish Audio account.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, required: true, hint: 'Stored encrypted; never shown again.' },
      { key: 'voiceId', label: 'Voice ID (reference model)', secret: false, required: false, hint: 'The model id from the voice page on fish.audio (the long hex code in its address). Leave empty to use the default voice.', placeholder: '802e3bc2b27e49c2995d23ef70e6ac89', pattern: '^[A-Za-z0-9]{8,64}$' },
    ],
    steps: ['Open fish.audio, go to your API keys and create a key.', 'Open a voice you like on fish.audio and copy the id from its address (or from your own cloned voice).', 'Paste both here and press Test connection.'],
    docsUrl: 'https://docs.fish.audio/api-reference/introduction',
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
