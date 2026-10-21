/* field_gps_map — 端末ごとの設定(localStorage)。共有はしない。 */
const KEY = 'fgm.settings';

export const DEFAULTS = {
  lang: '',            // '' = 端末の言語から決める(ja → 日本語、en → 英語、それ以外 → ポルトガル語)
  maxAcc: 10,          // 角を打つときの誤差(m)がこれより大きければ警告する
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
