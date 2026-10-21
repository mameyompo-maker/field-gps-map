/* field_gps_map — 記録の保存先(試用モード): この端末だけ。
 * ログイン不要で操作を試せる。研修や、アプリの動作確認(自動テスト)にも使う。
 * 本番の store-firestore.js と同じ形の関数を返す。
 *
 * 記録は localStorage、写真は IndexedDB に置く。写真を localStorage に入れると
 * 数枚で容量(5 MB 前後)を使い切り、記録そのものまで保存できなくなるため。
 */
const KEY = 'fgm.demo.features';
const DB_NAME = 'fgm-demo';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

let dbp = null;
function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('fid', 'fid');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('photos', mode);
    const out = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export function createLocalStore(user) {
  const me = { uid: user.uid, email: user.email, name: user.displayName || user.email };
  let all = load();
  const listeners = new Set();
  const photoListeners = new Map();   // fid -> Set(fn)
  const visible = () => all.filter((f) => !f.archived).map((f) => ({ ...f, _pending: false }));
  const META = { pending: 0, photosPending: 0, fromCache: false, error: '' };
  const emit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 容量不足 */ }
    const list = visible();
    listeners.forEach((fn) => fn(list, META));
  };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const getPhotos = async (fid) => {
    const rows = await tx('readonly', (s) => s.index('fid').getAll(fid));
    return (rows || []).filter((p) => !p.archived).map((p) => ({ ...p, _pending: false }))
      .sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));
  };
  const emitPhotos = async (fid) => {
    const set = photoListeners.get(fid);
    if (!set || !set.size) return;
    const list = await getPhotos(fid);
    set.forEach((fn) => fn(list));
  };

  return {
    mode: 'local',
    me,
    subscribe(fn) { listeners.add(fn); fn(visible(), META); return () => listeners.delete(fn); },
    onError() { return () => {}; },
    add(data) {
      const id = newId('demo-');
      const now = Date.now();
      all.push({ ...data, id, createdBy: me, updatedBy: me, createdAtMs: now, updatedAtMs: now, clientCreatedAt: now, archived: false, app: 'field_gps_map', v: 1 });
      emit();
      return id;
    },
    update(id, patch) {
      all = all.map((f) => (f.id === id ? { ...f, ...patch, updatedBy: me, updatedAtMs: Date.now() } : f));
      emit();
    },
    archive(id) { this.update(id, { archived: true }); },
    addPhoto(fid, p) {
      const id = newId('ph-');
      tx('readwrite', (s) => s.put({
        id, fid, data: p.data, thumb: p.thumb, w: p.w, h: p.h, takenAt: p.takenAt || Date.now(),
        uploadedBy: me, createdAtMs: Date.now(), archived: false
      })).then(() => emitPhotos(fid)).catch((e) => console.error(e));
      return id;
    },
    watchPhotos(fid, fn) {
      if (!photoListeners.has(fid)) photoListeners.set(fid, new Set());
      photoListeners.get(fid).add(fn);
      getPhotos(fid).then(fn).catch(() => fn([]));
      return () => photoListeners.get(fid).delete(fn);
    },
    getPhotos,
    removePhoto(fid, pid) {
      tx('readwrite', (s) => {
        const r = s.get(pid);
        r.onsuccess = () => { if (r.result) s.put({ ...r.result, archived: true }); };
        return null;
      }).then(() => emitPhotos(fid)).catch((e) => console.error(e));
    },
    async flush() { return true; },
    close() {}
  };
}
