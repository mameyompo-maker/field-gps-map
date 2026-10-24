/* field_gps_map — 地図データ(高画質の衛星写真・道と川・行政境界)の取り込みと読み出し。
 *
 * v2.0.0(Kazさん 10/24「最も詳細なものをデフォルトに。Google はいらない。アプリを入れたら全部自動で
 *   ダウンロードして圏外でも使えるように。ダウンロードはバックグラウンドでも続くように」):
 *   - 地図は Sentinel-2 の高画質版(16 ビットの雲なし合成を色調整したもの。1画素 10 m)だけ。Google は使わない。
 *     Google・Mapbox・Esri の衛星写真は規約上この Web アプリに保存できない。Sentinel-2 は無料・商用可(出典表示)。
 *   - 範囲は目録 field-gps-imagery/catalog.json に載っているもの全部(今は Monapo 郡と Malema〜Ribáue)。
 *     範囲ごとに、衛星写真の「束」(約 8 MB に数百枚のタイル)・道と川(osm.json)・行政境界(admin.json)。
 *     作り方は tools/hq_tiles.py・osm_region.py・admin_region.py・make_catalog.py。
 *   - 取り込み:アプリを開くと、電波があれば自動で始める(押す物はない)。
 *       Android の Chrome:Background Fetch。アプリを閉じても、画面を消しても続く(通知欄に進み具合が出る)。
 *         終わると sw.js が束をほどいてタイルを Cache Storage に入れる。
 *       それ以外(iPhone など):アプリを開いている間にページの中で取り込む。途中で切れたら次に開いたとき続きから。
 *   - 済んだ束は「<束の URL>.done」という小さな印を Cache Storage に置いて覚える。作り直した束は名前が変わるので、
 *     新しい束だけを取りに行く。古いタイルは同じ URL に上書きされる。
 *   - 電波があってまだ入っていない所は、表示のときに 1 枚ずつ取りに行く(そして入れておく)。
 *
 * 束の形(tools/hq_tiles.py):'FGMP' + 見出しの長さ(4 バイト LE)+ 見出し JSON {"tiles": [[z/x/y, 開始, 長さ]]} + 中身。
 * sw.js にも同じほどき方がある(Background Fetch の後始末は Service Worker の中で行うため)。
 */
export const IMG_ROOT = new URL('../../field-gps-imagery/', import.meta.url).href;
const CATALOG_URL = IMG_ROOT + 'catalog.json';
export const CACHE_NAME = 'fgm-s2-v1';     // v1.7.0 と同じ名前(入っているタイルをそのまま使う)。sw.js の掃除の対象外
export const ATTRIBUTION = 'Sentinel-2: Contains modified Copernicus Sentinel data 2026';
export const BG_ID = 'fgm-maps';

let catP = null;

/** 目録。電波があれば取りに行き、なければ前に入れたものを使う。各範囲に base(タイルの置き場の URL)を足す。 */
export function loadCatalog() {
  if (!catP) {
    catP = (async () => {
      let cat = null;
      try {
        const res = await fetch(CATALOG_URL, { cache: 'no-cache' });
        if (res.ok) {
          await (await caches.open(CACHE_NAME)).put(CATALOG_URL, res.clone());
          cat = await res.json();
        }
      } catch { /* 圏外 */ }
      if (!cat) {
        try {
          const hit = await (await caches.open(CACHE_NAME)).match(CATALOG_URL);
          cat = hit ? await hit.json() : null;
        } catch { cat = null; }
      }
      if (!cat) { catP = null; return null; }        // 次にもう一度試す
      cat.regions.forEach((r) => {
        r.base = IMG_ROOT + r.tiles;
        r.osmUrl = IMG_ROOT + r.osm.url;
        r.adminUrl = IMG_ROOT + r.admin.url;
      });
      return cat;
    })();
  }
  return catP;
}

/** 起動中に目録が新しくなったかもしれないとき(取り込みのあと)。 */
export function forgetCatalog() { catP = null; }

// ---------------------------------------------------------------- 何が入っていて、何が足りないか
const doneUrl = (u) => u + '.done';

/** 入れるべきもの全部と、まだ入っていないもの。bytes は束・JSON の大きさの合計。 */
export async function plan(cat) {
  cat = cat || await loadCatalog();
  if (!cat) return null;
  const c = await caches.open(CACHE_NAME);
  const all = [];
  for (const r of cat.regions) {
    r.packs.forEach((p) => all.push({ url: r.base + p.file, bytes: p.bytes, kind: 'pack', region: r.id }));
    all.push({ url: r.osmUrl, bytes: r.osm.bytes, kind: 'json', region: r.id });
    all.push({ url: r.adminUrl, bytes: r.admin.bytes, kind: 'json', region: r.id });
  }
  const missing = [];
  for (const it of all) {
    const hit = await c.match(it.kind === 'pack' ? doneUrl(it.url) : it.url);
    if (!hit) missing.push(it);
  }
  const sum = (l) => l.reduce((s, it) => s + it.bytes, 0);
  return { all, missing, totalBytes: sum(all), haveBytes: sum(all) - sum(missing) };
}

/** 束をほどいて、タイルを 1 枚ずつ Cache Storage に入れる(sw.js の unpackPack と同じ)。 */
export async function unpackPack(packUrl, buf, cache) {
  const base = packUrl.slice(0, packUrl.lastIndexOf('packs/'));
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x46474d50) throw new Error('bad pack');   // 'FGMP'
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const start = 8 + hl;
  for (const [key, off, len] of head.tiles) {
    const body = new Blob([new Uint8Array(buf, start + off, len)], { type: 'image/webp' });
    await cache.put(`${base}${key}.webp`, new Response(body, { headers: { 'Content-Type': 'image/webp' } }));
  }
  await cache.put(doneUrl(packUrl), new Response('1'));
  return head.tiles.length;
}

// ---------------------------------------------------------------- 取り込み
export const progress = { mode: null, have: 0, total: 0, running: false, done: false, error: '' };
let listeners = [];
export function onProgress(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; }
function emit() { listeners.forEach((fn) => { try { fn({ ...progress }); } catch { /* 無視 */ } }); }

let syncP = null;

/**
 * 全部入れる(足りない分だけ)。電波が無ければ何もしない。何度呼んでもよい(同時には 1 本)。
 * Background Fetch が使えればそれに任せる。使えなければ、このページの中で取り込む。
 */
export function ensureAll() {
  if (syncP) return syncP;
  syncP = (async () => {
    const pl = await plan();
    if (!pl) return progress;
    Object.assign(progress, { total: pl.totalBytes, have: pl.haveBytes, done: !pl.missing.length, error: '' });
    emit();
    if (!pl.missing.length || !navigator.onLine) return progress;
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* 無視 */ }
    if (await tryBackground(pl)) return progress;
    await inPage(pl);
    return progress;
  })().finally(() => { syncP = null; });
  return syncP;
}

/** Background Fetch(Android の Chrome など)。始められたら true。 */
async function tryBackground(pl) {
  let reg;
  try {
    if (!('serviceWorker' in navigator) || !('BackgroundFetchManager' in self)) return false;
    reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (!reg || !reg.backgroundFetch) return false;
  } catch { return false; }
  try {
    let bg = await reg.backgroundFetch.get(BG_ID);
    if (!bg) {
      const total = pl.missing.reduce((s, it) => s + it.bytes, 0);
      bg = await reg.backgroundFetch.fetch(BG_ID, pl.missing.map((it) => it.url), {
        title: titleText(),
        icons: [{ src: new URL('../icon-192.png', import.meta.url).href, sizes: '192x192', type: 'image/png' }],
        // JSON は gzip で届くと小さくなるが、大きくなることはない。少し余裕を足しておく
        downloadTotal: Math.ceil(total * 1.02) + 65536
      });
    }
    watchBackground(bg, pl);
    return true;
  } catch (err) {
    // 許可されていない(自動ダウンロードを止めている等)・容量不足など → ページの中で取り込む
    console.warn('background fetch', err);
    return false;
  }
}

function titleText() {
  const lang = (document.documentElement.lang || 'pt').slice(0, 2);
  return { ja: '地図データ(衛星写真)をダウンロード中', en: 'Downloading map data (satellite)', pt: 'A transferir dados do mapa (satélite)' }[lang]
    || 'Downloading map data';
}

function watchBackground(bg, pl) {
  const before = pl.haveBytes;
  Object.assign(progress, { mode: 'background', running: true });
  const upd = () => {
    progress.have = Math.min(pl.totalBytes, before + bg.downloaded);
    if (bg.result) {
      progress.running = false;
      if (bg.result === 'failure') progress.error = bg.failureReason || 'failed';
    }
    emit();
  };
  bg.addEventListener('progress', upd);
  upd();
}

/** sw.js が束をほどき終えたと知らせてきたとき(app.js から呼ぶ)。もう一度数え直し、足りなければ続ける。 */
export async function afterBackground() {
  progress.running = false;
  const pl = await plan();
  if (pl) Object.assign(progress, { have: pl.haveBytes, total: pl.totalBytes, done: !pl.missing.length });
  emit();
  if (pl && pl.missing.length && navigator.onLine) setTimeout(() => ensureAll(), 3000);
}

async function inPage(pl) {
  Object.assign(progress, { mode: 'page', running: true });
  emit();
  const c = await caches.open(CACHE_NAME);
  const queue = pl.missing.slice();
  let failed = 0;
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      try {
        const res = await fetch(it.url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (it.kind === 'pack') await unpackPack(it.url, await res.arrayBuffer(), c);
        else await c.put(it.url, res);
        progress.have += it.bytes;
      } catch (err) {
        failed++;
        progress.error = String((err && err.message) || err);
        if (!navigator.onLine) { queue.length = 0; break; }
      }
      emit();
    }
  }
  await Promise.all([worker(), worker()]);
  progress.running = false;
  progress.done = failed === 0;
  emit();
}

// ---------------------------------------------------------------- 道・川・境界(範囲ごとの JSON)
/** 入っている範囲の道と川・行政境界をまとめて返す。{ osm: [compact...], admin: [{lines, labels}...] } */
export async function loadVectors() {
  const cat = await loadCatalog();
  const out = { osm: [], admin: [] };
  if (!cat) return out;
  const c = await caches.open(CACHE_NAME);
  for (const r of cat.regions) {
    for (const [k, url] of [['osm', r.osmUrl], ['admin', r.adminUrl]]) {
      try {
        let res = await c.match(url);
        if (!res && navigator.onLine) {
          const net = await fetch(url);
          if (net.ok) { await c.put(url, net.clone()); res = net; }
        }
        if (res) out[k].push(await res.json());
      } catch { /* 無くても地図は描ける */ }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 描画用(map-simple.js から使う)
const mem = new Map();        // URL → ImageBitmap | null(無い)| 'loading'
const MEM_MAX = 500;

/** 描画用のタイル。まだ読んでいなければ null を返して読み始め、読めたら onLoad() を呼ぶ。
 *  端末に無く電波があれば、取りに行って入れておく。 */
export function getTile(base, key, onLoad) {
  const u = `${base}${key}.webp`;
  const v = mem.get(u);
  if (v !== undefined) {
    if (v && v !== 'loading') { mem.delete(u); mem.set(u, v); }   // 最近使ったものを後ろへ
    return v === 'loading' ? null : v;
  }
  mem.set(u, 'loading');
  (async () => {
    try {
      const c = await caches.open(CACHE_NAME);
      let hit = await c.match(u);
      if (!hit && navigator.onLine) {
        const res = await fetch(u);
        if (res.ok) { await c.put(u, res.clone()); hit = res; }
      }
      if (!hit) { mem.set(u, null); return; }
      const bmp = await createImageBitmap(await hit.blob());
      mem.set(u, bmp);
      while (mem.size > MEM_MAX) {
        const first = mem.keys().next().value;
        const old = mem.get(first);
        if (old && old.close) old.close();
        mem.delete(first);
      }
      onLoad && onLoad();
    } catch { mem.set(u, null); }
  })();
  return null;
}

/** 取り込みが進んだあとに、「無い」と覚えたタイルを忘れる。 */
export function resetMemory() {
  for (const [k, v] of mem) if (!v) mem.delete(k);
}
