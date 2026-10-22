/* field_gps_map — 圏外用の衛星写真(Sentinel-2)。
 *
 * なぜ Sentinel-2 か:
 *   Google・Mapbox・Esri の衛星写真は、規約でこのアプリ(Web アプリ)への保存が許されていない。
 *   EU の Copernicus 計画の Sentinel-2 は無料で、出典を示せば商用でも保存・配布できる。
 *   その代わり 1画素 10 m と粗い(1 ha の畑は 10×10 画素ほど。道・川・畑のかたまりは見える)。
 *
 * 画像の用意:tools/s2_tiles.py が、雲のない画像をつないで Web 地図用のタイル(256px の WebP)に切り、
 *   別のリポジトリ field-gps-imagery(GitHub Pages)に置く。範囲と撮影日は s2/index.json。
 * 取り込み:v1.7.0 から、電波のあるときに範囲全体(約 9,900 枚・約 60 MB)を裏で自動で入れる(syncAll)。
 *   途中で電波が切れたら、次に電波のあるときに続きから。全部入ったら index.json の内容で「済み」を覚え、
 *   画像を作り直した(撮影日・枚数が変わった)ときだけ、もう一度取りに行く。
 *   「地図を保存」でも、その範囲のタイルを先に入れる(offline-map.js)。
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
      const done = (v) => { if (!v) indexP = null; return v; };   // 取れなかったときは次にもう一度試す
      const url = IMG_BASE + 'index.json';
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          const c = await caches.open(CACHE_NAME);
          await c.put(url, res.clone());
          return done(await res.json());
        }
      } catch { /* 圏外 */ }
      try {
        const hit = await (await caches.open(CACHE_NAME)).match(url);
        return done(hit ? await hit.json() : null);
      } catch { return done(null); }
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

// ---------------------------------------------------------------- 範囲全体を自動で入れる
const DONE_KEY = 'fgm.s2.done';
const verOf = (index) => `${(index.dates || []).join('_')}|${index.tiles}|${index.bytes}`;
let syncP = null;
export const syncState = { total: 0, have: 0, running: false, done: false };

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 無視 */ } }

/** 前に全部入れ終わっているか(電波がなくても答えられる)。 */
export function syncedBefore() { return !!lsGet(DONE_KEY); }

/**
 * 範囲全体のタイルを入れる。粗いズーム(8〜12)を先に、細かいズーム(13・14)は near に近い順。
 * onProgress(have, total) を時々呼ぶ。返り値は syncState。
 */
export function syncAll({ near, onProgress } = {}) {
  if (syncP) return syncP;
  syncP = (async () => {
    const index = await loadIndex();
    if (!index) return syncState;
    const ver = verOf(index);
    const [w, s, e, n] = index.bbox;
    let keys = tilesFor([s, w, n, e], index.minzoom, index.maxzoom, index);
    syncState.total = keys.length;
    if (lsGet(DONE_KEY) === ver) { Object.assign(syncState, { have: keys.length, done: true }); return syncState; }
    if (near) {
      const d = (k) => {
        const [z, x, y] = k.split('/').map(Number);
        return Math.hypot(tileToLng(x + 0.5, z) - near.lng, tileToLat(y + 0.5, z) - near.lat);
      };
      const coarse = keys.filter((k) => +k.split('/')[0] <= 12);
      const fine = keys.filter((k) => +k.split('/')[0] > 12).map((k) => [d(k), k]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      keys = coarse.concat(fine);
    }
    syncState.running = true;
    const c = await caches.open(CACHE_NAME);
    let i = 0, have = 0, failed = 0;
    async function worker() {
      while (i < keys.length) {
        const k = keys[i++];
        try {
          if (await c.match(url(k))) have++;
          else {
            const res = await fetch(url(k));
            if (res.ok) { await c.put(url(k), res); have++; }
            else if (res.status === 404) have++;      // その場所には画像がない(範囲の端)
            else failed++;
          }
        } catch { failed++; }
        syncState.have = have;
        if (onProgress && (have % 50 === 0)) onProgress(have, keys.length);
        if (failed > 30 && !navigator.onLine) return;   // 電波が切れた。続きは次の機会に
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    syncState.running = false;
    syncState.done = failed === 0 && have >= keys.length;
    if (syncState.done) lsSet(DONE_KEY, ver);
    if (onProgress) onProgress(have, keys.length);
    return syncState;
  })().finally(() => { syncP = null; });
  return syncP;
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
