/*
 * Stamps the service worker with a build id and copies it into dist/.
 *
 * The id is a hash of the emitted assets, so a deploy that changes nothing keeps
 * the same cache (no pointless re-download) and any real change invalidates the
 * whole shell at once — never a mix of old and new chunks, which is how a
 * partially-updated SPA ends up throwing module-resolution errors at users.
 *
 * Run after `vite build`.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST).filter((f) => !f.endsWith('sw.js')).sort();
const hash = createHash('sha256');
for (const file of files) {
  hash.update(file);
  hash.update(readFileSync(file));
}
const buildId = hash.digest('hex').slice(0, 12);

const source = readFileSync(join(DIST, 'sw.js'), 'utf8');
if (!source.includes('__BUILD_ID__')) {
  console.error('sw.js has no __BUILD_ID__ placeholder — refusing to ship an unversioned cache.');
  process.exit(1);
}
writeFileSync(join(DIST, 'sw.js'), source.replaceAll('__BUILD_ID__', buildId));
console.log(`✓ Service worker stamped with build ${buildId} (${files.length} assets)`);
