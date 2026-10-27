/* field_gps_map — Service Worker(jatlog_offline / field_visit_map と同じ考え方)。
 *
 *   1. アプリ本体のファイルはキャッシュから返す(圏外でも開ける)。裏でネットから取り直して
 *      キャッシュを新しくしておく。
 *   2. Firebase SDK(gstatic)もキャッシュする。無いと圏外で起動すらできない。
 *      URL に版数が入っていて中身が変わらないので固定してよい。
 *   3. それ以外は fetch では一切キャッシュしない。Firestore の通信も入れない
 *      (入れると圏外復帰後も古いデータのままになる)。記録と写真の未送信分は
 *      Firestore SDK が端末の IndexedDB に持っていて、電波が戻ると送る。
 *      v2.0.0 から Google マップは使わない(地図は自前の衛星写真。Google のタイルは規約で保存できない)。
 *   4. 地図データ(衛星写真の束・道と川・行政境界)の Background Fetch の後始末(下の backgroundfetch*)。
 *      アプリを閉じていても、ダウンロードが終わるとブラウザがこの SW を起こすので、ここで束をほどいて
 *      タイルを Cache Storage(fgm-s2-v1)に入れる。ほどき方は lib/imagery.js の unpackPack と同じ。
 *
 * 自動更新:新しい sw.js は skipWaiting() → clients.claim() で即座に有効になり、
 *   ページ側(index.html)が controllerchange で1回だけ再読み込みする(記録中は待つ)。
 *   インストール時は cache: 'reload' で取りに行く。GitHub Pages は 10 分の HTTP キャッシュを
 *   付けるので、普通に取るとブラウザのキャッシュから「古い app.js」を拾うことがある。
 *
 * docs/ のファイルを1つでも変えたら CACHE の版数を必ず上げること。
 * 上げ忘れると、既に開いた端末が古い版を使い続ける(field_visit_map で実際に詰まった)。
 */
const CACHE = 'field-gps-map-v11';

const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './lib/i18n.js',
  './lib/geo.js',
  './lib/gps.js',
  './lib/recorder.js',
  './lib/settings.js',
  './lib/categories.js',
  './lib/map-simple.js',
  './lib/export.js',
  './lib/zip.js',
  './lib/photos.js',
  './lib/offline-map.js',
  './lib/imagery.js', './lib/admin-stats.js', './lib/user-imagery.js', './vendor/geotiff.js',
  './lib/store-local.js',
  './lib/store-firestore.js',
  './lib/firebase-init.js',
  './lib/auth.js'
];

// firebase-init.js の SDK_VERSION を上げたら、ここも一緒に直すこと。
const SDK = 'https://www.gstatic.com/firebasejs/12.4.0';
const CDN_FILES = [
  `${SDK}/firebase-app.js`,
  `${SDK}/firebase-auth.js`,
  `${SDK}/firebase-firestore.js`
];

const ROOT = new URL('./', self.location).pathname;
const NAMES = FILES.map((f) => f.replace(/^\.\//, ''));

function isAppFile(url) {
  if (url.pathname.indexOf(ROOT) !== 0) return false;
  return NAMES.indexOf(url.pathname.slice(ROOT.length)) >= 0;
}

function isCdnFile(url) {
  return CDN_FILES.indexOf(url.origin + url.pathname) >= 0;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // 1つずつ入れる(addAll は1つ失敗すると全部やり直しになる)。HTTP キャッシュは通さない。
      await Promise.allSettled(FILES.map((f) => c.add(new Request(f, { cache: 'reload' }))));
      await Promise.allSettled(CDN_FILES.map((u) => c.add(u)));
      await self.skipWaiting();
    }).catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) => Promise.all(
      // 消すのはアプリ本体の古い版だけ。衛星写真(fgm-s2-…)は残す。
      names.filter((n) => n !== CACHE && n.indexOf('field-gps-map-') === 0).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

/* ページからの問い合わせ:「圏外で使う準備ができているか」(メニューの表示用)。
 * アプリ本体と Firebase SDK が全部キャッシュに入っていれば ready。足りなければ、
 * 足りない分をこの場で取りに行く(電波があれば次に開いたときには揃っている)。 */
self.addEventListener('message', (e) => {
  const port = e.ports && e.ports[0];
  if (!e.data || e.data.type !== 'status' || !port) return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const missing = [];
    for (const f of FILES) {
      const hit = await c.match(new URL(f, self.location).href.replace(/\?.*$/, ''), { ignoreVary: true });
      if (!hit) missing.push(f);
    }
    for (const u of CDN_FILES) if (!(await c.match(u))) missing.push(u);
    port.postMessage({ ready: missing.length === 0, missing: missing.length, cache: CACHE });
    if (missing.length) {
      await Promise.allSettled(missing.map((f) => c.add(f.startsWith('http') ? f : new Request(f, { cache: 'reload' }))));
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }

  const sameOriginApp = url.origin === self.location.origin && isAppFile(url);
  const cdn = isCdnFile(url);
  if (!sameOriginApp && !cdn) return;

  // ?demo などのクエリ付きで開いても、同じ index.html を返す
  const key = sameOriginApp ? new Request(url.origin + url.pathname) : req;

  e.respondWith(
    caches.match(key, { ignoreVary: true }).then((cached) => {
      const fromNetwork = fetch(req).then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fromNetwork;
    })
  );
});

// ================================================================ 地図データの Background Fetch(lib/imagery.js が始める)
const MAP_CACHE = 'fgm-s2-v1';

/** 束('FGMP' + 見出し + 中身)をほどいて、タイルを 1 枚ずつ入れる。最後に「済み」の印を置く。 */
async function unpackPack(packUrl, buf, cache) {
  const base = packUrl.slice(0, packUrl.lastIndexOf('packs/'));
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x46474d50) throw new Error('bad pack');
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const start = 8 + hl;
  for (const [key, off, len] of head.tiles) {
    const body = new Blob([new Uint8Array(buf, start + off, len)], { type: 'image/webp' });
    await cache.put(base + key + '.webp', new Response(body, { headers: { 'Content-Type': 'image/webp' } }));
  }
  await cache.put(packUrl + '.done', new Response('1'));
}

/** 届いた分を全部入れる(失敗で終わったときも、届いた分は入れる。残りは次にアプリを開いたとき)。 */
async function storeRecords(registration) {
  const cache = await caches.open(MAP_CACHE);
  const records = await registration.matchAll();
  let ok = 0;
  for (const rec of records) {
    try {
      const res = await rec.responseReady;
      if (!res || !res.ok) continue;
      const url = rec.request.url;
      if (url.endsWith('.bin')) await unpackPack(url, await res.arrayBuffer(), cache);
      else await cache.put(url, res);
      ok++;
    } catch (err) { /* この1つは次の機会に */ }
  }
  return ok;
}

async function tellClients() {
  const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  list.forEach((c) => c.postMessage({ type: 'maps-updated' }));
}

const DONE_TITLE = {
  ja: '地図の準備ができました(圏外でも使えます)',
  en: 'Map ready (works without signal)',
  pt: 'Mapa pronto (funciona sem rede)'
};

self.addEventListener('backgroundfetchsuccess', (e) => {
  e.waitUntil((async () => {
    await storeRecords(e.registration);
    const lang = ((self.navigator && self.navigator.language) || 'pt').slice(0, 2);
    try { await e.updateUI({ title: DONE_TITLE[lang] || DONE_TITLE.pt }); } catch { /* 古いブラウザ */ }
    await tellClients();
  })());
});

self.addEventListener('backgroundfetchfail', (e) => {
  e.waitUntil(storeRecords(e.registration).then(tellClients));
});

self.addEventListener('backgroundfetchabort', (e) => {
  e.waitUntil(tellClients());
});

// 通知欄の「ダウンロード中」を押したらアプリを開く
self.addEventListener('backgroundfetchclick', (e) => {
  e.waitUntil(self.clients.openWindow(new URL('./', self.location).href));
});
