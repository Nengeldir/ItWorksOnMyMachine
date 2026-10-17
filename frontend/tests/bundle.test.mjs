import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBundle, entryFiles } from '../scripts/bundle-check.mjs';

// The first load's size (plan F11): what races and the landing page fetch before anything lazy may
// grow by at most 2 kB gzipped per step (bundle-budget.json). Checked against the last build; skipped
// when there's none (npm run build runs the same check and fails on its own).

test('the entry and its static imports are the first load; dynamic imports are lazy', () => {
  const manifest = {
    'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_three.js'], css: ['assets/index.css'], dynamicImports: ['src/Lazy.tsx'] },
    '_three.js': { file: 'assets/three.js', imports: [] },
    'src/Lazy.tsx': { file: 'assets/Lazy.js', isDynamicEntry: true, imports: ['_three.js'] },
  };
  const { files, lazy } = entryFiles(manifest);
  assert.deepEqual(files.sort(), ['assets/index.css', 'assets/index.js', 'assets/three.js']);
  assert.deepEqual(lazy, ['assets/Lazy.js']);
});

test('the first load stays within its budget', (t) => {
  const result = checkBundle();
  if (!result) return t.skip('no build in dist/');
  assert.ok(result.ok, result.message);
  assert.ok(result.files.some((file) => file.endsWith('.js')));
});
