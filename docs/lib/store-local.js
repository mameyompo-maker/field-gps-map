/* field_gps_map — 記録の保存先(試用モード): この端末の localStorage だけ。
 * ログイン不要で操作を試せる。研修や、アプリの動作確認(自動テスト)にも使う。
 * 本番の store-firestore.js と同じ形の関数を返す。
 */
const KEY = 'fgm.demo.features';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function createLocalStore(user) {
  const me = { uid: user.uid, email: user.email, name: user.displayName || user.email };
  let all = load();
  const listeners = new Set();
  const visible = () => all.filter((f) => !f.archived).map((f) => ({ ...f, _pending: false }));
  const emit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 容量不足 */ }
    const list = visible();
    listeners.forEach((fn) => fn(list, { pending: 0, fromCache: false, error: '' }));
  };
  const newId = () => 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    mode: 'local',
    me,
    subscribe(fn) { listeners.add(fn); fn(visible(), { pending: 0, fromCache: false, error: '' }); return () => listeners.delete(fn); },
    onError() { return () => {}; },
    add(data) {
      const id = newId();
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
    async flush() { return true; },
    close() {}
  };
}
