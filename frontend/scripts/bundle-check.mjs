// The first load's size check (plan F11): sums the gzipped size of what the landing page and the races
// need before anything lazy (the entry chunk, its static imports and their CSS, from Vite's manifest)
// and compares it with bundle-budget.json. A step may grow it by at most `allowance` bytes; past that
// the build fails. When a step's growth is deliberate, `npm run bundle:accept` writes the new size as
// the baseline (commit it with the step). Lazy chunks are listed for information.
//
//   node scripts/bundle-check.mjs           check (run by `npm run build` and the bundle test)
//   node scripts/bundle-check.mjs --accept  record the current size as the baseline

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const dist = new URL('dist/', root);
const budgetFile = new URL('bundle-budget.json', root);

/** The entry's files (JS and CSS) loaded before anything lazy, and every lazy chunk */
export function entryFiles(manifest) {
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error('bundle-check: no entry in the manifest');
  const files = new Set();
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const next of chunk.imports ?? []) walk(next);
  };
  walk(Object.keys(manifest).find((key) => manifest[key] === entry));
  const lazy = Object.values(manifest).filter((chunk) => !files.has(chunk.file) && chunk.file.endsWith('.js')).map((chunk) => chunk.file);
  return { files: [...files], lazy };
}

const gzipped = (file) => gzipSync(readFileSync(new URL(file, dist)), { level: 9 }).length;

/** Measures dist/ against the budget: { ok, size, baseline, allowance, message } */
export function checkBundle() {
  const manifestUrl = new URL('.vite/manifest.json', dist);
  if (!existsSync(manifestUrl)) return null;
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const { files, lazy } = entryFiles(manifest);
  const size = files.reduce((sum, file) => sum + gzipped(file), 0);
  const budget = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, 'utf8')) : null;
  const allowance = budget?.allowance ?? 2048;
  const baseline = budget?.entryGzip ?? null;
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  const ok = baseline === null || size <= baseline + allowance;
  const message = baseline === null
    ? `first load ${kb(size)} gzipped (no baseline yet: run npm run bundle:accept)`
    : `first load ${kb(size)} gzipped, baseline ${kb(baseline)} (${size >= baseline ? '+' : ''}${kb(size - baseline)}, allowed +${kb(allowance)})`;
  return { ok, size, baseline, allowance, message, files, lazy: lazy.map((file) => [file, gzipped(file)]) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkBundle();
  if (!result) {
    console.error('bundle-check: no dist/.vite/manifest.json (run vite build first)');
    process.exit(1);
  }
  if (process.argv.includes('--accept')) {
    const budget = { entryGzip: result.size, allowance: result.allowance, note: 'The first load (entry chunk, its static imports and CSS), gzipped. Raise only on purpose: npm run bundle:accept.' };
    writeFileSync(budgetFile, JSON.stringify(budget, null, 2) + '\n');
    console.log(`bundle-check: baseline set to ${(result.size / 1024).toFixed(1)} kB`);
    process.exit(0);
  }
  console.log(`bundle-check: ${result.message}`);
  const big = result.lazy.sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`bundle-check: largest lazy chunks: ${big.map(([file, n]) => `${file.replace(/^assets\//, '')} ${(n / 1024).toFixed(1)} kB`).join(', ')}`);
  if (!result.ok) {
    console.error('bundle-check: the first load grew past its allowance. Move the new code into a lazy chunk, or raise the baseline on purpose with npm run bundle:accept.');
    process.exit(1);
  }
}
