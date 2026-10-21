/* field_gps_map — 記録の保存先(本番): Firestore の gpsFeatures コレクション。
 *
 * ★ 書き込み(setDoc/updateDoc)は絶対に await しない。
 *   Firestore の書き込みは「サーバーに届いたら解決する Promise」を返すので、
 *   圏外で await すると保存ボタンが永久に戻らない(field_visit_map で踏んだ)。
 *   端末の永続キャッシュに入った時点で画面には反映され、電波が戻るとSDKが送る。
 *
 * ドキュメントの形(firestore.rules と対応):
 *   kind: 'polygon' | 'line' | 'point'
 *   name, category, group, notes
 *   vertices: [{ lat, lng, acc, t, src }]   … src = walk | gps | tap | import
 *   method: 'walk' | 'corners' | 'tap' | 'gps' | 'import'
 *   areaM2, lengthM, center: { lat, lng }, nVertices, accMedian, accMax
 *   createdBy / updatedBy: { uid, email, name }   … ルールで本人一致を強制
 *   createdAt / updatedAt: サーバー時刻、clientCreatedAt: 端末の時刻(ミリ秒)
 *   archived: false(削除は論理削除のみ)
 */
import {
  db, collection, doc, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp, waitForPendingWrites
} from './firebase-init.js';

export function createFirestoreStore(user) {
  const col = collection(db, 'gpsFeatures');
  const me = { uid: user.uid, email: user.email, name: user.displayName || user.email };
  let list = [];
  let meta = { pending: 0, fromCache: true, error: '' };
  const listeners = new Set();
  const errorListeners = new Set();

  const emit = () => listeners.forEach((fn) => fn(list, meta));
  const reportError = (err) => {
    const msg = (err && (err.code || err.message)) || String(err);
    meta = { ...meta, error: msg };
    errorListeners.forEach((fn) => fn(msg));
    emit();
  };

  const unsub = onSnapshot(
    query(col, where('archived', '==', false)),
    { includeMetadataChanges: true },
    (snap) => {
      list = snap.docs.map((d) => {
        const x = d.data({ serverTimestamps: 'estimate' });
        return {
          ...x,
          id: d.id,
          createdAtMs: (x.createdAt && x.createdAt.toMillis) ? x.createdAt.toMillis() : (x.clientCreatedAt || 0),
          updatedAtMs: (x.updatedAt && x.updatedAt.toMillis) ? x.updatedAt.toMillis() : 0,
          _pending: d.metadata.hasPendingWrites
        };
      });
      meta = { pending: list.filter((f) => f._pending).length, fromCache: snap.metadata.fromCache, error: '' };
      emit();
    },
    reportError
  );

  return {
    mode: 'firestore',
    me,
    subscribe(fn) { listeners.add(fn); fn(list, meta); return () => listeners.delete(fn); },
    onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); },
    add(data) {
      const ref = doc(col);
      setDoc(ref, {
        ...data,
        createdBy: me, updatedBy: me,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        clientCreatedAt: Date.now(),
        archived: false,
        app: 'field_gps_map', v: 1
      }).catch(reportError);
      return ref.id;
    },
    update(id, patch) {
      updateDoc(doc(col, id), { ...patch, updatedBy: me, updatedAt: serverTimestamp() }).catch(reportError);
    },
    archive(id) {
      updateDoc(doc(col, id), { archived: true, updatedBy: me, updatedAt: serverTimestamp() }).catch(reportError);
    },
    /** 未送信の書き込みがサーバーに届くまで待つ(「今すぐ同期」用)。圏外なら時間切れで false。 */
    async flush(ms = 15000) {
      const t = new Promise((resolve) => setTimeout(() => resolve(false), ms));
      return Promise.race([waitForPendingWrites(db).then(() => true), t]);
    },
    close() { unsub(); }
  };
}
