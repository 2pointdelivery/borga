// Build-time helper: packages the Borga product source into public/borga-product.zip.
// Sensitive files (.env) and heavy/build dirs are intentionally excluded.
import { createWriteStream, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ZipArchive } from 'archiver';

const root = process.cwd();
const outPath = join(root, 'public', 'borga-product.zip');

const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', '.git', '.open-next', '.wrangler', '.vercel',
  '.vscode', '.idea', 'dist', 'build', 'coverage', 'remote-control',
  'attachements',
]);

const EXCLUDE_FILES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'borga-product.zip',
]);

const EXCLUDE_EXT = new Set(['.zip', '.tsbuildinfo']);

function shouldSkip(name) {
  return (
    EXCLUDE_FILES.has(name) ||
    EXCLUDE_EXT.has(name.split('.').pop()) ||
    name.endsWith('.tsbuildinfo') ||
    name.endsWith('.pem')
  );
}

function walk(dir, archive, baseDir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name) || shouldSkip(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relative(baseDir, full).split(sep).join('/');
    if (entry.isDirectory()) {
      walk(full, archive, baseDir);
    } else {
      archive.file(full, { name: rel });
    }
  }
}

export function makeZip() {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = createWriteStream(outPath);
  return new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    walk(root, archive, root);
    archive.finalize();
  });
}

if (process.argv[1] && process.argv[1].endsWith('make-zip.mjs')) {
  makeZip().then(() => {
    const size = (statSync(outPath).size / 1024 / 1024).toFixed(2);
    console.log(`Built ${outPath} (${size} MB)`);
  });
}
