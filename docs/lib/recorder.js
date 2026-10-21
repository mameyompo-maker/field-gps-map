/* field_gps_map — 記録中の図形(下書き)の状態管理。
 *
 * 画面(app.js)から切り離した純粋な状態機械。記録の方式は3つ:
 *   walk    … 歩くと自動で頂点を打つ。前の頂点から minDist(m)以上動き、誤差が
 *             maxAcc(m)以下の測位だけを採用する(誤差の大きい測位で形が尖るのを防ぐ)。
 *   corners … 角に立って「この角を記録」を押す。avgSeconds 秒の測位を平均して1頂点。
 *   tap     … 地図を押して頂点を置く(行けない場所用)。GPSの実測ではないので src='tap'。
 * 地点(point)は gps(平均)か tap のどちらか。頂点は常に1つで、取り直すと置き換わる。
 *
 * 下書きは変更のたびに localStorage へ保存する。電池切れ・誤ってタブを閉じた・
 * アプリの更新で再読み込みされた、のどれでも、開き直せば続きから記録できる。
 */
import { distance, polygonArea, pathLength, selfIntersects } from './geo.js';

const DRAFT_KEY = 'fgm.draft';

export function createRecorder() {
  let st = null;              // { kind, method, vertices, paused, startedAt, rejected, gapCount }
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
    resume(draft) { st = draft; st.paused = st.method === 'walk' ? true : st.paused; emit(); },
    discardDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* 無視 */ } },

    start(kind, method) {
      st = { kind, method, vertices: [], paused: false, startedAt: Date.now(), rejected: 0, gapCount: 0, lastFixT: 0 };
      emit();
    },

    clear() { st = null; emit(); },

    setPaused(p) { if (!st) return; st.paused = p; if (!p) st.lastFixT = 0; emit(); },

    /** 頂点を足す(角の平均・地図のタップ)。地点は置き換え。 */
    addVertex(v) {
      if (!st) return;
      const vv = {
        lat: v.lat, lng: v.lng,
        acc: Number.isFinite(v.acc) ? Math.round(v.acc * 10) / 10 : null,
        t: v.t || Date.now(),
        src: v.src || 'gps'
      };
      if (v.n) vv.n = v.n;
      if (st.kind === 'point') st.vertices = [vv];
      else st.vertices.push(vv);
      emit();
    },

    undo() {
      if (!st || !st.vertices.length) return;
      st.vertices.pop();
      emit();
    },

    /**
     * 歩いて記録する方式で、新しい測位が来るたびに呼ぶ。
     * 戻り値: 'added' | 'skip-acc' | 'skip-dist' | 'gap' | 'ignored'
     */
    onFix(fix, { maxAcc, minDist }) {
      if (!st || st.method !== 'walk' || st.paused || !fix) return 'ignored';
      if (fix.t <= (st.lastFixT || 0)) return 'ignored';
      const prevT = st.lastFixT;
      st.lastFixT = fix.t;
      if (fix.acc > maxAcc) { st.rejected++; emit(); return 'skip-acc'; }
      const last = st.vertices[st.vertices.length - 1];
      // 30秒以上測位が途切れていた(画面が消えた・別アプリに切り替えた)なら抜けとして数える。
      let gap = false;
      if (last && prevT && fix.t - prevT > 30000) { st.gapCount++; gap = true; }
      if (last && distance(last, fix) < minDist) { if (gap) emit(); return gap ? 'gap' : 'skip-dist'; }
      st.vertices.push({ lat: fix.lat, lng: fix.lng, acc: Math.round(fix.acc * 10) / 10, t: fix.t, src: 'walk' });
      emit();
      return gap ? 'gap' : 'added';
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
        closingGapM: st.kind === 'polygon' && v.length > 2 ? distance(v[v.length - 1], v[0]) : null,
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
