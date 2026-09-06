// Scans source for classic double-encoded UTF-8 (cp1252 -> UTF-8) artifacts.
// Detection is byte-level so this file stays pure ASCII and stays effective.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md']);
const SKIP = new Set(['node_modules', '.next', '.open-next', '.wrangler', 'out', 'build', '.data', '.git', 'scripts']);

// A mojibake sequence begins with the byte 0xE2 (a-hat in cp1252) which, when
// re-encoded as UTF-8, appears as the bytes C3 A2. We look for that marker in
// raw buffers (the give-away of corrupted multi-byte chars like em dash, curly
// quotes, middle dot, accented letters).
const MARKER = Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac]); // UTF-8 for the classic mojibake prefix (a-circ / euro)

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(full);
  }
}

function hasMarker(buf) {
  return buf.indexOf(MARKER) !== -1;
}

const files = [];
walk(ROOT, files);
let hits = 0;
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(f); } catch { continue; }
  if (hasMarker(buf)) {
    const rel = path.relative(ROOT, f);
    console.log(`${rel}: possible mojibake (double-encoded UTF-8) detected`);
    hits++;
  }
}
console.log(hits === 0 ? 'OK - no mojibake artifacts found.' : `\n${hits} file(s) with mojibake artifacts found.`);
