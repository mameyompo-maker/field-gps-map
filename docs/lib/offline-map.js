/* field_gps_map — 圏外用の地図(OpenStreetMap のデータを端末に保存する)。
 *
 * なぜ OpenStreetMap か:
 *   - Google の地図・衛星写真は、規約で端末への保存(先読み・オフライン利用)が禁じられている。
 *   - Esri の衛星写真は ArcGIS の有料契約と ArcGIS 製アプリが前提。EOX(Sentinel-2)は商用が有償。
 *   - OpenStreetMap のデータは ODbL で、出典(© OpenStreetMap contributors)を示せば商用でも保存・利用できる。
 *     モザンビーク北部は人道支援の地図づくり(HOT)で建物・道・川がかなり描かれている
 *     (2026-10-22 に Malema 周辺 27×22 km を数えたら約 1.3 万件)。
 *   OsmAnd・Organic Maps など「オフライン地図アプリ」も同じく OpenStreetMap のデータを丸ごと
 *   端末に入れて、端末の中で地図を描いている。ここではそれを小さく真似る。
 *
 * 取り込み:Overpass API(OpenStreetMap の検索窓口)に「この四角の中の道・川・池・建物・地名」を1回尋ねる。
 * 保存:IndexedDB(この端末だけ。会社の Firebase には送らない)。地図は描画用に軽い形へ詰め直して持つ。
 * 描画:map-simple.js が簡易地図の上に描く。
 *
 * 2段構え(Kazさん 10/22「半径 100 km にできないか」):
 *   - この辺り:一辺 10 km、建物まで。Malema の町で約 1.2 万件・答え 7.6 MB。
 *   - 広い範囲:一辺 200 km(半径 100 km)、道・川・池・集落名だけ。建物は 200 km 四方で約 33 万件あり、
 *     窓口にも端末にも重すぎるので入れない。道 6,093・川 516 で答え約 15 MB(10/22 実測)。
 *   どちらも、範囲に衛星写真(imagery.js)があれば一緒に保存する。
 */
import { loadIndex, tilesFor, saveTiles } from './imagery.js';
const DB_NAME = 'fgm-offline-map';
const STORE = 'areas';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'      // 本家は一時的に 502 を返すことがあるので、もう一度
];
export const AREA_KM = 10;   // 「この辺り」の四角の一辺(km)
export const WIDE_KM = 200;  // 「広い範囲」の四角の一辺(km)= 半径 100 km
const SAT_ZOOM = { near: [10, 14], wide: [8, 12] };   // 一緒に保存する衛星写真のズーム

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : out); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

/** 中心から一辺 km の四角(南・西・北・東)。 */
export function bboxAround(c, km = AREA_KM) {
  const dLat = (km / 2) / 111.32;
  const dLng = (km / 2) / (111.32 * Math.cos((c.lat * Math.PI) / 180));
  return [c.lat - dLat, c.lng - dLng, c.lat + dLat, c.lng + dLng];
}

function query(b, wide) {
  const bb = b.map((x) => x.toFixed(5)).join(',');
  if (wide) {
    return `[out:json][timeout:180];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|road|track)$"](${bb});
way["waterway"~"^(river|stream|canal)$"](${bb});
way["natural"="water"](${bb});
node["place"~"^(city|town|village|hamlet|suburb|locality)$"](${bb});
);out geom qt;`;
  }
  return `[out:json][timeout:120];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|track|path|footway|bridleway)$"](${bb});
way["waterway"~"^(river|stream|canal|drain|ditch)$"](${bb});
way["natural"="water"](${bb});
way["building"](${bb});
node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|locality)$"](${bb});
);out geom qt;`;
}

const ROAD_CLASS = {
  motorway: 1, trunk: 1, primary: 1, secondary: 2, tertiary: 2,
  unclassified: 3, residential: 3, living_street: 3, service: 3, road: 3,
  track: 4, path: 5, footway: 5, bridleway: 5
};

/** Overpass の答えを、描画用の軽い形に詰め直す(座標は小数5桁 ≒ 1 m)。 */
export function compact(json) {
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const out = { roads: [], rivers: [], water: [], buildings: [], places: [] };
  for (const el of json.elements || []) {
    const tg = el.tags || {};
    if (el.type === 'node' && tg.place && tg.name) {
      out.places.push({ n: tg.name, t: tg.place, lat: r5(el.lat), lng: r5(el.lon) });
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const c = [];
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of el.geometry) {
      c.push(r5(p.lat), r5(p.lon));
      if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
      if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon;
    }
    const item = { c, b: [r5(s), r5(w), r5(n), r5(e)] };
    if (tg.building) out.buildings.push(item);
    else if (tg.natural === 'water') out.water.push(item);
    else if (tg.waterway) { item.k = tg.waterway === 'river' || tg.waterway === 'canal' ? 1 : 2; out.rivers.push(item); }
    else if (tg.highway) { item.k = ROAD_CLASS[tg.highway] || 3; if (tg.name) item.n = tg.name; out.roads.push(item); }
  }
  // 太い道を後に描く(細い道の上に重ねる)
  out.roads.sort((a, b) => b.k - a.k);
  return out;
}

function count(d) {
  return d.roads.length + d.rivers.length + d.water.length + d.buildings.length + d.places.length;
}

/** 中心にいちばん近い大きめの地名を、保存した地図の名前にする。 */
function areaName(d, c) {
  const rank = { city: 0, town: 1, village: 2, suburb: 3, hamlet: 4, neighbourhood: 5, locality: 6 };
  let best = null;
  let bestScore = Infinity;
  d.places.forEach((p) => {
    const km = Math.hypot(p.lat - c.lat, (p.lng - c.lng) * Math.cos((c.lat * Math.PI) / 180)) * 111.32;
    const score = km + (rank[p.t] ?? 6) * 1.5;
    if (score < bestScore) { best = p; bestScore = score; }
  });
  return best ? best.n : `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
}

/** 保存した地図に使う衛星写真のタイル(z/x/y)。 */
export function satKeys(area, index) {
  const [z0, z1] = SAT_ZOOM[area.kind === 'wide' ? 'wide' : 'near'];
  return tilesFor(area.bbox, z0, z1, index);
}

/** 地図を取り込んで保存する。wide なら一辺 WIDE_KM(建物なし)、そうでなければ一辺 AREA_KM。
 *  onProgress(段階, 済み, 全部):段階は 'osm' と 'sat'。 */
export async function downloadArea(center, { wide = false, onProgress } = {}) {
  const bbox = bboxAround(center, wide ? WIDE_KM : AREA_KM);
  const body = 'data=' + encodeURIComponent(query(bbox, wide));
  if (onProgress) onProgress('osm', 0, 1);
  let json = null;
  let lastErr = null;
  for (const url of ENDPOINTS) {
    // 混んでいると返事が来ないことがある(2026-10-22 の試しで予備の窓口が3分無応答)。90秒で次へ。
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), wide ? 200000 : 90000);
    try {
      const res = await fetch(url, { method: 'POST', body, signal: ctl.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      json = await res.json();
      break;
    } catch (err) { lastErr = err; }
    finally { clearTimeout(timer); }
  }
  if (!json) throw lastErr || new Error('download failed');
  const data = compact(json);
  const area = {
    id: 'a' + Date.now().toString(36),
    kind: wide ? 'wide' : 'near',
    name: areaName(data, center),
    center: { lat: center.lat, lng: center.lng },
    bbox,
    savedAt: Date.now(),
    n: count(data),
    sat: 0,
    data
  };
  // 衛星写真(範囲の中なら)。失敗しても道・川の地図は保存する。
  try {
    const index = await loadIndex();
    const keys = satKeys(area, index);
    if (keys.length) {
      if (onProgress) onProgress('sat', 0, keys.length);
      area.sat = await saveTiles(keys, (d, t) => onProgress && onProgress('sat', d, t));
    }
  } catch (err) { console.warn('imagery', err); }
  await tx('readwrite', (st) => st.put(area));
  return area;
}

export async function listAreas() {
  try { return (await tx('readonly', (st) => st.getAll())) || []; }
  catch { return []; }
}

export function deleteArea(id) {
  return tx('readwrite', (st) => st.delete(id));
}

/** 保存した全部の地図を1つにまとめる(重なった所は二重に描かれるが、見た目は変わらない)。 */
export function mergeAreas(areas) {
  const m = { roads: [], rivers: [], water: [], buildings: [], places: [] };
  areas.forEach((a) => Object.keys(m).forEach((k) => m[k].push(...(a.data[k] || []))));
  m.roads.sort((a, b) => b.k - a.k);
  return areas.length ? m : null;
}
