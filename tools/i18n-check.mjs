// Checks the translations: every text present, placeholders kept, nothing unknown.
//   node tools/i18n-check.mjs [code…]
import { readFileSync, readdirSync } from 'node:fs';
import { EN, EN_T } from '../src/i18n-en.js';
import { textId } from '../src/i18n-id.js';
const base = new Map([...Object.entries(EN), ...Object.entries(EN_T)].map(([sk, en]) => [textId(sk), en]));
const ph = s => [...String(s).matchAll(/\{(\d)\}/g)].map(m => m[1]).sort().join(',');
const codes = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(new URL('../src/i18n/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
let bad = 0;
for (const code of codes) {
  let T;
  try { T = JSON.parse(readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')); } catch (e) { console.log(code, 'INVALID JSON', e.message); bad++; continue; }
  const missing = [...base.keys()].filter(id => !(id in T)), extra = Object.keys(T).filter(id => !base.has(id));
  const phBad = [...base].filter(([id, en]) => id in T && ph(T[id]) !== ph(en)).map(([id]) => id);
  const empty = Object.entries(T).filter(([, v]) => !String(v).trim()).map(([id]) => id);
  const ok = !missing.length && !extra.length && !phBad.length && !empty.length;
  if (!ok) bad++;
  console.log(`${code}: ${Object.keys(T).length}/${base.size}` + (ok ? ' ok' : `  missing ${missing.length} [${missing.slice(0, 8)}] extra ${extra.length} [${extra.slice(0, 5)}] placeholders ${phBad.length} [${phBad.slice(0, 8)}] empty ${empty.length}`));
}
process.exit(bad ? 1 : 0);
