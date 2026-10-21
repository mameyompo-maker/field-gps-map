/* field_gps_map — 圏外用の簡易地図(canvas に自前で描く)。
 *
 * 衛星写真は無い。方眼(縮尺つき)の上に、登録済みの図形・記録中の図形・現在地を描く。
 * Google の地図はオフライン保存が規約で禁じられているため、圏外ではこれで
 * 「自分がどこにいて、どこまで記録したか」を確かめる。
 * map-google.js と同じ関数の組を返すので、app.js はどちらかを意識しない。
 *
 * 座標は Web メルカトルではなく、表示の中心を基準にした平面(東西 m・南北 m)。
 * 圃場の大きさ(数km以内)なら歪みは無視できる。
 */
import { catColor } from './categories.js';
import { makeLocalProjection, pointInPolygon, distance, centroid } from './geo.js';

export function createSimpleMap(wrapper, { onTap, onFeatureTap, onIdle, onUserMove, view } = {}) {
  const canvas = wrapper.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const cfg = window.FIELD_GPS_CONFIG || {};

  let center = view ? { lat: view.lat, lng: view.lng } : (cfg.defaultCenter || { lat: -14.9, lng: 38.35 });
  // 1px あたりの m。Google のズーム z ≒ 156543*cos(lat)/2^z m/px なので、見た目の縮尺を揃える。
  let mpp = view && view.zoom ? 156543.03 * Math.cos((center.lat * Math.PI) / 180) / 2 ** view.zoom : 2;
  let features = [];
  let draft = null;
  let me = null;
  let highlighted = null;
  let featuresClickable = true;
  let dpr = 1;
  let W = 0, H = 0;
  let raf = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = wrapper.clientWidth || window.innerWidth;
    H = wrapper.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    draw();
  }

  const proj = () => makeLocalProjection(center);
  function toScreen(p, P) {
    const xy = P.toXY(p);
    return { x: W / 2 + xy.x / mpp, y: H / 2 - xy.y / mpp };
  }
  function toLatLng(x, y) {
    return proj().toLatLng({ x: (x - W / 2) * mpp, y: (H / 2 - y) * mpp });
  }

  function niceStep(m) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    return steps.find((s) => s >= m) || 100000;
  }

  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(paint);
  }

  function paint() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(0, 0, W, H);
    const P = proj();

    // 方眼(およそ 90px 間隔になる切りのよい距離)
    const step = niceStep(mpp * 90);
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 1;
    const x0 = Math.floor((-W / 2) * mpp / step) * step;
    const y0 = Math.floor((-H / 2) * mpp / step) * step;
    ctx.beginPath();
    for (let x = x0; x <= (W / 2) * mpp; x += step) { const sx = W / 2 + x / mpp; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = y0; y <= (H / 2) * mpp; y += step) { const sy = H / 2 - y / mpp; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();

    // 登録済みの図形
    const showLabels = mpp < 3;
    features.forEach((f) => {
      const v = f.vertices || [];
      if (!v.length) return;
      const color = catColor(f.category);
      const hl = f.id === highlighted;
      const pts = v.map((p) => toScreen(p, P));
      if (f.kind === 'point' || pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, hl ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = f._pending ? '#f59e0b' : '#fff'; ctx.stroke();
      } else {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (f.kind === 'polygon') {
          ctx.closePath();
          ctx.globalAlpha = hl ? 0.38 : 0.22;
          ctx.fillStyle = color; ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = hl ? 4 : (f.kind === 'line' ? 3 : 2);
        ctx.strokeStyle = f._pending ? '#f59e0b' : (hl ? '#d4a600' : color);
        ctx.stroke();
      }
      if (showLabels && f.name) {
        const c = toScreen(f.center || centroid(v, f.kind), P);
        ctx.font = '600 12px system-ui, sans-serif';
        const w = ctx.measureText(f.name).width;
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.fillRect(c.x - w / 2 - 4, c.y + 8, w + 8, 17);
        ctx.fillStyle = '#202124';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(f.name, c.x, c.y + 16.5);
      }
    });

    // 記録中の図形
    if (draft && draft.vertices && draft.vertices.length) {
      const pts = draft.vertices.map((p) => toScreen(p, P));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (draft.kind === 'polygon' && pts.length >= 3) {
        ctx.closePath();
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#d93025'; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 3; ctx.strokeStyle = '#d93025'; ctx.stroke();
      const stepV = pts.length > 300 ? Math.ceil(pts.length / 150) : 1;
      pts.forEach((p, i) => {
        if (i % stepV && i !== pts.length - 1) return;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = draft.vertices[i].src === 'tap' ? '#ff9800' : '#fff'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#d93025'; ctx.stroke();
      });
    }

    // 現在地(誤差の円つき)
    if (me) {
      const p = toScreen(me, P);
      const r = (me.acc || 0) / mpp;
      if (r > 3) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(26,115,232,.12)'; ctx.fill();
        ctx.strokeStyle = 'rgba(26,115,232,.5)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#1a73e8'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    }

    // 縮尺と方位
    const barM = niceStep(mpp * 100);
    const barPx = barM / mpp;
    // 上のボタン列の下(左上)に置く。下はシートや記録パネルで隠れるため。
    const bx = 14, by = 92;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(bx - 6, by - 20, barPx + 12, 30);
    ctx.strokeStyle = '#202124'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4); ctx.lineTo(bx + barPx, by + 4); ctx.lineTo(bx + barPx, by - 4); ctx.stroke();
    ctx.fillStyle = '#202124'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, bx, by - 7);
    const nx = bx + barPx + 34, ny = by - 4;
    ctx.beginPath(); ctx.moveTo(nx, ny - 14); ctx.lineTo(nx + 8, ny + 6); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx - 8, ny + 6); ctx.closePath();
    ctx.fillStyle = '#d93025'; ctx.fill();
    ctx.fillStyle = '#202124'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 20);
  }

  // ---------------------------------------------------------------- 操作(ドラッグ・ピンチ・ホイール・タップ)
  const pointers = new Map();
  let downInfo = null;
  let pinch = null;

  function emitIdle() {
    if (!onIdle) return;
    onIdle({ lat: center.lat, lng: center.lng, zoom: zoomLevel() });
  }
  function zoomLevel() {
    return Math.log2(156543.03 * Math.cos((center.lat * Math.PI) / 180) / mpp);
  }
  function zoomAt(factor, sx, sy) {
    const before = toLatLng(sx, sy);
    mpp = Math.min(5000, Math.max(0.05, mpp / factor));
    // ズームの中心(指・カーソルの位置)が動かないように中心をずらす
    const after = toLatLng(sx, sy);
    center = { lat: center.lat + (before.lat - after.lat), lng: center.lng + (before.lng - after.lng) };
    draw();
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 1) downInfo = { x: e.offsetX, y: e.offsetY, t: Date.now(), moved: false, center: { ...center } };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mpp };
      if (downInfo) downInfo.moved = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10 && pinch.d > 10) zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.d = d; pinch.mpp = mpp;
      return;
    }
    if (pointers.size === 1 && downInfo) {
      const dx = e.offsetX - prev.x, dy = e.offsetY - prev.y;
      if (Math.hypot(e.offsetX - downInfo.x, e.offsetY - downInfo.y) > 6) downInfo.moved = true;
      if (downInfo.moved) {
        if (onUserMove) onUserMove();
        const c = toLatLng(W / 2 - dx, H / 2 - dy);
        center = c;
        draw();
      }
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && downInfo) {
      if (!downInfo.moved && Date.now() - downInfo.t < 600) handleTap(e.offsetX, e.offsetY);
      else emitIdle();
      downInfo = null;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (onUserMove) onUserMove();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX, e.offsetY);
    clearTimeout(canvas._idleT);
    canvas._idleT = setTimeout(emitIdle, 300);
  }, { passive: false });

  function handleTap(x, y) {
    const ll = toLatLng(x, y);
    if (featuresClickable && onFeatureTap) {
      // 点と線は 18px 以内、多角形は内側。小さいもの(後ろに隠れがち)を優先する。
      const tol = 18 * mpp;
      let hit = null;
      let hitScore = Infinity;
      features.forEach((f) => {
        const v = f.vertices || [];
        if (!v.length) return;
        if (f.kind === 'polygon' && v.length >= 3) {
          if (pointInPolygon(ll, v)) { const s = f.areaM2 || 1e12; if (s < hitScore) { hit = f; hitScore = s; } }
        } else {
          for (let i = 0; i < v.length; i++) {
            const d = distance(ll, v[i]);
            if (d < tol && d < hitScore) { hit = f; hitScore = d; }
          }
        }
      });
      if (hit) { onFeatureTap(hit.id); return; }
    }
    if (onTap) onTap(ll);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    type: 'simple',
    setFeatures(list) { features = list; draw(); },
    setDraft(d) { draft = d ? { kind: d.kind, vertices: d.vertices.slice() } : null; draw(); },
    setMyLocation(fix) { me = fix; draw(); },
    fitPoints(points) {
      const pts = (points || []).filter((p) => p && Number.isFinite(p.lat));
      if (!pts.length) return;
      if (pts.length === 1) { center = { lat: pts[0].lat, lng: pts[0].lng }; mpp = Math.min(mpp, 0.6); draw(); emitIdle(); return; }
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      center = { lat, lng };
      const P = proj();
      let mx = 0, my = 0;
      pts.forEach((p) => { const xy = P.toXY(p); mx = Math.max(mx, Math.abs(xy.x)); my = Math.max(my, Math.abs(xy.y)); });
      mpp = Math.max(0.1, Math.max(mx / (W / 2 - 50), my / (H * 0.3)));
      // 下のシートで隠れるぶん、少し上に寄せる
      center = toLatLng(W / 2, H / 2 + H * 0.18);
      draw(); emitIdle();
    },
    highlight(id) { highlighted = id; draw(); },
    setFeaturesClickable(on) { featuresClickable = on; },
    centerOn(p, zoom) {
      center = { lat: p.lat, lng: p.lng };
      if (zoom) mpp = 156543.03 * Math.cos((center.lat * Math.PI) / 180) / 2 ** zoom;
      draw(); emitIdle();
    },
    zoomBy(d) { zoomAt(d > 0 ? 2 : 0.5, W / 2, H / 2); emitIdle(); },
    getView() { return { lat: center.lat, lng: center.lng, zoom: zoomLevel() }; },
    setMapType() { /* 簡易地図には種類が無い */ },
    whenTilesFail() { /* 簡易地図はタイルを使わない */ },
    resize
  };
}
