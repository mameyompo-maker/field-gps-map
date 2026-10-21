// node tests/test_i18n.mjs — 3言語のキーが揃っているか、コードで使うキーが辞書にあるか、使っていないキーが無いか
import { readFileSync, readdirSync } from 'node:fs';
const { _DICT, LANGS } = await import('../docs/lib/i18n.js');
let ng = 0;
const base = Object.keys(_DICT.pt);
LANGS.forEach((l) => {
  const keys = Object.keys(_DICT[l]);
  base.filter((k) => !keys.includes(k)).forEach((k) => { ng++; console.log(`${l} に無い:`, k); });
  keys.filter((k) => !base.includes(k)).forEach((k) => { ng++; console.log(`pt に無い(${l}):`, k); });
});
const files = ['docs/app.js', 'docs/index.html', ...readdirSync('docs/lib').map((f) => 'docs/lib/' + f)];
const used = new Set();
files.forEach((f) => {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\('([a-z][\w.]*[\w])'/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/return '(rec\.err\.\w+)'/g)) used.add(m[1]);
});
// 動的に組み立てるキー
['field', 'block', 'nursery', 'hedge', 'water', 'road', 'building', 'tree', 'other'].forEach((c) => used.add('cat.' + c));
['polygon', 'line', 'point'].forEach((k) => used.add('kind.' + k));
['walk', 'corners', 'tap', 'gps', 'import'].forEach((m) => used.add('method.' + m));
[['corners', 'polygon'], ['corners', 'line'], ['tap', 'polygon'], ['tap', 'line'], ['gps', 'point'], ['tap', 'point']]
  .forEach(([m, k]) => { used.add(`method.${m}.d.${k}`); used.add(`rec.hint.${m}.${k}`); });
[...used].filter((k) => !base.includes(k)).forEach((k) => { ng++; console.log('辞書に無い:', k); });
const unused = base.filter((k) => !used.has(k) && !k.endsWith('.d') && !/^kind\.\w+\.d$/.test(k));
if (unused.length) console.log('(参考)使われていないキー:', unused.join(', '));
console.log(`i18n: ${used.size} keys used, ${base.length} defined × ${LANGS.length} languages, ${ng} problems`);
process.exit(ng ? 1 : 0);
