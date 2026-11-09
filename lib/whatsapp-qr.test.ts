import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQrMatrix,
  buildWaMeUrl,
  buildWhatsAppWebUrl,
  cleanWhatsAppPhone,
  isValidWhatsAppPhone,
  renderQrDataUrl,
  renderQrSvg,
} from './borga/whatsapp-qr';

test('cleanWhatsAppPhone and isValidWhatsAppPhone normalize international numbers', () => {
  assert.equal(cleanWhatsAppPhone('+1 (555) 234-5678'), '15552345678');
  assert.equal(cleanWhatsAppPhone('00233 20 111 2222'), '233201112222');
  assert.equal(isValidWhatsAppPhone('+1 555 234 5678'), true);
  assert.equal(isValidWhatsAppPhone('123'), false);
});

test('buildWhatsAppWebUrl and buildWaMeUrl build valid deep links with phone and text', () => {
  assert.equal(buildWhatsAppWebUrl(), 'https://web.whatsapp.com/');
  assert.equal(
    buildWhatsAppWebUrl('+1 (555) 234-5678', 'Hi Ama'),
    'https://web.whatsapp.com/send?phone=15552345678&text=Hi+Ama',
  );
  assert.equal(
    buildWaMeUrl('+233 20 111 2222', 'Following up'),
    'https://wa.me/233201112222?text=Following%20up',
  );
});

test('buildQrMatrix and renderQrSvg produce valid ISO 18004 finder patterns and SVG output', () => {
  const m = buildQrMatrix('https://wa.me/15552345678?text=Hello');
  assert.ok(m.length >= 25 && m.length <= 37);
  // Top-left, top-right, and bottom-left finder corners are dark
  assert.equal(m[0][0], true);
  assert.equal(m[0][6], true);
  assert.equal(m[6][0], true);
  assert.equal(m[3][3], true);
  assert.equal(m[0][m.length - 1], true);
  assert.equal(m[m.length - 1][0], true);

  const svg = renderQrSvg('https://web.whatsapp.com/');
  assert.ok(svg.startsWith('<svg') && svg.includes('<rect'));
  const dataUrl = renderQrDataUrl('https://web.whatsapp.com/');
  assert.ok(dataUrl.startsWith('data:image/svg+xml;utf8,'));
});
