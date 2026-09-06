import { NextResponse } from 'next/server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { type Webhook } from '@/lib/borga/data';

export const runtime = 'nodejs';

interface WebhookDelivery {
  webhookId: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttempt: string;
  nextAttempt?: string;
  error?: string;
  responseStatus?: number;
}

interface WebhookQueue {
  deliveries: WebhookDelivery[];
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

// Generate HMAC signature for webhook security
async function generateSignature(payload: string, secret: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Validate webhook URL format
function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !isInternalUrl(parsed.hostname);
  } catch {
    return false;
  }
}

function isInternalUrl(hostname: string): boolean {
  const internalPatterns = [
    /^localhost$/i,
    /^127\./,
    /^0\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^::1$/,
    /\.local$/i,
  ];
  return internalPatterns.some(pattern => pattern.test(hostname));
}

// Load webhook delivery queue
async function loadQueue(): Promise<WebhookQueue> {
  const queue = await getBorgaState<WebhookQueue>('webhook_queue');
  return queue || { deliveries: [] };
}

// Save webhook delivery queue
async function saveQueue(queue: WebhookQueue): Promise<boolean> {
  return setBorgaState('webhook_queue', queue);
}

// Load configured webhooks
async function loadWebhooks(): Promise<Webhook[]> {
  const webhooks = await getBorgaState<Webhook[]>('webhooks');
  return webhooks || [];
}

// Execute single webhook delivery
async function deliverWebhook(
  webhook: Webhook,
  delivery: WebhookDelivery
): Promise<{ success: boolean; status?: number; error?: string }> {
  try {
    const payload = JSON.stringify(delivery.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Borga-Webhook/1.0',
      'X-Borga-Event': delivery.eventId,
      'X-Borga-Delivery-ID': delivery.webhookId + '-' + delivery.eventId,
      'X-Borga-Timestamp': new Date().toISOString(),
    };

    // Add signature if secret is configured
    if (webhook.secret && webhook.secret !== '———————…') {
      headers['X-Borga-Signature'] = `sha256=${generateSignature(payload, webhook.secret)}`;
    }

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(30000),
    });

    return {
      success: response.ok,
      status: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Process pending webhook deliveries
async function processQueue(): Promise<void> {
  const queue = await loadQueue();
  const webhooks = await loadWebhooks();
  const webhookMap = new Map(webhooks.map(w => [w.id, w]));

  const now = Date.now();
  let updated = false;

  for (const delivery of queue.deliveries) {
    if (delivery.status !== 'pending') continue;

    // Check if it's time to retry
    if (delivery.nextAttempt && new Date(delivery.nextAttempt).getTime() > now) {
      continue;
    }

    const webhook = webhookMap.get(delivery.webhookId);
    if (!webhook || !webhook.active) {
      // Mark as failed if webhook no longer exists or is inactive
      delivery.status = 'failed';
      delivery.error = 'Webhook not found or inactive';
      delivery.lastAttempt = new Date().toISOString();
      updated = true;
      continue;
    }

    // Attempt delivery
    const result = await deliverWebhook(webhook, delivery);
    delivery.attempts++;
    delivery.lastAttempt = new Date().toISOString();

    if (result.success) {
      delivery.status = 'delivered';
      delivery.responseStatus = result.status;
      delivery.error = undefined;
      delivery.nextAttempt = undefined;
      
      // Update webhook delivery count
      webhook.deliveries++;
      webhook.lastDelivery = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      
      // Save updated webhook
      const updatedWebhooks = webhooks.map(w => w.id === webhook.id ? webhook : w);
      await setBorgaState('webhooks', updatedWebhooks);
      
      console.log(`Webhook ${webhook.name} delivered successfully for event ${delivery.eventId}`);
    } else {
      delivery.error = result.error;
      delivery.responseStatus = result.status;

      if (delivery.attempts >= MAX_RETRIES) {
        delivery.status = 'failed';
        delivery.nextAttempt = undefined;
        console.error(`Webhook ${webhook.name} failed after ${MAX_RETRIES} attempts for event ${delivery.eventId}: ${result.error}`);
      } else {
        // Schedule next retry
        const delay = RETRY_DELAYS[Math.min(delivery.attempts, RETRY_DELAYS.length - 1)];
        delivery.nextAttempt = new Date(now + delay).toISOString();
        console.warn(`Webhook ${webhook.name} attempt ${delivery.attempts} failed for event ${delivery.eventId}, retrying in ${delay}ms: ${result.error}`);
      }
    }

    updated = true;
  }

  // Clean up old deliveries (older than 7 days)
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  queue.deliveries = queue.deliveries.filter(d => 
    d.status === 'pending' || d.lastAttempt > weekAgo
  );

  if (updated) {
    await saveQueue(queue);
  }
}

// Queue webhook for delivery
async function queueWebhook(webhookId: string, eventId: string, payload: Record<string, unknown>): Promise<void> {
  const queue = await loadQueue();
  
  const delivery: WebhookDelivery = {
    webhookId,
    eventId,
    payload,
    status: 'pending',
    attempts: 0,
    lastAttempt: new Date().toISOString(),
    nextAttempt: new Date().toISOString(), // Deliver immediately
  };

  queue.deliveries.push(delivery);
  await saveQueue(queue);
  
  // Trigger processing
  setImmediate(() => processQueue());
}

export async function POST(req: Request) {
  let body: { action?: string; webhookId?: string; eventId?: string; payload?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const action = body.action ?? 'dispatch';

  if (action === 'dispatch') {
    const { webhookId, eventId, payload } = body;
    
    if (!webhookId || !eventId || !payload) {
      return NextResponse.json({ 
        ok: false, 
        error: 'webhookId, eventId, and payload are required for dispatch action.' 
      }, { status: 400 });
    }

    const webhooks = await loadWebhooks();
    const webhook = webhooks.find(w => w.id === webhookId);
    
    if (!webhook) {
      return NextResponse.json({ ok: false, error: 'Webhook not found.' }, { status: 404 });
    }

    if (!webhook.active) {
      return NextResponse.json({ ok: false, error: 'Webhook is inactive.' }, { status: 400 });
    }

    if (!isValidWebhookUrl(webhook.url)) {
      return NextResponse.json({ ok: false, error: 'Invalid webhook URL.' }, { status: 400 });
    }

    try {
      await queueWebhook(webhookId, eventId, payload);
      return NextResponse.json({ 
        ok: true, 
        action: 'dispatch', 
        message: 'Webhook queued for delivery.' 
      });
    } catch (error) {
      console.error('Failed to queue webhook:', error);
      return NextResponse.json({ 
        ok: false, 
        error: 'Failed to queue webhook for delivery.' 
      }, { status: 500 });
    }
  }

  if (action === 'process') {
    // Manual trigger to process queue
    try {
      await processQueue();
      return NextResponse.json({ ok: true, action: 'process', message: 'Queue processed.' });
    } catch (error) {
      console.error('Failed to process queue:', error);
      return NextResponse.json({ ok: false, error: 'Failed to process queue.' }, { status: 500 });
    }
  }

  if (action === 'status') {
    const queue = await loadQueue();
    const pending = queue.deliveries.filter(d => d.status === 'pending').length;
    const failed = queue.deliveries.filter(d => d.status === 'failed').length;
    const delivered = queue.deliveries.filter(d => d.status === 'delivered').length;

    return NextResponse.json({
      ok: true,
      action: 'status',
      queue: {
        total: queue.deliveries.length,
        pending,
        failed,
        delivered,
      },
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

// Background processing endpoint (called by cron or similar)
export async function GET() {
  try {
    await processQueue();
    return NextResponse.json({ ok: true, message: 'Webhook queue processed.' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ ok: false, error: 'Webhook processing failed.' }, { status: 500 });
  }
}