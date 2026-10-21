/* field_gps_map — 分類と色。地図・一覧・KML の色はここだけで決める。
 * 名前(表示)は i18n.js の 'cat.<key>'。key は保存データに入るので変えないこと。 */
export const CATEGORIES = [
  { key: 'field', color: '#43a047' },      // 圃場・畑(machamba)
  { key: 'block', color: '#00897b' },      // 圃場の区画(ブロック)
  { key: 'nursery', color: '#8e24aa' },    // 苗畑(viveiro)
  { key: 'hedge', color: '#6d4c41' },      // 生垣・フェンス
  { key: 'water', color: '#1e88e5' },      // 川・水源
  { key: 'road', color: '#616161' },       // 道
  { key: 'building', color: '#f4511e' },   // 建物・倉庫
  { key: 'tree', color: '#2e7d32' },       // 木・株
  { key: 'other', color: '#f9a825' }       // その他
];

export function catColor(key) {
  const c = CATEGORIES.find((x) => x.key === key);
  return c ? c.color : '#f9a825';
}

/** 新しく記録するときの既定の分類(図形の種類から)。 */
export function defaultCategory(kind) {
  return kind === 'polygon' ? 'field' : kind === 'line' ? 'water' : 'tree';
}
