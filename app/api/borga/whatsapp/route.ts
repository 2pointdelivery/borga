import { NextResponse, type NextRequest } from 'next/server';
import { setApiKey, isAllowedKey } from '@/lib/borga/secrets';
import { whatsappCredentials } from '@/lib/borga/provider-keys';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { operatorFromRequest } from '@/lib/auth/operator';
import { type WhatsAppConfig } from '@/lib/borga/data';
import { featureGate, sessionUserId } from '@/lib/borga/features-server';
import { assertPublicUrl } from '@/lib/borga/safe-url';
import {
  buildWaMeUrl,
  buildWhatsAppWebUrl,
  cleanWhatsAppPhone,
  renderQrDataUrl,
  renderQrSvg,
} from '@/lib/borga/whatsapp-qr';

export const runtime = 'nodejs';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v18.0';

interface WhatsAppMessage {
  to: string;
  text?: string;
  template?: {
    name: string;
    language: { code: string };
    components?: Array<{
      type: string;
      parameters: Array<{ type: string; text?: string }>;
    }>;
  };
}

interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

// Validate phone number format
function isValidPhoneNumber(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^\+?[1-9]\d{6,14}$/.test(cleaned);
}

// Normalize phone number
function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) {
    return `+${cleaned}`;
  }
  return cleaned;
}

// The per-company connection state lives under the signed-in user's own workspace key, the same key the
// dashboard reads. (It used to be an un-prefixed key: invisible to the dashboard and addressable by anyone
// who knew a workspace id.)
const waKey = (userId: string, ws: string | null) => (ws ? userWsKey(userId, ws, 'whatsapp') : null);

// Load WhatsApp configuration (user + workspace scoped)
async function loadWhatsAppConfig(userId: string, ws: string | null): Promise<WhatsAppConfig> {
  const key = waKey(userId, ws);
  const config = key ? await getBorgaState<WhatsAppConfig>(key) : null;
  return config || { connected: false, phone: '', waId: '', lastSync: '…' };
}

// Save WhatsApp configuration
async function saveWhatsAppConfig(config: WhatsAppConfig, userId: string, ws: string | null): Promise<boolean> {
  const key = waKey(userId, ws);
  return key ? setBorgaState(key, config) : false;
}

// Get WhatsApp API credentials
const getWhatsAppCredentials = whatsappCredentials;

// Send WhatsApp message
async function sendWhatsAppMessage(message: WhatsAppMessage, userId: string, ws: string | null): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const credentials = await getWhatsAppCredentials(userId, ws);
  if (!credentials) {
    return { success: false, error: 'WhatsApp is not connected for this company. Add its Meta credentials under Integrations → Connections.' };
  }

  const { accessToken, phoneNumberId } = credentials;

  try {
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to,
        ...message.text ? { text: { body: message.text } } : {},
        ...message.template ? { template: message.template } : {},
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('WhatsApp API error:', response.status, errorText);
      return {
        success: false,
        error: `WhatsApp API rejected the message (HTTP ${response.status}). Check your WhatsApp credentials under Integrations → Connections.`,
      };
    }

    const data = await response.json() as WhatsAppApiResponse;
    const messageId = data.messages?.[0]?.id;

    return { success: true, messageId };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return {
      success: false,
      error: 'Could not reach the WhatsApp API.',
    };
  }
}

// Verify WhatsApp business number
async function verifyWhatsAppNumber(userId: string, ws: string | null): Promise<{ verified: boolean; phone?: string; error?: string }> {
  const credentials = await getWhatsAppCredentials(userId, ws);
  if (!credentials) {
    return { verified: false, error: 'WhatsApp credentials not configured' };
  }

  const { accessToken, phoneNumberId } = credentials;

  try {
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { verified: false, error: `Failed to verify phone number (HTTP ${response.status})` };
    }

    const data = await response.json();
    const phone = data.display_phone_number || data.phone_number;

    return { verified: true, phone };
  } catch (error) {
    console.error('WhatsApp verification error:', error);
    return {
      verified: false,
      error: 'Verification failed — could not reach the WhatsApp API.',
    };
  }
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: {
    action?: string;
    to?: string;
    phone?: string;
    text?: string;
    bridgeUrl?: string;
    pairedDevice?: string;
    templateName?: string;
    templateLanguage?: string;
    templateParameters?: Array<{ type: string; text?: string }>;
    persistKey?: boolean;
    accessToken?: string;
    ws?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const action = body.action ?? 'send';
  const ws = typeof body.ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.ws) ? body.ws : null;
  const off = await featureGate('whatsapp', userId, ws);
  if (off) return off;

  if (action === 'configure') {
    const { accessToken, persistKey } = body;
    
    if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 20) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Valid WhatsApp access token is required.' 
      }, { status: 400 });
    }

    // The saved token is the deployment-wide one shared by every company, so only an administrator may replace it.
    if (persistKey && !(await operatorFromRequest(req))) {
      return NextResponse.json({ ok: false, error: 'Only the deployment administrator can save the shared WhatsApp access token.' }, { status: 403 });
    }

    // Persist the access token if requested
    if (persistKey && isAllowedKey('WHATSAPP_ACCESS_TOKEN')) {
      await setApiKey('WHATSAPP_ACCESS_TOKEN', accessToken.trim());
    }

    // Verify the configuration
    const verification = await verifyWhatsAppNumber(userId, ws);
    
    if (verification.verified) {
      const config = await loadWhatsAppConfig(userId, ws);
      config.connected = true;
      config.phone = verification.phone || '';
      config.waId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
      config.lastSync = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      await saveWhatsAppConfig(config, userId, ws);

      return NextResponse.json({ 
        ok: true, 
        action: 'configure', 
        connected: true,
        phone: verification.phone,
        message: 'WhatsApp configured successfully' 
      });
    } else {
      return NextResponse.json({ 
        ok: false, 
        action: 'configure', 
        error: verification.error || 'WhatsApp verification failed' 
      }, { status: 400 });
    }
  }

  if (action === 'send') {
    const { to, text, templateName, templateLanguage, templateParameters } = body;

    if (!to || !isValidPhoneNumber(to)) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Valid phone number is required (format: +1234567890)' 
      }, { status: 400 });
    }

    if (!text && !templateName) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Either text message or template name is required' 
      }, { status: 400 });
    }

    const config = await loadWhatsAppConfig(userId, ws);
    if (!config.connected) {
      return NextResponse.json({ 
        ok: false, 
        error: 'WhatsApp is not configured. Please configure it first.' 
      }, { status: 400 });
    }

    if (config.mode === 'qr-web') {
      const normalized = normalizePhoneNumber(to);
      const webUrl = buildWhatsAppWebUrl(normalized, text);
      const waMeUrl = buildWaMeUrl(normalized, text);
      const bridgeUrl = (config.bridgeUrl || process.env.WHATSAPP_WEB_BRIDGE_URL || '').trim().replace(/\/+$/, '');
      if (bridgeUrl) {
        try {
          const safeTarget = await assertPublicUrl(`${bridgeUrl}/send`);
          const bridgeRes = await fetch(safeTarget.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: cleanWhatsAppPhone(normalized), text: text || '' }),
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
          });
          if (bridgeRes.ok) {
            const bridgeData = (await bridgeRes.json().catch(() => ({}))) as { messageId?: string };
            return NextResponse.json({
              ok: true,
              action: 'send',
              mode: 'qr-web',
              deliveredVia: 'bridge',
              messageId: bridgeData.messageId || `wa-bridge-${Date.now()}`,
              webUrl,
              waMeUrl,
              message: 'Message dispatched via WhatsApp Web bridge',
            });
          }
        } catch {
          // Fall back to WhatsApp Web deep-link handoff
        }
      }
      return NextResponse.json({
        ok: true,
        action: 'send',
        mode: 'qr-web',
        deliveredVia: 'web-handoff',
        messageId: `wa-web-${Date.now()}`,
        webUrl,
        waMeUrl,
        message: 'Ready for WhatsApp Web dispatch',
      });
    }

    const message: WhatsAppMessage = {
      to: normalizePhoneNumber(to),
    };

    if (text) {
      message.text = text;
    }

    if (templateName) {
      message.template = {
        name: templateName,
        language: { code: templateLanguage || 'en_US' },
      };

      if (templateParameters && templateParameters.length > 0) {
        message.template.components = [{
          type: 'body',
          parameters: templateParameters,
        }];
      }
    }

    const result = await sendWhatsAppMessage(message, userId, ws);

    if (result.success) {
      return NextResponse.json({ 
        ok: true, 
        action: 'send', 
        messageId: result.messageId,
        message: 'Message sent successfully' 
      });
    } else {
      return NextResponse.json({ 
        ok: false, 
        action: 'send', 
        error: result.error 
      }, { status: 502 });
    }
  }

  if (action === 'verify') {
    const verification = await verifyWhatsAppNumber(userId, ws);
    
    if (verification.verified) {
      const config = await loadWhatsAppConfig(userId, ws);
      config.connected = true;
      config.phone = verification.phone || '';
      config.lastSync = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      await saveWhatsAppConfig(config, userId, ws);

      return NextResponse.json({ 
        ok: true, 
        action: 'verify', 
        verified: true,
        phone: verification.phone 
      });
    } else {
      // Mark as disconnected if verification fails
      const config = await loadWhatsAppConfig(userId, ws);
      config.connected = false;
      config.lastSync = 'Verification failed';
      await saveWhatsAppConfig(config, userId, ws);

      return NextResponse.json({ 
        ok: false, 
        action: 'verify', 
        verified: false,
        error: verification.error 
      }, { status: 400 });
    }
  }

  if (action === 'qr-session') {
    const targetPhone = cleanWhatsAppPhone(body.phone || body.to || '');
    const targetText = (body.text || '').trim();
    const waMeUrl = buildWaMeUrl(targetPhone, targetText);
    const webUrl = buildWhatsAppWebUrl(targetPhone, targetText);
    const sessionId = `WA-QR-${Date.now().toString(36).toUpperCase()}`;
    const qrPayload = targetPhone ? waMeUrl : webUrl;
    const qrSvg = renderQrSvg(qrPayload);
    const qrDataUrl = renderQrDataUrl(qrPayload);
    return NextResponse.json({
      ok: true,
      action: 'qr-session',
      sessionId,
      qrPayload,
      qrSvg,
      qrDataUrl,
      webUrl,
      waMeUrl,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  }

  if (action === 'pair-qr') {
    const phoneDigits = cleanWhatsAppPhone(body.phone || '');
    const displayPhone = phoneDigits ? `+${phoneDigits}` : (body.phone?.trim() || 'Linked WhatsApp Web');
    const pairedDevice = (body.pairedDevice || 'WhatsApp Web (QR Linked)').trim().slice(0, 80);
    const bridgeUrl = (body.bridgeUrl || '').trim().slice(0, 200);
    if (bridgeUrl) {
      try {
        await assertPublicUrl(bridgeUrl);
      } catch {
        return NextResponse.json(
          { ok: false, error: 'Bridge URL must be a public https address (internal/private network addresses are blocked).' },
          { status: 400 },
        );
      }
    }
    const nowLabel = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const nextConfig: WhatsAppConfig = {
      connected: true,
      phone: displayPhone,
      waId: `WA-QR-${phoneDigits.slice(-6) || 'WEB'}`,
      lastSync: nowLabel,
      mode: 'qr-web',
      pairedDevice,
      bridgeUrl: bridgeUrl || undefined,
    };
    await saveWhatsAppConfig(nextConfig, userId, ws);
    return NextResponse.json({
      ok: true,
      action: 'pair-qr',
      config: nextConfig,
      webUrl: buildWhatsAppWebUrl(phoneDigits),
      waMeUrl: buildWaMeUrl(phoneDigits),
    });
  }

  if (action === 'disconnect') {
    const resetConfig: WhatsAppConfig = {
      connected: false,
      phone: '',
      waId: '',
      lastSync: 'Disconnected',
      mode: undefined,
      bridgeUrl: undefined,
      pairedDevice: undefined,
    };
    await saveWhatsAppConfig(resetConfig, userId, ws);
    return NextResponse.json({ ok: true, action: 'disconnect', config: resetConfig });
  }

  if (action === 'status') {
    const config = await loadWhatsAppConfig(userId, ws);
    const credentials = await getWhatsAppCredentials(userId, ws);
    
    return NextResponse.json({ 
      ok: true, 
      action: 'status', 
      config: {
        connected: config.connected,
        phone: config.phone,
        waId: config.waId,
        lastSync: config.lastSync,
        mode: config.mode,
        bridgeUrl: config.bridgeUrl,
        pairedDevice: config.pairedDevice,
        hasCredentials: !!credentials,
      }
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const ws = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  const off = await featureGate('whatsapp', userId, ws);
  if (off) return off;
  const config = await loadWhatsAppConfig(userId, ws);
  const credentials = await getWhatsAppCredentials(userId, ws);
  
  return NextResponse.json({ 
    ok: true, 
    config: {
      connected: config.connected,
      phone: config.phone,
      waId: config.waId,
      lastSync: config.lastSync,
      mode: config.mode,
      bridgeUrl: config.bridgeUrl,
      pairedDevice: config.pairedDevice,
      hasCredentials: !!credentials,
    }
  });
}
