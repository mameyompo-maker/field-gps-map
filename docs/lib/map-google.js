/* field_gps_map — Google マップ(Maps JavaScript API)での表示。
 *
 * 電波があるときはこちら(衛星写真の上に圃場を描く)。圏外で Maps API 自体が
 * 読み込めないときは map-simple.js(自前の簡易地図)に切り替える(app.js が判断)。
 *
 * ★ Google の地図タイル・衛星写真をオフライン用に保存してはいけない(利用規約。
 *   レポート第3章)。sw.js は maps.googleapis.com / maps.gstatic.com を一切キャッシュしない。
 *
 * ★ 地図コンテナは CSS の width/height で大きさを与えること(styles.css の .map-layer)。
 *   Maps JS API は position を relative に上書きするので、inset で大きさを作ると高さ0になる。
 */
import { catColor } from './categories.js';
import { centroid } from './geo.js';

const cfg = window.FIELD_GPS_CONFIG || {};
let loadPromise = null;

export function loadMapsApi(timeoutMs = 12000) {
  if (window.google && window.google.maps && window.google.maps.importLibrary) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (!cfg.mapsApiKey) { reject(new Error('no-key')); return; }
    if (!navigator.onLine) { loadPromise = null; reject(new Error('offline')); return; }
    const timer = setTimeout(() => { loadPromise = null; reject(new Error('timeout')); }, timeoutMs);
    window.__fgmMapsReady = () => { clearTimeout(timer); resolve(window.google.maps); };
    // Google が認証エラー(キーの制限違反など)のときに呼ぶ関数。
    window.gm_authFailure = () => {
      window.__fgmMapsAuthFailed = true;
      window.dispatchEvent(new Event('fgm-maps-auth-failed'));
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.mapsApiKey)}` +
      '&libraries=marker&v=weekly&loading=async&callback=__fgmMapsReady';
    s.async = true;
    s.onerror = () => { clearTimeout(timer); loadPromise = null; s.remove(); reject(new Error('load-failed')); };
    document.head.appendChild(s);
  });
  return loadPromise;
}

function toGeoJson(f) {
  const ring = (f.vertices || []).map((v) => [v.lng, v.lat]);
  let geometry;
  if (f.kind === 'polygon' && ring.length >= 3) geometry = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
  else if (f.kind === 'line' && ring.length >= 2) geometry = { type: 'LineString', coordinates: ring };
  else if (ring.length) geometry = { type: 'Point', coordinates: ring[0] };
  else return null;
  return { type: 'Feature', id: f.id, geometry, properties: { kind: f.kind, category: f.category, pending: !!f._pending, name: f.name || '' } };
}

export async function createGoogleMap(container, { onTap, onFeatureTap, onIdle, onUserMove, view } = {}) {
  const maps = await loadMapsApi();
  const { Map: GMap, Circle, Data } = await maps.importLibrary('maps');
  const { AdvancedMarkerElement } = await maps.importLibrary('marker');
  const { LatLngBounds } = await maps.importLibrary('core');

  const map = new GMap(container, {
    center: view ? { lat: view.lat, lng: view.lng } : (cfg.defaultCenter || { lat: -14.9, lng: 38.35 }),
    zoom: view ? view.zoom : (cfg.defaultZoom || 13),
    mapId: cfg.mapId || undefined,
    mapTypeId: (view && view.mapType) || 'hybrid',
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    zoomControl: false, clickableIcons: false, gestureHandling: 'greedy',
    rotateControl: false, tilt: 0
  });

  let highlighted = null;
  let featuresClickable = true;

  // ---------------------------------------------------------------- 登録済みの図形
  const layer = new Data({ map });
  const styleFn = (feat) => {
    const color = catColor(feat.getProperty('category'));
    const hl = feat.getId() === highlighted;
    const pending = feat.getProperty('pending');
    const kind = feat.getProperty('kind');
    if (kind === 'point') {
      return {
        clickable: featuresClickable,
        icon: { path: maps.SymbolPath.CIRCLE, scale: hl ? 9 : 7, fillColor: color, fillOpacity: 1, strokeColor: pending ? '#f59e0b' : '#ffffff', strokeWeight: hl ? 3 : 2 },
        zIndex: hl ? 20 : 10
      };
    }
    return {
      clickable: featuresClickable,
      fillColor: color, fillOpacity: hl ? 0.38 : 0.22,
      strokeColor: pending ? '#f59e0b' : (hl ? '#ffeb3b' : color),
      strokeWeight: hl ? 4 : (kind === 'line' ? 3 : 2),
      zIndex: hl ? 20 : 1
    };
  };
  layer.setStyle(styleFn);
  layer.addListener('click', (e) => { if (onFeatureTap) onFeatureTap(e.feature.getId()); });

  // 名前のラベル(拡大したときだけ出す。数が多いと重いので上限あり)
  const labels = new Map();
  const LABEL_ZOOM = 15;
  const LABEL_MAX = 400;
  function syncLabelsVisibility() {
    const show = map.getZoom() >= LABEL_ZOOM;
    labels.forEach((m) => { m.map = show ? map : null; });
  }

  let lastKey = '';
  function setFeatures(list) {
    // 変化が無ければ作り直さない(onSnapshot はメタデータの変化でも何度も呼ばれる)。
    const key = list.map((f) => `${f.id}:${f.updatedAtMs || 0}:${f._pending ? 1 : 0}:${f.name}:${f.category}`).join('|');
    if (key === lastKey) return;
    lastKey = key;
    layer.forEach((f) => layer.remove(f));
    layer.addGeoJson({ type: 'FeatureCollection', features: list.map(toGeoJson).filter(Boolean) });
    labels.forEach((m) => { m.map = null; });
    labels.clear();
    list.slice(0, LABEL_MAX).forEach((f) => {
      if (!f.name || !f.vertices || !f.vertices.length) return;
      const el = document.createElement('div');
      el.className = 'gm-label';
      el.textContent = f.name;
      const pos = f.center || centroid(f.vertices, f.kind);
      labels.set(f.id, new AdvancedMarkerElement({ position: pos, content: el, zIndex: 0 }));
    });
    syncLabelsVisibility();
  }

  // ---------------------------------------------------------------- 記録中の図形
  const draft = new Data({ map });
  draft.setStyle((feat) => {
    const t = feat.getProperty('t');
    if (t === 'v') return { clickable: false, icon: { path: maps.SymbolPath.CIRCLE, scale: 5, fillColor: feat.getProperty('tap') ? '#ff9800' : '#ffffff', fillOpacity: 1, strokeColor: '#d93025', strokeWeight: 2 }, zIndex: 40 };
    return { clickable: false, fillColor: '#d93025', fillOpacity: 0.18, strokeColor: '#d93025', strokeWeight: 3, zIndex: 30 };
  });
  function setDraft(d) {
    draft.forEach((f) => draft.remove(f));
    if (!d || !d.vertices || !d.vertices.length) return;
    const c = d.vertices.map((v) => [v.lng, v.lat]);
    const feats = [];
    if (d.kind === 'polygon' && c.length >= 3) {
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...c, c[0]]] }, properties: { t: 'poly' } });
    } else if (c.length >= 2) {
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: { t: 'line' } });
    }
    // 歩いて記録した長い軌跡では頂点の丸を間引く(全部描くと重い)。
    const step = c.length > 300 ? Math.ceil(c.length / 150) : 1;
    d.vertices.forEach((v, i) => {
      if (i % step && i !== c.length - 1) return;
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: { t: 'v', tap: v.src === 'tap' } });
    });
    draft.addGeoJson({ type: 'FeatureCollection', features: feats });
  }

  // ---------------------------------------------------------------- 現在地
  let dot = null;
  let accCircle = null;
  function setMyLocation(fix) {
    if (!fix) { if (dot) dot.map = null; if (accCircle) accCircle.setMap(null); return; }
    const pos = { lat: fix.lat, lng: fix.lng };
    if (!dot) {
      const el = document.createElement('div');
      el.className = 'my-dot';
      dot = new AdvancedMarkerElement({ map, position: pos, content: el, zIndex: 50 });
      accCircle = new Circle({ map, center: pos, radius: fix.acc || 0, strokeColor: '#1a73e8', strokeOpacity: 0.5, strokeWeight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, clickable: false });
    } else {
      dot.position = pos; dot.map = map;
      accCircle.setCenter(pos); accCircle.setRadius(fix.acc || 0); accCircle.setMap(map);
    }
  }

  // ---------------------------------------------------------------- 操作
  map.addListener('click', (e) => { if (e.latLng && onTap) onTap({ lat: e.latLng.lat(), lng: e.latLng.lng() }); });
  map.addListener('zoom_changed', syncLabelsVisibility);
  map.addListener('dragstart', () => { if (onUserMove) onUserMove(); });
  map.addListener('idle', () => {
    if (!onIdle) return;
    const c = map.getCenter();
    if (c) onIdle({ lat: c.lat(), lng: c.lng(), zoom: map.getZoom(), mapType: map.getMapTypeId() });
  });

  function fitPoints(points, bottomPx) {
    const pts = (points || []).filter((p) => p && Number.isFinite(p.lat));
    if (!pts.length) return;
    if (pts.length === 1) { map.panTo(pts[0]); map.setZoom(Math.max(map.getZoom(), 18)); return; }
    const b = new LatLngBounds();
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, { top: 70, left: 40, right: 70, bottom: bottomPx == null ? Math.round(window.innerHeight * 0.4) : bottomPx });
  }

  function whenTilesFail(ms, onFail) {
    let loaded = false;
    const once = map.addListener('tilesloaded', () => { loaded = true; once.remove(); });
    setTimeout(() => { if (!loaded || window.__fgmMapsAuthFailed) onFail(); }, ms);
  }

  return {
    type: 'google',
    setFeatures, setDraft, setMyLocation, fitPoints,
    highlight(id) { highlighted = id; layer.setStyle(styleFn); },
    setFeaturesClickable(on) { if (featuresClickable === on) return; featuresClickable = on; layer.setStyle(styleFn); },
    centerOn(p, zoom) { map.panTo(p); if (zoom) map.setZoom(zoom); },
    zoomBy(d) { map.setZoom(map.getZoom() + d); },
    getView() { const c = map.getCenter(); return c ? { lat: c.lat(), lng: c.lng(), zoom: map.getZoom(), mapType: map.getMapTypeId() } : null; },
    setMapType(t) { map.setMapTypeId(t); },
    whenTilesFail,
    resize() { /* Google 側が自動で追従する */ }
  };
}
