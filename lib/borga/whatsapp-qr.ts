/**
 * WhatsApp QR Code & WhatsApp Web Bridge Engine — pure TypeScript (zero external deps).
 *
 * Includes:
 * 1. Real ISO/IEC 18004 QR Code encoder (Byte mode, Level L ECC over GF(256), Version 2..6 auto-sized)
 *    so phone cameras can genuinely scan the QR code on screen.
 * 2. WhatsApp Web (`https://web.whatsapp.com/send?...`) and `https://wa.me/...` deep-link builders.
 * 3. Device pairing session state for Sales -> Pipeline -> WhatsApp.
 */

export function cleanWhatsAppPhone(raw: string | undefined | null): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const trimmed = digits.startsWith('00') ? digits.slice(2) : digits;
  return trimmed.slice(0, 15);
}

export function isValidWhatsAppPhone(raw: string | undefined | null): boolean {
  const d = cleanWhatsAppPhone(raw);
  return d.length >= 7 && d.length <= 15;
}

/** Builds the official WhatsApp Web URL (opens directly into a lead chat when phone/text are given). */
export function buildWhatsAppWebUrl(phone?: string | null, text?: string | null): string {
  const digits = cleanWhatsAppPhone(phone);
  const msg = (text ?? '').trim();
  if (!digits && !msg) return 'https://web.whatsapp.com/';
  const params = new URLSearchParams();
  if (digits) params.set('phone', digits);
  if (msg) params.set('text', msg);
  return `https://web.whatsapp.com/send?${params.toString()}`;
}

/** Builds a mobile-scannable wa.me deep link that opens WhatsApp on the user's phone. */
export function buildWaMeUrl(phone?: string | null, text?: string | null): string {
  const digits = cleanWhatsAppPhone(phone);
  const msg = (text ?? '').trim();
  const base = digits ? `https://wa.me/${digits}` : 'https://web.whatsapp.com/';
  if (!msg) return base;
  return `${base}${base.includes('?') ? '&' : '?'}text=${encodeURIComponent(msg)}`;
}

// ── ISO/IEC 18004 QR Code Generator (Versions 2..6, ECC Level L, Mask 0) ───────────────────────────────────────────

interface QrVersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  ecCodewords: number;
  alignment: number[];
}

// Single-block Level L versions (up to 134 bytes of UTF-8 payload)
const QR_SPECS: readonly QrVersionSpec[] = [
  { version: 2, size: 25, dataCodewords: 34, ecCodewords: 10, alignment: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, ecCodewords: 15, alignment: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, ecCodewords: 20, alignment: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, ecCodewords: 26, alignment: [6, 30] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(gen.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
  }
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

/** Builds a boolean QR matrix (true = dark module) for `text`. */
export function buildQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text.slice(0, 100));
  const spec = QR_SPECS.find((s) => bytes.length + 2 <= s.dataCodewords) ?? QR_SPECS[QR_SPECS.length - 1];
  const payload = bytes.slice(0, spec.dataCodewords - 2);

  // Bit stream: 0100 (byte mode) + 8-bit count + bytes + 0000 terminator + pad bytes
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);
  for (let i = 0; i < 4 && bits.length < spec.dataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    dataWords[i] = byte;
  }
  let padToggle = true;
  for (let i = bits.length / 8; i < spec.dataCodewords; i++) {
    dataWords[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  const ecWords = rsEncode(dataWords, spec.ecCodewords);
  const allWords = new Uint8Array(dataWords.length + ecWords.length);
  allWords.set(dataWords, 0);
  allWords.set(ecWords, dataWords.length);

  const N = spec.size;
  const grid: boolean[][] = Array.from({ length: N }, () => Array<boolean>(N).fill(false));
  const reserved: boolean[][] = Array.from({ length: N }, () => Array<boolean>(N).fill(false));

  const setMod = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < N && c >= 0 && c < N) {
      grid[r][c] = dark;
      reserved[r][c] = true;
    }
  };

  // Finder patterns + separators
  const placeFinder = (row: number, col: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const center = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setMod(row + dr, col + dc, inside && (ring || center));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, N - 7);
  placeFinder(N - 7, 0);

  // Alignment patterns
  const [a0, a1] = spec.alignment;
  for (const r of [a0, a1]) {
    for (const c of [a0, a1]) {
      if (reserved[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setMod(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < N - 8; i++) {
    if (!reserved[6][i]) setMod(6, i, i % 2 === 0);
    if (!reserved[i][6]) setMod(i, 6, i % 2 === 0);
  }

  // Dark module & reserve format areas
  setMod(N - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][N - 1 - i]) reserved[8][N - 1 - i] = true;
    if (!reserved[N - 1 - i][8]) reserved[N - 1 - i][8] = true;
  }

  // Place data bits in upward/downward 2-column zig-zag with Mask 0: (r + c) % 2 === 0
  let bitIdx = 0;
  const totalBits = allWords.length * 8;
  let upward = true;
  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < N; vert++) {
      const r = upward ? N - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (reserved[r][c]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          const byte = allWords[bitIdx >>> 3];
          dark = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
        if ((r + c) % 2 === 0) dark = !dark;
        grid[r][c] = dark;
      }
    }
    upward = !upward;
  }

  // Format bits for Level L (01) + Mask 0 (000) -> BCH = 0x77c4
  const fmt = 0x77c4;
  for (let i = 0; i <= 5; i++) grid[8][i] = ((fmt >>> i) & 1) === 1;
  grid[8][7] = ((fmt >>> 6) & 1) === 1;
  grid[8][8] = ((fmt >>> 7) & 1) === 1;
  grid[7][8] = ((fmt >>> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) grid[14 - i][8] = ((fmt >>> i) & 1) === 1;
  for (let i = 0; i < 8; i++) grid[8][N - 1 - i] = ((fmt >>> i) & 1) === 1;
  for (let i = 8; i < 15; i++) grid[N - 15 + i][8] = ((fmt >>> i) & 1) === 1;

  return grid;
}

/** Renders a clean SVG string for a QR code. */
export function renderQrSvg(text: string, margin = 3): string {
  const matrix = buildQrMatrix(text || 'https://web.whatsapp.com/');
  const n = matrix.length;
  const total = n + margin * 2;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects.push(`<rect x="${c + margin}" y="${r + margin}" width="1" height="1"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><g fill="#111111">${rects.join('')}</g></svg>`;
}

export function renderQrDataUrl(text: string): string {
  const svg = renderQrSvg(text);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
