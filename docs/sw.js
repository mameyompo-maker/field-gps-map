/* field_gps_map — Service Worker(jatlog_offline / field_visit_map と同じ考え方)。
 *
 *   1. アプリ本体のファイルはキャッシュから返す(圏外でも開ける)。裏でネットから取り直して
 *      キャッシュを新しくしておく。
 *   2. Firebase SDK(gstatic)もキャッシュする。無いと圏外で起動すらできない。
 *      URL に版数が入っていて中身が変わらないので固定してよい。
 *   3. それ以外は一切キャッシュしない。特に Google マップのタイル・衛星写真
 *      (maps.googleapis.com / maps.gstatic.com / khms*.google.com)は、規約で
 *      オフライン保存が禁じられているので絶対に入れない。Firestore の通信も入れない
 *      (入れると圏外復帰後も古いデータのままになる)。記録と写真の未送信分は
 *      Firestore SDK が端末の IndexedDB に持っていて、電波が戻ると送る。
 *
 * 自動更新:新しい sw.js は skipWaiting() → clients.claim() で即座に有効になり、
 *   ページ側(index.html)が controllerchange で1回だけ再読み込みする(記録中は待つ)。
 *   インストール時は cache: 'reload' で取りに行く。GitHub Pages は 10 分の HTTP キャッシュを
 *   付けるので、普通に取るとブラウザのキャッシュから「古い app.js」を拾うことがある。
 *
 * docs/ のファイルを1つでも変えたら CACHE の版数を必ず上げること。
 * 上げ忘れると、既に開いた端末が古い版を使い続ける(field_visit_map で実際に詰まった)。
 */
const CACHE = 'field-gps-map-v9';

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
  './lib/map-google.js',
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
