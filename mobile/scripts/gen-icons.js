// Generates store-size placeholder brand assets for Borga mobile.
// Dark #0B0F19 background + light-blue center mark. No external deps (zlib only).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function png(width, height, pixel) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const o = y * (stride + 1) + 1 + x * 4;
      const p = pixel(x, y, width, height);
      raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; ihdr[17] = 6; ihdr[18] = 0; ihdr[19] = 0; ihdr[20] = 0;
  const idat = zlib.deflateSync(raw);
  const idatChunk = Buffer.alloc(8 + idat.length);
  idatChunk.writeUInt32BE(idat.length, 0); idatChunk.write('IDAT', 4); idat.copy(idatChunk, 8);
  const crc = (buf, s, e) => {
    let c = ~0;
    for (let i = s; i < e; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const mk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cs = Buffer.alloc(4); cs.writeUInt32BE(crc(td, 0, td.length), 0);
    return Buffer.concat([len, td, cs]);
  };
  const iend = mk('IEND', Buffer.alloc(0));
  // 13 data bytes only (mk() adds length + type + crc itself)
  const ihdrData = ihdr.slice(8, 21);
  return Buffer.concat([sig, mk('IHDR', ihdrData), mk('IDAT', idat), iend]);
}

// Brand: bg #0B0F19, mark #60A5FA rounded-square ring in center.
function brand(x, y, w, h) {
  const cx = w / 2, cy = h / 2, s = Math.min(w, h);
  const r = s * 0.30;
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
  const inOuter = dx < r && dy < r;
  const inInner = dx < r * 0.55 && dy < r * 0.55;
  if (inOuter && !inInner) return [96, 165, 250];
  // center dot
  if (dx < r * 0.18 && dy < r * 0.18) return [96, 165, 250];
  return [11, 15, 25];
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'icon.png'), png(1024, 1024, brand));
fs.writeFileSync(path.join(dir, 'adaptive-icon.png'), png(1024, 1024, brand));
fs.writeFileSync(path.join(dir, 'splash.png'), png(1284, 2778, brand));
console.log('brand assets written');
