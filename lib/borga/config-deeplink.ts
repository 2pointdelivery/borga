import type { PageId } from '@/components/borga/nav';
import type { ProviderId } from './providers';

/**
 * Configuration Deep-Link Registry & Auto-Scroll/Highlight Dispatcher.
 *
 * Maps every configurable subsystem (Email/SMTP, Gmail, Twilio, WhatsApp, Meta,
 * Google Ads, ElevenLabs, Deepgram, Fish Audio, AI Providers, Supermemory,
 * Explee, Composio, Push, Voice, Features) to its exact `{ page, tab, sectionId }`
 * destination so users are sent directly to the right configuration card.
 */

export type ConfigTargetId =
  | 'smtp'
  | 'gmail'
  | 'twilio'
  | 'whatsapp'
  | 'stripe'
  | 'meta'
  | 'google_ads'
  | 'chatgpt_ads'
  | 'elevenlabs'
  | 'deepgram'
  | 'fishaudio'
  | 'supermemory'
  | 'explee'
  | 'ai-providers'
  | 'composio'
  | 'email-updates'
  | 'voice-settings'
  | 'push-settings'
  | 'features';

export interface ConfigDeepLink {
  id: ConfigTargetId;
  page: PageId;
  tab?: string;
  sectionId: string;
  label: string;
}

export const CONFIG_DEEP_LINKS: Record<ConfigTargetId, ConfigDeepLink> = {
  smtp: {
    id: 'smtp',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-smtp',
    label: 'Configure Email (SMTP)',
  },
  gmail: {
    id: 'gmail',
    page: 'integrations',
    tab: 'connected',
    sectionId: 'config-email-section',
    label: 'Connect Gmail / Email',
  },
  twilio: {
    id: 'twilio',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-twilio',
    label: 'Configure Twilio (SMS & Calls)',
  },
  whatsapp: {
    id: 'whatsapp',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-whatsapp',
    label: 'Configure WhatsApp API',
  },
  stripe: {
    id: 'stripe',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-stripe',
    label: 'Configure Stripe',
  },
  meta: {
    id: 'meta',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-meta',
    label: 'Configure Meta Ads',
  },
  google_ads: {
    id: 'google_ads',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-google_ads',
    label: 'Configure Google Ads',
  },
  chatgpt_ads: {
    id: 'chatgpt_ads',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-chatgpt_ads',
    label: 'Configure ChatGPT Ads',
  },
  elevenlabs: {
    id: 'elevenlabs',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-elevenlabs',
    label: 'Configure ElevenLabs Voice',
  },
  deepgram: {
    id: 'deepgram',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-deepgram',
    label: 'Configure Deepgram STT',
  },
  fishaudio: {
    id: 'fishaudio',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-fishaudio',
    label: 'Configure Fish Audio',
  },
  supermemory: {
    id: 'supermemory',
    page: 'integrations',
    tab: 'ai-providers',
    sectionId: 'config-supermemory',
    label: 'Configure Supermemory',
  },
  explee: {
    id: 'explee',
    page: 'integrations',
    tab: 'connections',
    sectionId: 'config-provider-explee',
    label: 'Configure Explee (outreach hot leads)',
  },
  'ai-providers': {
    id: 'ai-providers',
    page: 'integrations',
    tab: 'ai-providers',
    sectionId: 'config-ai-providers',
    label: 'Configure AI & Voice',
  },
  composio: {
    id: 'composio',
    page: 'integrations',
    tab: 'toolkits',
    sectionId: 'config-composio',
    label: 'Configure Composio Toolkits',
  },
  'email-updates': {
    id: 'email-updates',
    page: 'settings',
    sectionId: 'config-email-updates',
    label: 'Configure Email Updates',
  },
  'voice-settings': {
    id: 'voice-settings',
    page: 'settings',
    sectionId: 'config-voice-settings',
    label: 'Configure Voice Assistant',
  },
  'push-settings': {
    id: 'push-settings',
    page: 'settings',
    sectionId: 'config-push-settings',
    label: 'Configure Push Notifications',
  },
  features: {
    id: 'features',
    page: 'settings',
    sectionId: 'config-features',
    label: 'Enable in Settings → Features',
  },
};

export function configTargetForProvider(providerId: ProviderId | ConfigTargetId): ConfigDeepLink {
  return CONFIG_DEEP_LINKS[providerId as ConfigTargetId] ?? CONFIG_DEEP_LINKS.smtp;
}

/**
 * Inspects an error/warning message (e.g., from a toast or delivery banner) and
 * returns the matching configuration deep-link when the message indicates a
 * missing or unconfigured service.
 */
export function detectConfigTargetFromText(text: string | undefined | null): ConfigDeepLink | null {
  const s = String(text ?? '').toLowerCase();
  if (!s) return null;

  const mentionsUnconfigured =
    s.includes('not configured') ||
    s.includes('not set up') ||
    s.includes('configure ') ||
    s.includes('no mail server') ||
    s.includes('not connected') ||
    s.includes('add your') ||
    s.includes('add its') ||
    s.includes('no key') ||
    s.includes('switched off') ||
    s.includes('integrations →') ||
    s.includes('settings →');

  if (!mentionsUnconfigured) return null;

  if (s.includes('smtp') || s.includes('mail server') || s.includes('outgoing email') || s.includes('deliver replies')) {
    return CONFIG_DEEP_LINKS.smtp;
  }
  if (s.includes('gmail')) {
    return CONFIG_DEEP_LINKS.gmail;
  }
  if (s.includes('whatsapp')) {
    return CONFIG_DEEP_LINKS.whatsapp;
  }
  if (s.includes('twilio') || s.includes('sms')) {
    return CONFIG_DEEP_LINKS.twilio;
  }
  if (s.includes('elevenlabs')) {
    return CONFIG_DEEP_LINKS.elevenlabs;
  }
  if (s.includes('deepgram')) {
    return CONFIG_DEEP_LINKS.deepgram;
  }
  if (s.includes('fish audio') || s.includes('fishaudio')) {
    return CONFIG_DEEP_LINKS.fishaudio;
  }
  if (s.includes('composio') || s.includes('plaid') || s.includes('social account')) {
    return CONFIG_DEEP_LINKS.composio;
  }
  if (s.includes('supermemory')) {
    return CONFIG_DEEP_LINKS.supermemory;
  }
  if (s.includes('explee')) {
    return CONFIG_DEEP_LINKS.explee;
  }
  if (s.includes('ai & voice') || s.includes('ai provider') || s.includes('no key') || s.includes('muse')) {
    return CONFIG_DEEP_LINKS['ai-providers'];
  }
  if (s.includes('vapid') || s.includes('server push') || s.includes('push is not configured')) {
    return CONFIG_DEEP_LINKS['push-settings'];
  }
  if (s.includes('email updates')) {
    return CONFIG_DEEP_LINKS['email-updates'];
  }
  if (s.includes('settings → features') || s.includes('switched off')) {
    return CONFIG_DEEP_LINKS.features;
  }
  return null;
}

/**
 * Navigates to the target page/tab and scrolls + highlights the target configuration card.
 */
export function openConfigDeepLink(targetOrId: ConfigTargetId | ConfigDeepLink): void {
  if (typeof window === 'undefined') return;
  const target = typeof targetOrId === 'string' ? CONFIG_DEEP_LINKS[targetOrId] : targetOrId;
  if (!target) return;

  window.dispatchEvent(
    new CustomEvent('borga:nav', {
      detail: {
        page: target.page,
        tab: target.tab,
        sectionId: target.sectionId,
      },
    }),
  );

  const tryFocusCard = (attempt: number) => {
    const el = document.getElementById(target.sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('borga-config-highlight');
      // Force reflow so repeated clicks re-trigger the highlight animation
      void el.offsetWidth;
      el.classList.add('borga-config-highlight');
      const firstInput = el.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      if (firstInput) {
        window.setTimeout(() => firstInput.focus({ preventScroll: true }), 220);
      }
      window.setTimeout(() => {
        el.classList.remove('borga-config-highlight');
      }, 2800);
      return;
    }
    if (attempt < 8) {
      window.setTimeout(() => tryFocusCard(attempt + 1), 120);
    }
  };

  window.setTimeout(() => tryFocusCard(0), 90);
}
