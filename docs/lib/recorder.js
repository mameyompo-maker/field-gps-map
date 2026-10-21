/* field_gps_map — 記録中の図形(下書き)の状態管理。
 *
 * 画面(app.js)から切り離した純粋な状態機械。記録の方式は2つ(記録の途中で切り替えられる):
 *   corners … 歩いて角に来たらボタンを押す。その瞬間の測位で1点(待ち時間なし)。
 *             1つの圃場で 10 点以内に収めたい(Kazさん 2026-10-21)ので、
 *             歩くだけで点が増える方式(旧 walk)はやめた。
 *   tap     … 地図を押して頂点を置く(行けない場所用)。GPSの実測ではないので src='tap'。
 * 地点(point)は gps(現在地)か tap。頂点は常に1つで、取り直すと置き換わる。
 *
 * 下書きは変更のたびに localStorage へ保存する。電池切れ・誤ってタブを閉じた・
 * アプリの更新で再読み込みされた、のどれでも、開き直せば続きから記録できる。
 */
import { polygonArea, pathLength, selfIntersects } from './geo.js';

const DRAFT_KEY = 'fgm.draft';

export function createRecorder() {
  let st = null;              // { kind, method, vertices, startedAt }
  const listeners = new Set();

  const save = () => {
    try {
      if (st) localStorage.setItem(DRAFT_KEY, JSON.stringify(st));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* 容量不足などで保存できなくても記録は続ける */ }
  };
  const emit = () => { save(); listeners.forEach((fn) => fn(st)); };

  return {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get state() { return st; },
    get active() { return !!st; },

    /** 前回の下書きがあれば読み込む(続きから記録するかは画面側で尋ねる)。 */
    loadDraft() {
      try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (d && d.kind && Array.isArray(d.vertices)) return d;
      } catch { /* 壊れていたら無視 */ }
      return null;
    },
    resume(draft) {
      // 旧版の「外周を歩く」の下書きは、角を打つ方式の続きとして再開する
      st = { kind: draft.kind, method: draft.method === 'walk' ? 'corners' : draft.method,
        vertices: draft.vertices, startedAt: draft.startedAt || Date.now() };
      emit();
    },
    discardDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* 無視 */ } },

    start(kind, method) {
      st = { kind, method, vertices: [], startedAt: Date.now() };
      emit();
    },

    /** 記録の途中で「歩いて(GPS)」と「地図をタップ」を切り替える。打った点はそのまま。 */
    setMethod(method) {
      if (!st || st.method === method) return;
      st.method = method;
      emit();
    },

    clear() { st = null; emit(); },

    /** 頂点を足す(角・地図のタップ)。地点は置き換え。 */
    addVertex(v) {
      if (!st) return;
      const vv = {
        lat: v.lat, lng: v.lng,
        acc: Number.isFinite(v.acc) ? Math.round(v.acc * 10) / 10 : null,
        t: v.t || Date.now(),
        src: v.src || 'gps'
      };
      if (st.kind === 'point') st.vertices = [vv];
      else st.vertices.push(vv);
      emit();
    },

    undo() {
      if (!st || !st.vertices.length) return;
      st.vertices.pop();
      emit();
    },

    stats() {
      if (!st) return null;
      const v = st.vertices;
      const accs = v.map((x) => x.acc).filter((a) => Number.isFinite(a)).sort((a, b) => a - b);
      return {
        n: v.length,
        areaM2: st.kind === 'polygon' ? polygonArea(v) : null,
        lengthM: st.kind === 'polygon' ? pathLength(v, true) : st.kind === 'line' ? pathLength(v, false) : null,
        accMedian: accs.length ? accs[Math.floor(accs.length / 2)] : null,
        accMax: accs.length ? accs[accs.length - 1] : null,
        tapCount: v.filter((x) => x.src === 'tap').length,
        selfIntersects: st.kind === 'polygon' ? selfIntersects(v) : false
      };
    },

    /** 保存できる状態か。理由のキー(i18n)を返す。 */
    validate() {
      if (!st) return 'rec.err.none';
      const n = st.vertices.length;
      if (st.kind === 'polygon' && n < 3) return 'rec.err.poly';
      if (st.kind === 'line' && n < 2) return 'rec.err.line';
      if (st.kind === 'point' && n < 1) return 'rec.err.point';
      return '';
    }
  };
}
