// node tests/test_i18n.mjs — 両言語のキーが揃っているか、コードで使うキーが辞書にあるか
import { readFileSync, readdirSync } from 'node:fs';
const { _DICT } = await import('../docs/lib/i18n.js');
let ng = 0;
const pt = Object.keys(_DICT.pt), ja = Object.keys(_DICT.ja);
pt.filter((k) => !ja.includes(k)).forEach((k) => { ng++; console.log('ja に無い:', k); });
ja.filter((k) => !pt.includes(k)).forEach((k) => { ng++; console.log('pt に無い:', k); });
const files = ['docs/app.js', 'docs/index.html', ...readdirSync('docs/lib').map((f) => 'docs/lib/' + f)];
const used = new Set();
files.forEach((f) => {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\('([a-z][\w.]*[\w])'/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/return '(rec\.err\.\w+)'/g)) used.add(m[1]);
});
// 動的に組み立てるキー
const kinds = ['polygon', 'line', 'point'];
['field', 'block', 'nursery', 'hedge', 'water', 'road', 'building', 'tree', 'other'].forEach((c) => used.add('cat.' + c));
kinds.forEach((k) => used.add('kind.' + k));
['walk', 'corners', 'tap', 'gps', 'import'].forEach((m) => used.add('method.' + m));
[['walk', 'polygon'], ['walk', 'line'], ['corners', 'polygon'], ['corners', 'line'], ['tap', 'polygon'], ['tap', 'line'], ['gps', 'point'], ['tap', 'point']]
  .forEach(([m, k]) => { used.add(`method.${m}.d.${k}`); if (m !== 'walk') used.add(`rec.hint.${m}.${k}`); });
[...used].filter((k) => !pt.includes(k)).forEach((k) => { ng++; console.log('辞書に無い:', k); });
console.log(`i18n: ${used.size} keys used, ${pt.length} defined, ${ng} problems`);
process.exit(ng ? 1 : 0);
