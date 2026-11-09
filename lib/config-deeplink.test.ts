import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_DEEP_LINKS,
  configTargetForProvider,
  detectConfigTargetFromText,
} from './borga/config-deeplink';

test('configTargetForProvider maps every connection provider to its Integrations card', () => {
  assert.equal(configTargetForProvider('smtp').sectionId, 'config-provider-smtp');
  assert.equal(configTargetForProvider('twilio').sectionId, 'config-provider-twilio');
  assert.equal(configTargetForProvider('whatsapp').sectionId, 'config-provider-whatsapp');
  assert.equal(configTargetForProvider('elevenlabs').sectionId, 'config-provider-elevenlabs');
  assert.equal(configTargetForProvider('explee').sectionId, 'config-provider-explee');
});

test('detectConfigTargetFromText resolves unconfigured warnings to their exact deep-link target', () => {
  assert.equal(
    detectConfigTargetFromText('Saved, but not emailed — SMTP is not configured.')?.id,
    'smtp',
  );
  assert.equal(
    detectConfigTargetFromText('Configure SMTP to deliver replies.')?.id,
    'smtp',
  );
  assert.equal(
    detectConfigTargetFromText('WhatsApp is not configured — add a WhatsApp access token in Integrations.')?.id,
    'whatsapp',
  );
  assert.equal(
    detectConfigTargetFromText('Could not reach the AI provider — check Integrations → AI & Voice.')?.id,
    'ai-providers',
  );
  assert.equal(
    detectConfigTargetFromText('Add your Composio API key under Integrations → Composio Toolkits')?.id,
    'composio',
  );
  assert.equal(
    detectConfigTargetFromText('All marketing features are switched off — enable them under Settings → Features.')?.id,
    'features',
  );
  // Normal messages that do not mention missing configuration return null
  assert.equal(detectConfigTargetFromText('Invoice #1042 marked as paid.'), null);
  assert.ok(Object.keys(CONFIG_DEEP_LINKS).length >= 15);
});
