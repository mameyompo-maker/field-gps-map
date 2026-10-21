/* field_gps_map — 端末ごとの設定(localStorage)。共有はしない。 */
const KEY = 'fgm.settings';

export const DEFAULTS = {
  lang: '',            // '' = 端末の言語から決める(日本語なら ja、それ以外は pt)
  maxAcc: 10,          // これより誤差(m)の大きい測位は頂点に使わない
  minDist: 3,          // 歩いて記録: 前の頂点からこれだけ(m)動いたら次の頂点
  avgSeconds: 5,       // 角・地点の記録: 何秒の測位を平均するか
  mapMode: 'auto',     // auto | google | simple
  mapType: 'hybrid'    // Google マップの種類
};

let current = { ...DEFAULTS };
try { current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* 既定値で動く */ }

export function getSettings() { return current; }

export function saveSettings(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* 保存できなくても今回は有効 */ }
  return current;
}
