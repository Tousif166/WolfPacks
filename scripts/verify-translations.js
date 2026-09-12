/**
 * Checks that every translation key exists in all three language blocks (en / hi / bn).
 *
 * A key present in only English silently renders as the raw key name for Hindi and Bengali users,
 * which is invisible during English-only testing. This catches that.
 *
 * Run: node scripts/verify-translations.js            (checks the whole file)
 *      node scripts/verify-translations.js key1 key2  (checks specific keys)
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(path.resolve(__dirname, '..'), 'src/data/translations.js'),
  'utf8',
);

const requested = process.argv.slice(2);

// The three top-level language block names are not translation keys — they are the containers.
const LANGUAGE_BLOCKS = new Set(['en', 'hi', 'bn']);

// Every `  some_key:` at the start of a line, in file order.
const occurrences = {};
for (const m of src.matchAll(/^\s{2,}([a-z0-9_]+):/gm)) {
  const key = m[1];
  if (LANGUAGE_BLOCKS.has(key)) continue;
  occurrences[key] = (occurrences[key] || 0) + 1;
}

const keys = requested.length ? requested : Object.keys(occurrences);
const missing = [];
const duplicated = [];

keys.forEach((k) => {
  const n = occurrences[k] || 0;
  if (n === 0 || n < 3) missing.push([k, n]);
  else if (n > 3) duplicated.push([k, n]);
});

if (requested.length) {
  keys.forEach((k) => {
    const n = occurrences[k] || 0;
    console.log(`${n === 3 ? 'OK  ' : 'BAD '}${k.padEnd(30)} ${n}/3`);
  });
  console.log('');
}

console.log(`keys checked: ${keys.length}`);

if (missing.length) {
  console.log(`\nINCOMPLETE (fewer than 3 languages):`);
  missing.forEach(([k, n]) => console.log(`  ${k.padEnd(30)} ${n}/3`));
}
if (duplicated.length) {
  console.log(`\nDUPLICATED (more than 3 — likely a copy/paste slip):`);
  duplicated.forEach(([k, n]) => console.log(`  ${k.padEnd(30)} ${n}`));
}

if (!missing.length && !duplicated.length) {
  console.log('ALL KEYS HAVE FULL en/hi/bn PARITY');
}

process.exit(missing.length || duplicated.length ? 1 : 0);
