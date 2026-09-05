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
import { join, sep } from 'node:path';

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

// Everything under /assets is hashed and immutable, so it is safe to precache.
// Without this the first online visit leaves the cache incomplete — the page's
// own scripts are requested before the worker claims the client — and offline
// reopen needs a second visit to work.
const precache = files
  .map((f) => '/' + f.slice(DIST.length + 1).split(sep).join('/'))
  .filter((p) => p.startsWith('/assets/'));

const source = readFileSync(join(DIST, 'sw.js'), 'utf8');
for (const token of ['__BUILD_ID__', '__PRECACHE__']) {
  if (!source.includes(token)) {
    console.error(`sw.js has no ${token} placeholder — refusing to ship a broken worker.`);
    process.exit(1);
  }
}
const stamped = source
  .replaceAll('__BUILD_ID__', buildId)
  .replaceAll('__PRECACHE__', JSON.stringify(precache));

// Post-condition. An unsubstituted placeholder is a ReferenceError on install,
// which kills the worker silently and takes offline support with it — and it is
// invisible in every test, because the tests never load sw.js. Caught here once,
// after a stray mention of the token in a comment ate the substitution.
const leftover = ['__BUILD_ID__', '__PRECACHE__'].filter((t) => stamped.includes(t));
if (leftover.length) {
  console.error(`sw.js still contains ${leftover.join(', ')} after substitution.`);
  process.exit(1);
}
writeFileSync(join(DIST, 'sw.js'), stamped);
console.log(
  `✓ Service worker stamped with build ${buildId} (${precache.length} assets precached)`,
);
