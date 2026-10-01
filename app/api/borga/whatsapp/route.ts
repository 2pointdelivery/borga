import { NextResponse } from 'next/server';
import { getApiKey, setApiKey, isAllowedKey } from '@/lib/borga/secrets';
import { getBorgaState, setBorgaState, scopedKey } from '@/lib/borga/persistence';
import { type WhatsAppConfig } from '@/lib/borga/data';
import { featureGate } from '@/lib/borga/features-server';

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

// Load WhatsApp configuration (workspace-scoped)
async function loadWhatsAppConfig(ws?: string | null): Promise<WhatsAppConfig> {
  const config = await getBorgaState<WhatsAppConfig>(scopedKey(ws, 'whatsapp'));
  return config || { connected: false, phone: '', waId: '', lastSync: '…' };
}

// Save WhatsApp configuration
async function saveWhatsAppConfig(config: WhatsAppConfig, ws?: string | null): Promise<boolean> {
  return setBorgaState(scopedKey(ws, 'whatsapp'), config);
}

// Get WhatsApp API credentials
async function getWhatsAppCredentials(): Promise<{ accessToken: string; phoneNumberId: string; businessAccountId: string } | null> {
  const accessToken = await getApiKey('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';

  if (!accessToken || !phoneNumberId) {
    return null;
  }

  return { accessToken, phoneNumberId, businessAccountId };
}

// Send WhatsApp message
async function sendWhatsAppMessage(message: WhatsAppMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const credentials = await getWhatsAppCredentials();
  if (!credentials) {
    return { success: false, error: 'WhatsApp credentials not configured' };
  }

  const { accessToken, phoneNumberId } = await credentials;

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
      
      try {
        const errorData = JSON.parse(errorText);
        return { 
          success: false, 
          error: errorData.error?.message || `WhatsApp API error: ${response.status}` 
        };
      } catch {
        return { success: false, error: `WhatsApp API error: ${response.status}` };
      }
    }

    const data = await response.json() as WhatsAppApiResponse;
    const messageId = data.messages?.[0]?.id;

    return { success: true, messageId };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Verify WhatsApp business number
async function verifyWhatsAppNumber(): Promise<{ verified: boolean; phone?: string; error?: string }> {
  const credentials = await getWhatsAppCredentials();
  if (!credentials) {
    return { verified: false, error: 'WhatsApp credentials not configured' };
  }

  const { accessToken, phoneNumberId } = await credentials;

  try {
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { verified: false, error: `Failed to verify phone number: ${response.status}` };
    }

    const data = await response.json();
    const phone = data.display_phone_number || data.phone_number;

    return { verified: true, phone };
  } catch (error) {
    console.error('WhatsApp verification error:', error);
    return { 
      verified: false, 
      error: error instanceof Error ? error.message : 'Verification failed' 
    };
  }
}

export async function POST(req: Request) {
  const off = await featureGate('whatsapp', null, null);
  if (off) return off;
  let body: {
    action?: string;
    to?: string;
    text?: string;
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

  if (action === 'configure') {
    const { accessToken, persistKey } = body;
    
    if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 20) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Valid WhatsApp access token is required.' 
      }, { status: 400 });
    }

    // Persist the access token if requested
    if (persistKey && isAllowedKey('WHATSAPP_ACCESS_TOKEN')) {
      await setApiKey('WHATSAPP_ACCESS_TOKEN', accessToken.trim());
    }

    // Verify the configuration
    const verification = await verifyWhatsAppNumber();
    
    if (verification.verified) {
      const config = await loadWhatsAppConfig(ws);
      config.connected = true;
      config.phone = verification.phone || '';
      config.waId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
      config.lastSync = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      await saveWhatsAppConfig(config, ws);

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

    const config = await loadWhatsAppConfig(ws);
    if (!config.connected) {
      return NextResponse.json({ 
        ok: false, 
        error: 'WhatsApp is not configured. Please configure it first.' 
      }, { status: 400 });
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

    const result = await sendWhatsAppMessage(message);

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
    const verification = await verifyWhatsAppNumber();
    
    if (verification.verified) {
      const config = await loadWhatsAppConfig(ws);
      config.connected = true;
      config.phone = verification.phone || '';
      config.lastSync = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      await saveWhatsAppConfig(config, ws);

      return NextResponse.json({ 
        ok: true, 
        action: 'verify', 
        verified: true,
        phone: verification.phone 
      });
    } else {
      // Mark as disconnected if verification fails
      const config = await loadWhatsAppConfig(ws);
      config.connected = false;
      config.lastSync = 'Verification failed';
      await saveWhatsAppConfig(config, ws);

      return NextResponse.json({ 
        ok: false, 
        action: 'verify', 
        verified: false,
        error: verification.error 
      }, { status: 400 });
    }
  }

  if (action === 'status') {
    const config = await loadWhatsAppConfig(ws);
    const credentials = await getWhatsAppCredentials();
    
    return NextResponse.json({ 
      ok: true, 
      action: 'status', 
      config: {
        connected: config.connected,
        phone: config.phone,
        lastSync: config.lastSync,
        hasCredentials: !!credentials,
      }
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

export async function GET(req: Request) {
  const off = await featureGate('whatsapp', null, null);
  if (off) return off;
  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const ws = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  const config = await loadWhatsAppConfig(ws);
  const credentials = await getWhatsAppCredentials();
  
  return NextResponse.json({ 
    ok: true, 
    config: {
      connected: config.connected,
      phone: config.phone,
      lastSync: config.lastSync,
      hasCredentials: !!credentials,
    }
  });
}
