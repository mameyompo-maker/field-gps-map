/* field_gps_map — 圏外用の衛星写真(Sentinel-2)。
 *
 * なぜ Sentinel-2 か:
 *   Google・Mapbox・Esri の衛星写真は、規約でこのアプリ(Web アプリ)への保存が許されていない。
 *   EU の Copernicus 計画の Sentinel-2 は無料で、出典を示せば商用でも保存・配布できる。
 *   その代わり 1画素 10 m と粗い(1 ha の畑は 10×10 画素ほど。道・川・畑のかたまりは見える)。
 *
 * 画像の用意:tools/s2_tiles.py が、雲のない画像をつないで Web 地図用のタイル(256px の WebP)に切り、
 *   別のリポジトリ field-gps-imagery(GitHub Pages)に置く。範囲と撮影日は s2/index.json。
 * 取り込み:offline-map.js の「地図を保存」と同時に、その範囲のタイルを Cache Storage(FGM_S2)に入れる。
 * 描画:map-simple.js が、画面に入るタイルをここから受け取って一番下に描く。
 */
export const IMG_BASE = new URL('../../field-gps-imagery/s2/', import.meta.url).href;
const CACHE_NAME = 'fgm-s2-v1';     // sw.js の掃除で消されないよう、名前は field-gps-map- で始めない
export const ATTRIBUTION = 'Sentinel-2: Contains modified Copernicus Sentinel data 2026';

let indexP = null;

/** 画像の範囲(index.json)。電波があれば取りに行き、なければ前に入れたものを使う。 */
export function loadIndex() {
  if (!indexP) {
    indexP = (async () => {
      const url = IMG_BASE + 'index.json';
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          const c = await caches.open(CACHE_NAME);
          await c.put(url, res.clone());
          return await res.json();
        }
      } catch { /* 圏外 */ }
      try {
        const hit = await (await caches.open(CACHE_NAME)).match(url);
        return hit ? await hit.json() : null;
      } catch { return null; }
    })();
  }
  return indexP;
}

function lngToX(lng, z) { return ((lng + 180) / 360) * 2 ** z; }
function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tileToLng(x, z) { return (x / 2 ** z) * 360 - 180; }
export function tileToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** 四角(南・西・北・東)にかかるタイルの一覧。画像の範囲の外は除く。 */
export function tilesFor(bbox, zmin, zmax, index) {
  if (!index) return [];
  const [iw, is, ie, inn] = index.bbox;      // W S E N
  const S = Math.max(bbox[0], is), Wl = Math.max(bbox[1], iw), N = Math.min(bbox[2], inn), E = Math.min(bbox[3], ie);
  if (S >= N || Wl >= E) return [];
  const out = [];
  for (let z = Math.max(zmin, index.minzoom); z <= Math.min(zmax, index.maxzoom); z++) {
    const x0 = Math.floor(lngToX(Wl, z)), x1 = Math.floor(lngToX(E, z));
    const y0 = Math.floor(latToY(N, z)), y1 = Math.floor(latToY(S, z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${z}/${x}/${y}`);
  }
  return out;
}

const url = (key) => `${IMG_BASE}${key}.webp`;

/** タイルを端末に入れる。入っているものは飛ばす。返り値は入っているタイルの数。 */
export async function saveTiles(keys, onProgress) {
  if (!keys.length) return 0;
  const c = await caches.open(CACHE_NAME);
  let done = 0, ok = 0, i = 0;
  async function worker() {
    while (i < keys.length) {
      const k = keys[i++];
      try {
        if (await c.match(url(k))) ok++;
        else {
          const res = await fetch(url(k));
          if (res.ok) { await c.put(url(k), res); ok++; }
        }
      } catch { /* 1枚くらい失敗しても続ける */ }
      done++;
      if (onProgress && (done % 10 === 0 || done === keys.length)) onProgress(done, keys.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return ok;
}

/** どの保存地図にも使われていないタイルを消す(地図を削除したとき)。 */
export async function pruneTiles(keepKeys) {
  try {
    const keep = new Set(keepKeys.map(url));
    const c = await caches.open(CACHE_NAME);
    for (const req of await c.keys()) {
      if (req.url.endsWith('.webp') && !keep.has(req.url)) await c.delete(req);
    }
  } catch { /* 無くても困らない */ }
}

// ---------------------------------------------------------------- 描画用(map-simple.js から使う)
const mem = new Map();        // key → ImageBitmap | null(無い)| 'loading'
const MEM_MAX = 400;

/** 描画用のタイル。まだ読んでいなければ null を返して読み始め、読めたら onLoad() を呼ぶ。 */
export function getTile(key, onLoad) {
  const v = mem.get(key);
  if (v !== undefined) {
    if (v && v !== 'loading') { mem.delete(key); mem.set(key, v); }   // 最近使ったものを後ろへ
    return v === 'loading' ? null : v;
  }
  mem.set(key, 'loading');
  (async () => {
    try {
      const hit = await (await caches.open(CACHE_NAME)).match(url(key));
      if (!hit) { mem.set(key, null); return; }
      const bmp = await createImageBitmap(await hit.blob());
      mem.set(key, bmp);
      while (mem.size > MEM_MAX) {
        const first = mem.keys().next().value;
        const old = mem.get(first);
        if (old && old.close) old.close();
        mem.delete(first);
      }
      onLoad && onLoad();
    } catch { mem.set(key, null); }
  })();
  return null;
}

/** 保存し直したあとに、「無い」と覚えたタイルを忘れる。 */
export function resetMemory() {
  for (const [k, v] of mem) if (!v) mem.delete(k);
}
