import type { ProviderId } from './providers';
import { smBase } from './supermemory-core';
import { createSaltEdgeClient, SaltEdgeError } from './saltedge';
import { parseSmtp } from './smtp-core';

/**
 * Live credential checks. Pure (fetch is injected) so they are unit-tested with
 * a mocked fetch; each calls the provider's real API in production.
 * Version constants are the one thing that drifts: bump them when a provider sunsets one.
 */

export const META_GRAPH_VERSION = 'v21.0';
export const GOOGLE_ADS_API_VERSION = 'v20';
export const LINKEDIN_API_VERSION = '202509';

export interface TestResult {
  ok: boolean;
  message: string;
  details?: string[];
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

async function getJson(f: Fetch, url: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

const errText = (j: Record<string, unknown>): string => {
  const e = j.error;
  if (typeof e === 'string') return (j.error_description as string) || e;
  if (e && typeof e === 'object') return String((e as { message?: unknown }).message ?? JSON.stringify(e)).slice(0, 200);
  return String(j.message ?? '').slice(0, 200);
};

async function testTwilio(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const auth = `Basic ${Buffer.from(`${v.accountSid}:${v.authToken}`).toString('base64')}`;
  const acct = await getJson(f, `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(v.accountSid)}.json`, { headers: { Authorization: auth } });
  if (acct.status === 401) return { ok: false, message: 'Twilio rejected the Account SID / Auth token.' };
  if (acct.status !== 200) return { ok: false, message: `Twilio returned HTTP ${acct.status}.` };
  if (acct.json.status !== 'active') return { ok: false, message: `Twilio account status is "${String(acct.json.status)}", not active.` };
  const details = [`Account active (${String(acct.json.type ?? 'unknown')} type).`];
  if (acct.json.type === 'Trial') details.push('Trial accounts can only call verified numbers.');
  const nums = await getJson(f, `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(v.accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(v.phoneNumber)}`, { headers: { Authorization: auth } });
  const owned = Array.isArray(nums.json.incoming_phone_numbers) && nums.json.incoming_phone_numbers.length > 0;
  if (nums.status === 200 && !owned) {
    return { ok: false, message: `Credentials work, but ${v.phoneNumber} is not a number on this Twilio account.`, details };
  }
  if (owned) details.push(`${v.phoneNumber} belongs to this account.`);
  return { ok: true, message: 'Connected to Twilio.', details };
}

async function testMeta(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
  const q = `access_token=${encodeURIComponent(v.accessToken)}`;
  const me = await getJson(f, `${base}/me?${q}`);
  if (me.status !== 200) return { ok: false, message: `Meta rejected the access token: ${errText(me.json) || `HTTP ${me.status}`}` };
  const details = [`Token valid for "${String(me.json.name ?? me.json.id)}".`];
  let ok = true;
  if (v.adAccountId) {
    const id = v.adAccountId.startsWith('act_') ? v.adAccountId : `act_${v.adAccountId}`;
    const ad = await getJson(f, `${base}/${id}?fields=name,account_status&${q}`);
    if (ad.status === 200) details.push(`Ad account: ${String(ad.json.name)}.`);
    else {
      ok = false;
      details.push(`Ad account not accessible: ${errText(ad.json) || `HTTP ${ad.status}`}`);
    }
  }
  if (v.whatsappPhoneNumberId) {
    const wa = await getJson(f, `${base}/${v.whatsappPhoneNumberId}?fields=display_phone_number,verified_name&${q}`);
    if (wa.status === 200) details.push(`WhatsApp number: ${String(wa.json.display_phone_number)} (${String(wa.json.verified_name ?? 'unverified')}).`);
    else {
      ok = false;
      details.push(`WhatsApp number not accessible: ${errText(wa.json) || `HTTP ${wa.status}`}`);
    }
  }
  return { ok, message: ok ? 'Connected to Meta.' : 'Token is valid but some assets are not accessible.', details };
}

async function testGoogleAds(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const tok = await getJson(f, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: v.clientId, client_secret: v.clientSecret, refresh_token: v.refreshToken, grant_type: 'refresh_token' }),
  });
  const access = tok.json.access_token;
  if (tok.status !== 200 || typeof access !== 'string') return { ok: false, message: `Google rejected the OAuth credentials: ${errText(tok.json) || `HTTP ${tok.status}`}` };
  const headers: Record<string, string> = { Authorization: `Bearer ${access}`, 'developer-token': v.developerToken };
  if (v.loginCustomerId) headers['login-customer-id'] = v.loginCustomerId.replace(/-/g, '');
  const list = await getJson(f, `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, { headers });
  if (list.status !== 200) return { ok: false, message: `OAuth works, but the Ads API refused the request: ${errText(list.json) || `HTTP ${list.status}`} (check the developer token and its approval level).` };
  const names = Array.isArray(list.json.resourceNames) ? (list.json.resourceNames as string[]) : [];
  const wanted = `customers/${v.customerId.replace(/-/g, '')}`;
  if (!names.includes(wanted)) return { ok: false, message: `Credentials work but customer ${v.customerId} is not accessible to this login.`, details: [`${names.length} accessible customer(s).`] };
  return { ok: true, message: 'Connected to Google Ads.', details: [`Customer ${v.customerId} is accessible.`] };
}

async function testLinkedIn(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const r = await getJson(f, `https://api.linkedin.com/rest/adAccounts/${encodeURIComponent(v.adAccountId)}`, {
    headers: { Authorization: `Bearer ${v.accessToken}`, 'LinkedIn-Version': LINKEDIN_API_VERSION, 'X-Restli-Protocol-Version': '2.0.0' },
  });
  if (r.status === 401) return { ok: false, message: 'LinkedIn rejected the access token (expired or missing scopes).' };
  if (r.status === 403 || r.status === 404) return { ok: false, message: `LinkedIn cannot access ad account ${v.adAccountId} with this token (HTTP ${r.status}).` };
  if (r.status !== 200) return { ok: false, message: `LinkedIn returned HTTP ${r.status}: ${errText(r.json)}` };
  return { ok: true, message: 'Connected to LinkedIn.', details: [`Ad account: ${String(r.json.name ?? v.adAccountId)}.`] };
}

async function testSupermemory(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const r = await getJson(f, smBase() + '/v3/documents/list', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + v.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ containerTags: ['borga_connection_test'], limit: 1 }),
  });
  if (r.status === 401 || r.status === 403) return { ok: false, message: 'Supermemory rejected the API key.' };
  if (r.status === 429) return { ok: false, message: 'Key is valid but rate limited right now. Try again shortly.' };
  if (r.status !== 200) return { ok: false, message: 'Supermemory returned HTTP ' + r.status + ': ' + errText(r.json) };
  return { ok: true, message: 'Connected to Supermemory.' };
}

async function testSmtp(v: Record<string, string>): Promise<TestResult> {
  const r = parseSmtp(v);
  if (!r.ok) return { ok: false, message: r.error };
  // loaded here, not at the top: the transport is server-only and this module is also imported by tests
  const { verifySmtp } = await import('./smtp-transport');
  const c = await verifySmtp(r.settings);
  return { ok: c.ok, message: c.message, details: c.ok ? ['Nothing was sent. Press Send me a test email to see a message arrive.'] : undefined };
}

async function testSaltEdge(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const pem = (process.env.SALTEDGE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n') || undefined;
  const client = createSaltEdgeClient({ appId: v.appId, secret: v.secret, privateKeyPem: pem }, { fetch: f, timeoutMs: TIMEOUT_MS });
  try {
    await client.request('GET', '/customers', { query: { per_page: 1 } });
  } catch (e) {
    if (e instanceof SaltEdgeError) {
      if (e.status === 401 || e.status === 403 || /ApiKey|Unauthor|Signature/i.test(e.errorClass)) return { ok: false, message: `Salt Edge rejected the credentials: ${e.message}`, details: pem ? [] : ['A Live client also needs SALTEDGE_PRIVATE_KEY set on the server for request signing.'] };
      return { ok: false, message: `Salt Edge returned: ${e.message}` };
    }
    throw e;
  }
  return { ok: true, message: 'Connected to Salt Edge.', details: [pem ? 'Requests are signed (Live client).' : 'Requests are not signed: fine for a test client.'] };
}

async function testElevenLabs(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const r = await getJson(f, 'https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': v.apiKey } });
  if (r.status === 401 || r.status === 403) return { ok: false, message: 'ElevenLabs rejected the API key.' };
  if (r.status >= 400) return { ok: false, message: `ElevenLabs answered ${r.status}.` };
  return { ok: true, message: 'Connected to ElevenLabs.' };
}

async function testDeepgram(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const r = await getJson(f, 'https://api.deepgram.com/v1/auth/token', { headers: { Authorization: `Token ${v.apiKey}` } });
  if (r.status === 401 || r.status === 403) return { ok: false, message: 'Deepgram rejected the API key.' };
  if (r.status >= 400) return { ok: false, message: `Deepgram answered ${r.status}.` };
  return { ok: true, message: 'Connected to Deepgram.' };
}

async function testFish(v: Record<string, string>, f: Fetch): Promise<TestResult> {
  const r = await getJson(f, 'https://api.fish.audio/wallet/self/api-credit', { headers: { Authorization: `Bearer ${v.apiKey}` } });
  if (r.status === 401 || r.status === 403) return { ok: false, message: 'Fish Audio rejected the API key.' };
  if (r.status >= 400) return { ok: false, message: `Fish Audio answered ${r.status}.` };
  if (v.voiceId) {
    const m = await getJson(f, `https://api.fish.audio/model/${encodeURIComponent(v.voiceId)}`, { headers: { Authorization: `Bearer ${v.apiKey}` } });
    if (m.status === 404) return { ok: false, message: 'The key works, but Fish Audio has no voice with that ID.' };
  }
  return { ok: true, message: v.voiceId ? 'Connected to Fish Audio and the voice was found.' : 'Connected to Fish Audio (default voice).' };
}

export async function runProviderTest(id: ProviderId, values: Record<string, string>, f: Fetch = fetch): Promise<TestResult> {
  try {
    switch (id) {
      case 'twilio': return await testTwilio(values, f);
      case 'meta': return await testMeta(values, f);
      case 'google_ads': return await testGoogleAds(values, f);
      case 'linkedin': return await testLinkedIn(values, f);
      case 'supermemory': return await testSupermemory(values, f);
      case 'saltedge': return await testSaltEdge(values, f);
      case 'smtp': return await testSmtp(values);
      case 'elevenlabs': return await testElevenLabs(values, f);
      case 'deepgram': return await testDeepgram(values, f);
      case 'fish': return await testFish(values, f);
      case 'company_engine': return { ok: false, message: 'Tested through the Company Engine client (see connections-server).' };
      case 'chatgpt_ads': return { ok: false, message: 'No live check yet: the ChatGPT Ads API specification is pending.' };
    }
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, message: name === 'TimeoutError' ? 'The provider did not respond within 10 seconds.' : `Could not reach the provider: ${(e as Error).message}` };
  }
}
