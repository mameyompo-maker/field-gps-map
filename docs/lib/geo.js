/* field_gps_map — 測地計算(面積・距離・重心・GPSの平均化)。
 *
 * 外部ライブラリ(Turf.js など)は使わない。オフラインで動くことが要件で、
 * CDNを1本増やすたびに「圏外でそこだけ動かない」事故の種が増えるため。
 * ここにある式は数百m〜数kmの圃場には十分な精度で、テスト(tests/test_geo.mjs)で
 * 既知の値と照合している。
 */

export const R = 6378137;   // WGS84 の赤道半径(m)。Google Maps の computeArea と同じ値。

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** 2点間の距離(m)。haversine。 */
export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 線の長さ(m)。closed=true なら最後の点から最初の点へ戻る辺も足す(外周)。 */
export function pathLength(pts, closed = false) {
  if (!pts || pts.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distance(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += distance(pts[pts.length - 1], pts[0]);
  return s;
}

/**
 * 多角形の面積(m²)。球面上の面積(Chamberlain & Duquette の近似式。Turf.js・
 * OpenLayers と同じ方式)。頂点の向き(時計回り/反時計回り)には依存しない。
 * 閉じていなくてよい(最後→最初の辺は自動で足す)。
 */
export function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let total = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    total += toRad(p2.lng - p1.lng) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((total * R * R) / 2);
}

/** 基準点を中心にした平面座標(m)への変換。数km以内なら誤差は無視できる。 */
export function makeLocalProjection(ref) {
  const cos0 = Math.cos(toRad(ref.lat));
  return {
    toXY: (p) => ({
      x: toRad(p.lng - ref.lng) * R * cos0,
      y: toRad(p.lat - ref.lat) * R
    }),
    toLatLng: (xy) => ({
      lat: ref.lat + toDeg(xy.y / R),
      lng: ref.lng + toDeg(xy.x / (R * cos0))
    })
  };
}

/** 図形の代表点。多角形は面積重心、線と点は頂点の平均(共有リンクや一覧の位置に使う)。 */
export function centroid(pts, kind) {
  if (!pts || !pts.length) return null;
  if (pts.length === 1) return { lat: pts[0].lat, lng: pts[0].lng };
  const mean = {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length
  };
  if (kind !== 'polygon' || pts.length < 3) return mean;
  const proj = makeLocalProjection(mean);
  const xy = pts.map(proj.toXY);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i];
    const q = xy[(i + 1) % xy.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return mean;   // 面積ゼロ(一直線に並んだ点)なら平均で代用
  return proj.toLatLng({ x: cx / (3 * a), y: cy / (3 * a) });
}

/** 図形を囲む範囲。地図の表示範囲合わせに使う。 */
export function bounds(pts) {
  if (!pts || !pts.length) return null;
  let s = 90, w = 180, n = -90, e = -180;
  pts.forEach((p) => {
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
  });
  return { south: s, west: w, north: n, east: e };
}

/**
 * 複数のGPS測位を1点にまとめる(角の記録・地点の記録で使う)。
 * 精度(誤差半径 m)の2乗の逆数で重み付けする。精度が悪い測位ほど効きが小さい。
 * 戻り値の acc は「まとめた後の推定誤差」— 独立な測位を n 回平均すると
 * 誤差はおおむね 1/√n になるが、スマホのGPSは連続した測位が独立ではない
 * (同じ誤差を引きずる)ので、楽観的になりすぎないよう最良値より小さくはしない。
 */
export function averageFixes(fixes) {
  const list = (fixes || []).filter((f) => f && Number.isFinite(f.lat) && Number.isFinite(f.lng));
  if (!list.length) return null;
  let sw = 0, la = 0, ln = 0;
  list.forEach((f) => {
    const acc = Math.max(1, Number.isFinite(f.acc) ? f.acc : 50);
    const w = 1 / (acc * acc);
    sw += w;
    la += f.lat * w;
    ln += f.lng * w;
  });
  const best = Math.min(...list.map((f) => (Number.isFinite(f.acc) ? f.acc : 50)));
  return { lat: la / sw, lng: ln / sw, acc: Math.round(best * 10) / 10, n: list.length };
}

/**
 * 辺どうしが交差していないか(8の字になっていないか)。歩いて記録するとき、
 * 最後に始点へ戻りきらずに折り返すと8の字になり、面積が実際より小さく出る。
 * 頂点数が多いと O(n²) なので、2,000頂点を超えたら確認を省く(現実の圃場では
 * そこまで行かない)。
 */
export function selfIntersects(pts) {
  const n = pts ? pts.length : 0;
  if (n < 4 || n > 2000) return false;
  const proj = makeLocalProjection(pts[0]);
  const xy = pts.map(proj.toXY);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const segX = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    const a1 = xy[i], a2 = xy[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;   // 隣り合う辺(最初と最後)は除く
      const b1 = xy[j], b2 = xy[(j + 1) % n];
      if (segX(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** 点が多角形の内側か(地図のタップで図形を選ぶのに使う)。 */
export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (((a.lat > p.lat) !== (b.lat > p.lat)) &&
        (p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- 表示用

export function fmtArea(m2, lang) {
  if (!Number.isFinite(m2)) return '';
  const loc = lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-GB' : 'pt-PT';
  if (m2 < 10000) {
    return `${Math.round(m2).toLocaleString(loc)} m² (${(m2 / 10000).toLocaleString(loc, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ha)`;
  }
  return `${(m2 / 10000).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}

export function fmtHa(m2, lang) {
  if (!Number.isFinite(m2)) return '';
  const loc = lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-GB' : 'pt-PT';
  const d = m2 < 10000 ? 3 : 2;
  return `${(m2 / 10000).toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d })} ha`;
}

export function fmtLength(m, lang) {
  if (!Number.isFinite(m)) return '';
  const loc = lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-GB' : 'pt-PT';
  if (m < 1000) return `${Math.round(m).toLocaleString(loc)} m`;
  return `${(m / 1000).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

export function fmtCoord(p) {
  if (!p) return '';
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}
