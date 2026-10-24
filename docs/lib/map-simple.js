/* field_gps_map — 地図(canvas に自前で描く)。v2.0.0 からはこれがただ1つの地図(Google マップは使わない)。
 *
 * 下から順に:高画質の衛星写真(Sentinel-2。lib/imagery.js、範囲は目録の全部)→ 手持ちの画像ファイル →
 * 道・川・池・建物・地名(OpenStreetMap。範囲全体の分と「この辺りを保存」の分)→ 行政境界と名前
 * (郡・行政ポスト・localidade。OCHA/INE COD-AB)→ 登録済みの図形 → 記録中の図形 → 現在地。
 * 電波があってもなくても同じ地図。入っていないタイルは、電波があればその場で取りに行く。
 *
 * 座標は Web メルカトルではなく、表示の中心を基準にした平面(東西 m・南北 m)。
 * 圃場の大きさ(数km以内)なら歪みは無視できる。
 */
import { catColor } from './categories.js';
import { makeLocalProjection, pointInPolygon, distance, centroid } from './geo.js';
import { getTile, ATTRIBUTION as SAT_CREDIT } from './imagery.js';
const ADMIN_CREDIT = 'Limites: OCHA/INE COD-AB';
import { paintUserImagery } from './user-imagery.js';

export function createSimpleMap(wrapper, { onTap, onFeatureTap, onIdle, onUserMove, view } = {}) {
  const canvas = wrapper.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const cfg = window.FIELD_GPS_CONFIG || {};

  let center = view ? { lat: view.lat, lng: view.lng } : (cfg.defaultCenter || { lat: -14.9, lng: 38.35 });
  // 1px あたりの m。Google のズーム z ≒ 156543*cos(lat)/2^z m/px なので、見た目の縮尺を揃える。
  let mpp = view && view.zoom ? 156543.03 * Math.cos((center.lat * Math.PI) / 180) / 2 ** view.zoom : 2;
  let features = [];
  let basemap = null;       // 保存した OpenStreetMap の地図(offline-map.js の mergeAreas の形)
  let regions = [];         // 衛星写真の範囲(imagery.js の目録)。タイルは getTile で受け取る
  let showSat = true;       // 衛星写真を描くか(地図ボタンで切り替え)
  let admin = [];           // 行政境界 [{lines, labels}](lines には b = 範囲 を足しておく)
  let sat = false;          // いま衛星写真を描いたか
  let userLayers = [];      // 取り込んだ写真ファイル(user-imagery.js)
  let userDrawn = [];
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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const P = proj();
    const s2 = showSat ? paintImagery() : false;
    sat = s2;
    userDrawn = userLayers.length ? paintUserImagery(ctx, userLayers, { center, mpp, W, H, dpr }, draw) : [];
    if (userDrawn.length) sat = true;

    // 方眼(およそ 90px 間隔になる切りのよい距離)。衛星写真の上には引かない。
    const step = niceStep(mpp * 90);
    ctx.strokeStyle = sat ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,.08)';
    ctx.lineWidth = 1;
    const x0 = Math.floor((-W / 2) * mpp / step) * step;
    const y0 = Math.floor((-H / 2) * mpp / step) * step;
    ctx.beginPath();
    for (let x = x0; x <= (W / 2) * mpp; x += step) { const sx = W / 2 + x / mpp; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = y0; y <= (H / 2) * mpp; y += step) { const sy = H / 2 - y / mpp; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();

    if (basemap) paintBasemap();
    if (admin.length) paintAdmin();

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
    const credits = [];
    if (basemap) credits.push('© OpenStreetMap contributors');
    if (s2) credits.push(SAT_CREDIT);
    if (admin.length) credits.push(ADMIN_CREDIT);
    userDrawn.slice(0, 2).forEach((n) => credits.push(n));
    if (credits.length) {
      ctx.font = '500 10px system-ui, sans-serif'; ctx.textAlign = 'left';
      credits.forEach((c, i) => {
        const y = by + 22 + i * 13;
        if (sat) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(c, bx, y); }
        ctx.fillStyle = 'rgba(32,33,36,.85)'; ctx.fillText(c, bx, y);
      });
    }
  }

  // ---------------------------------------------------------------- 保存した衛星写真(Sentinel-2)
  // 画面の縮尺に近いズームのタイルを描く。まだ無いタイルは、1つ上(粗い)のタイルを拡大して埋める。
  function paintImagery() {
    let drew = false;
    regions.forEach((r) => { if (paintRegion(r)) drew = true; });
    return drew;
  }

  function paintRegion(imagery) {
    const lat0 = center.lat, lng0 = center.lng;
    const cosl = Math.cos((lat0 * Math.PI) / 180);
    const half = (Math.max(W, H) / 2 + 20) * mpp;
    const dLat = half / 111320, dLng = half / (111320 * cosl);
    const [iw, is, ie, inn] = imagery.bbox;
    const S = Math.max(lat0 - dLat, is), N = Math.min(lat0 + dLat, inn);
    const Wl = Math.max(lng0 - dLng, iw), E = Math.min(lng0 + dLng, ie);
    if (S >= N || Wl >= E) return false;
    // 画面の細かさに合うズーム。最も細かいズームより寄ったら、そのタイルをなめらかに拡大する。
    const z = Math.max(imagery.minzoom, Math.min(imagery.maxzoom, Math.round(zoomLevel() + 0.3)));
    const n = 2 ** z;
    const tx = (lng) => ((lng + 180) / 360) * n;
    const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
    const x0 = Math.floor(tx(Wl)), x1 = Math.floor(tx(E)), y0 = Math.floor(ty(N)), y1 = Math.floor(ty(S));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 300) return false;
    const R = 6378137;
    const ky = (Math.PI / 180) * R / mpp, kx = ky * cosl;
    const lngOf = (x, zz) => (x / 2 ** zz) * 360 - 180;
    const latOf = (y, zz) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / 2 ** zz));
    let drew = false;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        // 端は四捨五入で隣のタイルとぴったり接する(floor/ceil で 1px 重ねると、タイルが 257px に引き伸ばされて
        // 下端・右端で中身が約 1px ずれ、継ぎ目の線に見えた。10/24)
        const L = Math.round(W / 2 + (lngOf(x, z) - lng0) * kx), Rr = Math.round(W / 2 + (lngOf(x + 1, z) - lng0) * kx);
        const T = Math.round(H / 2 - (latOf(y, z) - lat0) * ky), B = Math.round(H / 2 - (latOf(y + 1, z) - lat0) * ky);
        // まだ無いタイルは、粗いズームのタイルを拡大して埋める
        for (let d = 0; z - d >= imagery.minzoom; d++) {
          const pz = z - d, px = x >> d, py = y >> d;
          const bmp = getTile(imagery.base, `${pz}/${px}/${py}`, draw);
          if (!bmp) continue;
          const size = 256 / 2 ** d;
          ctx.drawImage(bmp, (x - (px << d)) * size, (y - (py << d)) * size, size, size, L, T, Rr - L, B - T);
          drew = true;
          break;
        }
      }
    }
    return drew;
  }

  // ---------------------------------------------------------------- 行政境界(郡・行政ポスト・localidade)と名前
  // 衛星写真の上では白い線に暗い縁取り(Monapo の印刷用地図と同じ)。名前は寄るほど細かい段まで出す。
  function paintAdmin() {
    const R = 6378137;
    const ky = (Math.PI / 180) * R / mpp;
    const kx = ky * Math.cos((center.lat * Math.PI) / 180);
    const cx = W / 2, cy = H / 2, lat0 = center.lat, lng0 = center.lng;
    const half = (Math.max(W, H) / 2 + 40) * mpp;
    const dLat = half / 111320, dLng = half / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const S = lat0 - dLat, N = lat0 + dLat, Wl = lng0 - dLng, E = lng0 + dLng;
    const zl = zoomLevel();
    const fg = sat ? '#ffffff' : '#7b4fa8';
    const halo = sat ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)';
    const style = { 2: { w: 2.6, dash: [] }, 3: { w: 1.8, dash: [10, 5] }, 4: { w: 1.2, dash: [5, 4] } };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    [4, 3, 2].forEach((lv) => {
      if (lv === 4 && zl < 9.5) return;
      ctx.beginPath();
      admin.forEach((a) => a.lines.forEach((it) => {
        if (it.l !== lv || it.b[0] > N || it.b[2] < S || it.b[1] > E || it.b[3] < Wl) return;
        const c = it.c;
        ctx.moveTo(cx + (c[1] - lng0) * kx, cy - (c[0] - lat0) * ky);
        for (let i = 2; i < c.length; i += 2) ctx.lineTo(cx + (c[i + 1] - lng0) * kx, cy - (c[i] - lat0) * ky);
      }));
      const st = style[lv];
      ctx.setLineDash([]); ctx.lineWidth = st.w + 2; ctx.strokeStyle = halo; ctx.stroke();
      ctx.setLineDash(st.dash); ctx.lineWidth = st.w; ctx.strokeStyle = fg; ctx.stroke();
    });
    ctx.setLineDash([]);
    // 名前:郡はズーム 7.5〜11、行政ポストは 9.5〜13.5、localidade は 10.5 から
    const show = { 2: [7.5, 11], 3: [9.5, 13.5], 4: [10.5, 99] };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    admin.forEach((a) => a.labels.forEach((p) => {
      const [z0, z1] = show[p.l];
      if (zl < z0 || zl > z1) return;
      if (p.lat < S || p.lat > N || p.lng < Wl || p.lng > E) return;
      const x = cx + (p.lng - lng0) * kx, y = cy - (p.lat - lat0) * ky;
      const big = p.l === 2 ? 16 : p.l === 3 ? 14 : 13;
      ctx.font = `${p.l === 4 ? 700 : 800} ${big}px system-ui, sans-serif`;
      const txt = p.l === 4 ? p.n : p.n.toUpperCase();
      ctx.lineWidth = 4; ctx.strokeStyle = sat ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.95)'; ctx.strokeText(txt, x, y);
      ctx.fillStyle = sat ? '#ffffff' : '#4b2c6b'; ctx.fillText(txt, x, y);
    }));
  }

  // ---------------------------------------------------------------- 保存した OpenStreetMap の地図
  // 1点ごとに関数を呼ぶと重いので、中心からの差に係数を掛けるだけの式で画面の座標にする。
  function paintBasemap() {
    const R = 6378137;
    const ky = (Math.PI / 180) * R / mpp;
    const kx = ky * Math.cos((center.lat * Math.PI) / 180);
    const cx = W / 2, cy = H / 2, lat0 = center.lat, lng0 = center.lng;
    // 画面に入っている範囲(少し広め)
    const half = (Math.max(W, H) / 2 + 40) * mpp;
    const dLat = half / 111320, dLng = half / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const S = lat0 - dLat, N = lat0 + dLat, Wl = lng0 - dLng, E = lng0 + dLng;
    const inView = (b) => b[0] <= N && b[2] >= S && b[1] <= E && b[3] >= Wl;
    const path = (c, close) => {
      ctx.moveTo(cx + (c[1] - lng0) * kx, cy - (c[0] - lat0) * ky);
      for (let i = 2; i < c.length; i += 2) ctx.lineTo(cx + (c[i + 1] - lng0) * kx, cy - (c[i] - lat0) * ky);
      if (close) ctx.closePath();
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // 池・湖
    ctx.beginPath();
    basemap.water.forEach((it) => { if (inView(it.b)) path(it.c, true); });
    if (!sat) { ctx.fillStyle = '#b5d3f0'; ctx.fill(); }

    // 川(大きい川は太く)
    [[1, 4], [2, 1.6]].forEach(([k, w]) => {
      ctx.beginPath();
      basemap.rivers.forEach((it) => { if (it.k === k && inView(it.b)) path(it.c, false); });
      ctx.lineWidth = Math.max(w, k === 1 ? 12 / mpp : 3 / mpp); ctx.strokeStyle = sat ? '#4fb3ff' : '#6fa8dc'; ctx.stroke();
    });

    // 建物(寄って見たときだけ。遠くからは点の集まりになって見づらい)
    if (mpp < 6) {
      ctx.beginPath();
      basemap.buildings.forEach((it) => { if (inView(it.b)) path(it.c, true); });
      if (sat) {
        // 衛星写真の上では塗らずに縁だけ(屋根が見えるように)
        if (mpp < 3) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,240,200,.8)'; ctx.stroke(); }
      } else {
        ctx.fillStyle = '#d9cbb7'; ctx.fill();
        if (mpp < 1.5) { ctx.lineWidth = 1; ctx.strokeStyle = '#bba98f'; ctx.stroke(); }
      }
    }

    // 道(太い道ほど後に描いて上に重ねる)。小道は寄ったときだけ。
    // 衛星写真の上では、主要道路は黄色・ほかの道は白に暗い縁取り(Monapo の印刷用地図と同じ配色)
    const roadStyle = sat ? {
      1: { w: 3.5, fill: '#ffd54a', edge: 'rgba(40,25,0,.7)' },
      2: { w: 2.6, fill: '#fff3c4', edge: 'rgba(0,0,0,.5)' },
      3: { w: 1.8, fill: '#ffffff', edge: 'rgba(0,0,0,.45)' },
      4: { w: 1.3, fill: 'rgba(255,255,255,.85)', dash: [6, 4] },
      5: { w: 1, fill: 'rgba(255,255,255,.75)', dash: [2, 4] }
    } : {
      1: { w: 6, fill: '#f7c86a', edge: '#d39a2b' },
      2: { w: 5, fill: '#ffffff', edge: '#c9b99a' },
      3: { w: 3.5, fill: '#ffffff', edge: '#c9b99a' },
      4: { w: 2, fill: '#9b7d55', dash: [6, 4] },
      5: { w: 1.2, fill: '#9b7d55', dash: [2, 4] }
    };
    [5, 4, 3, 2, 1].forEach((k) => {
      if (k === 5 && mpp > 4) return;
      if (k >= 3 && mpp > 25) return;
      const st = roadStyle[k];
      ctx.beginPath();
      basemap.roads.forEach((it) => { if (it.k === k && inView(it.b)) path(it.c, false); });
      if (st.edge) { ctx.setLineDash([]); ctx.lineWidth = st.w + 2; ctx.strokeStyle = st.edge; ctx.stroke(); }
      ctx.setLineDash(st.dash || []);
      ctx.lineWidth = st.w; ctx.strokeStyle = st.fill; ctx.stroke();
    });
    ctx.setLineDash([]);

    // 地名(大きな町は遠くからでも、小さな集落は寄ったときだけ)
    const minMpp = { city: 400, town: 120, village: 40, suburb: 15, hamlet: 12, neighbourhood: 6, locality: 6 };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    basemap.places.forEach((p) => {
      if (mpp > (minMpp[p.t] || 6)) return;
      if (p.lat < S || p.lat > N || p.lng < Wl || p.lng > E) return;
      const x = cx + (p.lng - lng0) * kx, y = cy - (p.lat - lat0) * ky;
      const big = p.t === 'city' || p.t === 'town';
      ctx.font = `${big ? 800 : 700} ${big ? 15 : 12.5}px system-ui, sans-serif`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = sat ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.95)'; ctx.strokeText(p.n, x, y);
      ctx.fillStyle = sat ? '#fff8e1' : '#4a3b2a'; ctx.fillText(p.n, x, y);
    });
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
    setBasemap(m) { basemap = m; draw(); },
    setImagery(cat) { regions = (cat && cat.regions) || []; draw(); },
    setSatellite(on) { showSat = !!on; draw(); },
    setAdmin(list) {
      admin = (list || []).map((a) => ({
        labels: a.labels || [],
        lines: (a.lines || []).map((it) => {
          let s = 90, w = 180, n = -90, e = -180;
          for (let i = 0; i < it.c.length; i += 2) {
            const la = it.c[i], lo = it.c[i + 1];
            if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo;
          }
          return { l: it.l, c: it.c, b: [s, w, n, e] };
        })
      }));
      draw();
    },
    setUserImagery(list) { userLayers = list || []; draw(); },
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
    resize
  };
}
