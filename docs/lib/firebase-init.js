/* field_gps_map — Firebase の共通初期化(Auth / Firestore)。
 *
 * field_visit_map と同じ Firebase プロジェクト(kazdr-field-visit-map)を使う。
 * ログインと許可リスト(allowedUsers)を共有するので、Kazさんが許可リストを
 * 2つ管理しなくて済む。データは別のコレクション(gpsFeatures)に入る。
 *
 * ビルド無しの構成なので SDK は CDN の ES モジュールをそのまま import する。
 * バージョンを上げるときは、この SDK_VERSION と docs/sw.js の CDN_FILES の両方を直すこと
 * (片方だけだとオフラインで起動しなくなる)。
 */
const SDK_VERSION = '12.4.0';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

// 依存していないので並列に取る(1つずつ await すると往復が直列に積み上がる)。
const [
  { initializeApp },
  { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged },
  {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, getDoc, collection, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp,
    waitForPendingWrites
  }
] = await Promise.all([
  import(`${CDN}/firebase-app.js`),
  import(`${CDN}/firebase-auth.js`),
  import(`${CDN}/firebase-firestore.js`)
]);

const cfg = window.FIELD_GPS_CONFIG;
if (!cfg || !cfg.firebase || !cfg.firebase.apiKey) {
  throw new Error('docs/config.js が見つからないか未設定です。');
}

const app = initializeApp(cfg.firebase);
const auth = getAuth(app);

/* 端末に永続キャッシュを持たせる。圏外での書き込みはここに溜まり、
 * 電波が戻るとSDKが自動で送る(Firestore の標準機能。自前のキューは不要)。 */
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export {
  cfg, app, auth, db,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  doc, getDoc, collection, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp, waitForPendingWrites
};
