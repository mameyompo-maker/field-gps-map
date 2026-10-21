/* field_gps_map — Service Worker(field_visit_map / jatlog_offline と同じ3つのルール)。
 *
 *   1. アプリ本体のファイルはキャッシュから返す(圏外でも開ける)。裏で更新する。
 *   2. Firebase SDK(gstatic)もキャッシュする。無いと圏外で起動すらできない。
 *      URL に版数が入っていて中身が変わらないので固定してよい。
 *   3. それ以外は一切キャッシュしない。特に Google マップのタイル・衛星写真
 *      (maps.googleapis.com / maps.gstatic.com / khms*.google.com)は、規約で
 *      オフライン保存が禁じられているので絶対に入れない。Firestore の通信も入れない
 *      (入れると圏外復帰後も古いデータのままになる)。
 *
 * docs/ のファイルを1つでも変えたら CACHE の版数を必ず上げること。
 * 上げ忘れると、既に開いた端末が古い版を使い続ける(field_visit_map で実際に詰まった)。
 */
const CACHE = 'field-gps-map-v1';

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
      await c.addAll(FILES).catch(() => {});
      await Promise.allSettled(CDN_FILES.map((u) => c.add(u)));
      await self.skipWaiting();
    }).catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
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
