/* field_gps_map — 手持ちの衛星写真・空撮写真のファイルを取り込み、圏外の簡易地図に重ねる。
 *
 * 取り込めるもの
 *   - GeoTIFF(.tif/.tiff):ドローンのオルソ画像、購入した衛星写真、QGIS で書き出したもの。
 *     座標系は 緯度経度(EPSG:4326 など)・Web メルカトル(3857)・UTM(WGS84 の 326xx/327xx、Moznet の 3036/3037)。
 *     8 ビットの RGB(透明の帯・nodata 付きも可)と、16 ビットの衛星写真(自動で明るさを調整)。
 *   - KMZ/KML の GroundOverlay(Google Earth・ドローンのソフトが書き出す「画像を地図に貼る」形式)。
 *
 * しくみ
 *   大きな画像をそのまま持つとスマホのメモリが足りないので、512px の小片に切り、粗さの違う段(ピラミッド)を作って
 *   IndexedDB に保存する。描くときは、画面の縮尺に合う段の、画面に入る小片だけを読む。
 *   小片ごとに「左上・右上・左下」の緯度経度を持ち、その3点に合わせて貼る(UTM の画像でも歪まない)。
 *
 * 注意:Google・Esri などの地図サービスの画像を保存したファイルは、規約で使えない。
 *   使ってよいのは、自分たちで撮った空撮、購入した画像、Sentinel-2 などの公開データ。
 */
const DB_NAME = 'fgm-user-imagery';
const CH = 512;                 // 小片の一辺(px)
const MAX_SIDE = 10240;         // いちばん細かい段の長辺の上限(px)。これより大きい画像は縮めて取り込む
const VENDOR = new URL('../vendor/geotiff.js', import.meta.url).href;

// ---------------------------------------------------------------- 保存(IndexedDB)
let dbP = null;
function openDb() {
  if (!dbP) {
    dbP = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('layers', { keyPath: 'id' });
        db.createObjectStore('chunks');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbP;
}
async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function listImagery() {
  try {
    const all = await tx('layers', 'readonly', (s) => reqP(s.getAll()));
    return (all || []).sort((a, b) => a.addedAt - b.addedAt);
  } catch { return []; }
}

export async function deleteImagery(id) {
  const layers = await listImagery();
  const L = layers.find((x) => x.id === id);
  if (!L) return;
  const keys = L.sets.flatMap((s) => s.pieces.map((p) => p.key));
  for (let i = 0; i < keys.length; i += 200) {
    const part = keys.slice(i, i + 200);
    await tx('chunks', 'readwrite', (s) => { part.forEach((k) => s.delete(k)); });
  }
  await tx('layers', 'readwrite', (s) => { s.delete(id); });
  for (const k of keys) { const b = mem.get(k); if (b && b.close) b.close(); mem.delete(k); }
}

// ---------------------------------------------------------------- 座標の変換(画像の座標系 → 緯度経度)
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);

function utmInverse(zone, south) {
  const k0 = 0.9996, ep2 = E2 / (1 - E2);
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  return (x, y) => {
    const X = x - 500000, Y = south ? y - 10000000 : y;
    const M = Y / k0;
    const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const s = Math.sin(p1), c = Math.cos(p1), tn = Math.tan(p1);
    const N1 = A / Math.sqrt(1 - E2 * s * s), T1 = tn * tn, C1 = ep2 * c * c;
    const R1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5, D = X / (N1 * k0);
    const lat = p1 - (N1 * tn / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lng = lng0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
    return [lat * 180 / Math.PI, lng * 180 / Math.PI];
  };
}
const mercInverse = (x, y) => [(2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) * 180 / Math.PI, x / A * 180 / Math.PI];
const geographic = (x, y) => [y, x];

/** GeoTIFF の GeoKeys から「画像の座標 → 緯度経度」の関数を作る。分からない座標系は null。 */
function crsFromGeoKeys(k) {
  const pcs = k.ProjectedCSTypeGeoKey, gcs = k.GeographicTypeGeoKey;
  if (k.GTModelTypeGeoKey === 2 || (!pcs && gcs)) return { fn: geographic, name: `EPSG:${gcs || 4326}` };
  if (pcs === 3857 || pcs === 900913 || pcs === 3785) return { fn: mercInverse, name: 'EPSG:3857' };
  let z = null, south = false;
  if (pcs >= 32601 && pcs <= 32660) z = pcs - 32600;
  else if (pcs >= 32701 && pcs <= 32760) { z = pcs - 32700; south = true; }
  else if (pcs === 3036 || pcs === 3037) { z = pcs - 3000; south = true; }      // Moznet / UTM 36S・37S(WGS84 と 1 m 程度の差)
  else if (pcs === 32767 || !pcs) {
    const p = k.ProjectionGeoKey;
    if (p >= 16001 && p <= 16060) z = p - 16000;
    else if (p >= 16101 && p <= 16160) { z = p - 16100; south = true; }
  }
  if (z) return { fn: utmInverse(z, south), name: `UTM ${z}${south ? 'S' : 'N'}` };
  return null;
}

// ---------------------------------------------------------------- 読み込み口(GeoTIFF)
let gtP = null;
function loadGeoTiffLib() {
  if (window.GeoTIFF) return Promise.resolve(window.GeoTIFF);
  if (!gtP) {
    gtP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = VENDOR;
      s.onload = () => (window.GeoTIFF ? resolve(window.GeoTIFF) : reject(new Error('geotiff')));
      s.onerror = () => { gtP = null; reject(new Error('geotiff')); };
      document.head.appendChild(s);
    });
  }
  return gtP;
}

class ImgError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

async function geotiffSource(file) {
  const GeoTIFF = await loadGeoTiffLib();
  const tiff = await GeoTIFF.fromBlob(file);
  const img = await tiff.getImage(0);
  const W = img.getWidth(), H = img.getHeight();
  const fd = img.fileDirectory;
  const crs = crsFromGeoKeys(img.getGeoKeys() || {});
  if (!crs) throw new ImgError('crs');
  let toModel;
  if (fd.ModelTransformation) {
    const m = fd.ModelTransformation;
    toModel = (px, py) => [m[0] * px + m[1] * py + m[3], m[4] * px + m[5] * py + m[7]];
  } else if (fd.ModelTiepoint && fd.ModelPixelScale) {
    const [I, J, , X0, Y0] = fd.ModelTiepoint, [sx, sy] = fd.ModelPixelScale;
    toModel = (px, py) => [X0 + (px - I) * sx, Y0 - (py - J) * sy];
  } else throw new ImgError('nogeo');
  const toLatLng = (px, py) => { const [x, y] = toModel(px, py); return crs.fn(x, y); };

  const spp = img.getSamplesPerPixel();
  const bps = (fd.BitsPerSample && fd.BitsPerSample[0]) || 8;
  const photometric = fd.PhotometricInterpretation;
  const nodata = img.getGDALNoData();
  const hasAlpha = fd.ExtraSamples ? true : spp === 4 || spp === 2;
  // 16 ビットなどは、縮小した全体から明るさの幅(2〜98%)を決めて 8 ビットへ
  let stretch = null;
  if (bps > 8) {
    const n = Math.min(512, W), m = Math.max(1, Math.round(H * n / W));
    const r = await img.readRasters({ width: n, height: m, samples: [0, Math.min(1, spp - 1), Math.min(2, spp - 1)], interleave: true });
    const vals = [];
    for (let i = 0; i < r.length; i += 3) {
      if (nodata !== null && r[i] === nodata && r[i + 1] === nodata && r[i + 2] === nodata) continue;
      if (r[i] + r[i + 1] + r[i + 2] === 0) continue;
      vals.push(r[i], r[i + 1], r[i + 2]);
    }
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.02)] || 0, hi = vals[Math.floor(vals.length * 0.98)] || 255;
    stretch = { lo, k: 255 / Math.max(1, hi - lo) };
  }

  async function read(x0, y0, x1, y1, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    if (bps <= 8 && photometric !== undefined) {
      const rgb = await img.readRGB({ window: [x0, y0, x1, y1], width: w, height: h, interleave: true, enableAlpha: hasAlpha });
      const step = rgb.length / (w * h);
      for (let i = 0, j = 0; j < out.length; i += step, j += 4) {
        out[j] = rgb[i]; out[j + 1] = rgb[i + 1]; out[j + 2] = rgb[i + 2];
        out[j + 3] = step === 4 ? rgb[i + 3] : 255;
      }
    } else {
      const g = Math.min(1, spp - 1), b = Math.min(2, spp - 1);
      const r = await img.readRasters({ window: [x0, y0, x1, y1], width: w, height: h, samples: [0, g, b], interleave: true });
      for (let i = 0, j = 0; j < out.length; i += 3, j += 4) {
        const s = stretch || { lo: 0, k: 1 };
        out[j] = (r[i] - s.lo) * s.k; out[j + 1] = (r[i + 1] - s.lo) * s.k; out[j + 2] = (r[i + 2] - s.lo) * s.k;
        out[j + 3] = (r[i] + r[i + 1] + r[i + 2] === 0) ? 0 : 255;
      }
    }
    if (nodata !== null && bps <= 8) {
      for (let j = 0; j < out.length; j += 4) if (out[j] === nodata && out[j + 1] === nodata && out[j + 2] === nodata) out[j + 3] = 0;
    }
    return new ImageData(out, w, h);
  }
  return { W, H, toLatLng, read, crs: crs.name };
}

// ---------------------------------------------------------------- 読み込み口(KMZ / KML の GroundOverlay)
async function inflate(data) {
  const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}
/** ZIP の中身(名前 → 取り出す関数)。中央ディレクトリから読むので、サイズが後ろに書かれた ZIP にも対応。 */
function unzipIndex(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new ImgError('zip');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = new Map();
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    files.set(name, async () => {
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = buf.subarray(start, start + csize);
      return method === 8 ? inflate(data) : data;
    });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
const num = (el, tag) => { const x = el && el.getElementsByTagNameNS('*', tag)[0]; return x ? parseFloat(x.textContent) : NaN; };

/** GroundOverlay の4隅(左上・右上・右下・左下の [lat,lng])。 */
function overlayCorners(go) {
  const quad = go.getElementsByTagNameNS('*', 'LatLonQuad')[0];
  if (quad) {
    const c = quad.getElementsByTagNameNS('*', 'coordinates')[0].textContent.trim().split(/\s+/).map((s) => s.split(',').map(Number));
    // KML の順は 左下・右下・右上・左上(lng,lat)
    return [[c[3][1], c[3][0]], [c[2][1], c[2][0]], [c[1][1], c[1][0]], [c[0][1], c[0][0]]];
  }
  const box = go.getElementsByTagNameNS('*', 'LatLonBox')[0];
  const N = num(box, 'north'), S = num(box, 'south'), E = num(box, 'east'), Wl = num(box, 'west');
  if (![N, S, E, Wl].every(Number.isFinite)) return null;
  const rot = (num(box, 'rotation') || 0) * Math.PI / 180;
  const cLat = (N + S) / 2, cLng = (E + Wl) / 2, k = Math.cos(cLat * Math.PI / 180);
  const pts = [[N, Wl], [N, E], [S, E], [S, Wl]];
  if (!rot) return pts;
  // 中心のまわりに反時計回りに回す(経度は cos(緯度) を掛けて距離に揃えてから)
  return pts.map(([la, ln]) => {
    const x = (ln - cLng) * k, y = la - cLat;
    return [cLat + x * Math.sin(rot) + y * Math.cos(rot), cLng + (x * Math.cos(rot) - y * Math.sin(rot)) / k];
  });
}

async function kmzSources(file) {
  const isZip = !/\.kml$/i.test(file.name);
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = isZip ? unzipIndex(buf) : new Map([[file.name, async () => buf]]);
  const sources = [];
  for (const [name, get] of files) {
    if (!/\.kml$/i.test(name)) continue;
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(await get()), 'application/xml');
    const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
    for (const go of xml.getElementsByTagNameNS('*', 'GroundOverlay')) {
      const hrefEl = go.getElementsByTagNameNS('*', 'href')[0];
      const corners = overlayCorners(go);
      if (!hrefEl || !corners) continue;
      let href = hrefEl.textContent.trim().replace(/^\.\//, '');
      const key = files.has(dir + href) ? dir + href : files.has(href) ? href : null;
      if (!key) continue;           // 外のサイトにある画像(http…)は取り込めない
      const bytes = await files.get(key)();
      const type = /\.png$/i.test(key) ? 'image/png' : /\.webp$/i.test(key) ? 'image/webp' : /\.gif$/i.test(key) ? 'image/gif' : 'image/jpeg';
      const bmp = await createImageBitmap(new Blob([bytes], { type }));
      const W = bmp.width, H = bmp.height;
      const [tl, tr, br, bl] = corners;
      const toLatLng = (px, py) => {
        const u = px / W, v = py / H;
        const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
        const bot = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
        return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
      };
      const cv = OffscreenCanvasOr(1, 1);
      const read = async (x0, y0, x1, y1, w, h) => {
        cv.width = w; cv.height = h;
        const c = cv.getContext('2d');
        c.clearRect(0, 0, w, h);
        c.drawImage(bmp, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
        return c.getImageData(0, 0, w, h);
      };
      sources.push({ W, H, toLatLng, read, crs: 'KML', done: () => bmp.close && bmp.close() });
    }
  }
  if (!sources.length) throw new ImgError('nooverlay');
  return sources;
}

function OffscreenCanvasOr(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// ---------------------------------------------------------------- 小片に切って保存
let webpOk = null;
function canWebp() {
  if (webpOk === null) {
    try { const c = document.createElement('canvas'); c.width = c.height = 1; webpOk = c.toDataURL('image/webp').startsWith('data:image/webp'); }
    catch { webpOk = false; }
  }
  return webpOk;
}
function encode(canvas, transparent) {
  const type = canWebp() ? 'image/webp' : transparent ? 'image/png' : 'image/jpeg';
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality: 0.82 });
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.82));
}
function hasTransparency(id) {
  const d = id.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}
function isEmpty(id) {
  const d = id.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
}
const dist = (a, b) => {
  const k = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * k);
};

/** 1つの画像(source)を段ごとの小片にして保存する。返り値は描画用の情報(set)。 */
async function buildSet(src, id, si, onPiece) {
  const f0 = Math.max(1, Math.max(src.W, src.H) / MAX_SIDE);
  const res0 = dist(src.toLatLng(0, src.H / 2), src.toLatLng(src.W, src.H / 2)) / src.W;   // 元の1画素の大きさ(m)
  const levels = [];
  let w = Math.ceil(src.W / f0), h = Math.ceil(src.H / f0);
  for (let k = 0; ; k++) {
    levels.push({ k, f: f0 * 2 ** k, w, h, nx: Math.ceil(w / CH), ny: Math.ceil(h / CH) });
    if (w <= CH && h <= CH) break;
    w = Math.ceil(w / 2); h = Math.ceil(h / 2);
  }
  const total = levels.reduce((s, L) => s + L.nx * L.ny, 0);
  const pieces = [];
  const canvas = OffscreenCanvasOr(CH, CH);
  const ctx = canvas.getContext('2d');
  let prev = new Map();          // 一つ前(細かい)の段の小片(key → Blob)。次の段はこれを縮めて作る
  for (const L of levels) {
    const cur = new Map();
    for (let cy = 0; cy < L.ny; cy++) {
      // いちばん細かい段は、横に並ぶ小片をまとめて読む(TIFF の横長の縞を何度も解かないため)。
      // 一度に読む元画像は約 1,600 万画素まで(スマホのメモリ)。
      let band = null, bandX0 = -1, bandN = 0;
      const rowsSrc = CH * L.f;
      const perRead = Math.max(1, Math.floor(16e6 / (rowsSrc * CH * L.f)));
      for (let cx = 0; cx < L.nx; cx++) {
        if (L.k === 0 && (band === null || cx >= bandX0 + bandN)) {
          bandX0 = cx;
          bandN = Math.min(perRead, L.nx - cx);
          const bw = Math.min(bandN * CH, L.w - cx * CH), bh = Math.min(CH, L.h - cy * CH);
          const bx0 = cx * CH * L.f, by0 = cy * CH * L.f;
          band = await src.read(Math.floor(bx0), Math.floor(by0), Math.ceil(Math.min(src.W, bx0 + bw * L.f)), Math.ceil(Math.min(src.H, by0 + bh * L.f)), bw, bh);
        }
        const pw = Math.min(CH, L.w - cx * CH), ph = Math.min(CH, L.h - cy * CH);
        // この小片が元の画像のどこか(元の画素)
        const sx0 = cx * CH * L.f, sy0 = cy * CH * L.f;
        const sx1 = Math.min(src.W, sx0 + pw * L.f), sy1 = Math.min(src.H, sy0 + ph * L.f);
        canvas.width = pw; canvas.height = ph;
        ctx.clearRect(0, 0, pw, ph);
        if (L.k === 0) {
          ctx.putImageData(band, -(cx - bandX0) * CH, 0);
        } else {
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const blob = prev.get(`${cx * 2 + dx}/${cy * 2 + dy}`);
            if (!blob) continue;
            const bmp = await createImageBitmap(blob);
            ctx.drawImage(bmp, dx * CH / 2, dy * CH / 2, bmp.width / 2, bmp.height / 2);
            bmp.close && bmp.close();
          }
        }
        const data = ctx.getImageData(0, 0, pw, ph);
        if (!isEmpty(data)) {
          const blob = await encode(canvas, hasTransparency(data));
          const key = `${id}/${si}/${L.k}/${cx}/${cy}`;
          cur.set(`${cx}/${cy}`, blob);
          await tx('chunks', 'readwrite', (s) => { s.put(blob, key); });
          const tl = src.toLatLng(sx0, sy0), tr = src.toLatLng(sx1, sy0), bl = src.toLatLng(sx0, sy1);
          pieces.push({ k: L.k, w: pw, h: ph, c: [...tl, ...tr, ...bl], key, bytes: blob.size });
        }
        onPiece(total);
      }
    }
    prev = cur;
  }
  const corners = [src.toLatLng(0, 0), src.toLatLng(src.W, 0), src.toLatLng(src.W, src.H), src.toLatLng(0, src.H)];
  return { res0, r0: res0 * f0, maxK: levels.length - 1, pieces, corners };
}

/** ファイルを取り込む。onProgress(done, total)。返り値は保存した layer。 */
export async function importImagery(file, onProgress) {
  const name = file.name.replace(/\.(tiff?|kmz|kml)$/i, '');
  let sources;
  if (/\.tiff?$/i.test(file.name)) sources = [await geotiffSource(file)];
  else if (/\.(kmz|kml)$/i.test(file.name)) sources = await kmzSources(file);
  else throw new ImgError('format');

  const id = `img-${Date.now().toString(36)}`;
  const sets = [];
  let done = 0, grand = 0;
  const totals = new Array(sources.length).fill(0);
  try {
    for (let i = 0; i < sources.length; i++) {
      const set = await buildSet(sources[i], id, i, (total) => {
        if (!totals[i]) { totals[i] = total; grand += total; }
        done++;
        if (onProgress && (done % 4 === 0 || done === grand)) onProgress(done, grand + (sources.length - i - 1) * total);
      });
      if (sources[i].done) sources[i].done();
      if (set.pieces.length) sets.push(set);
    }
  } catch (err) {
    // 途中で失敗したら、保存しかけた小片を消す
    await tx('chunks', 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`))).catch(() => {});
    throw err;
  }
  if (!sets.length) throw new ImgError('empty');
  const all = sets.flatMap((s) => s.corners);
  const lats = all.map((p) => p[0]), lngs = all.map((p) => p[1]);
  const bbox = [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)];
  sets.sort((a, b) => b.res0 - a.res0);      // 粗い画像を先に(下に)描く
  const layer = {
    id, name, file: file.name, addedAt: Date.now(), bbox,
    center: { lat: (bbox[0] + bbox[2]) / 2, lng: (bbox[1] + bbox[3]) / 2 },
    res: Math.min(...sets.map((s) => s.r0)), crs: sources[0].crs,
    bytes: sets.reduce((s, x) => s + x.pieces.reduce((a, p) => a + p.bytes, 0), 0),
    sets
  };
  await tx('layers', 'readwrite', (s) => { s.put(layer); });
  return layer;
}

// ---------------------------------------------------------------- 描画(map-simple.js から)
const mem = new Map();      // key → ImageBitmap | 'loading' | null
const MEM_MAX = 90;
function getPiece(key, onLoad) {
  const v = mem.get(key);
  if (v !== undefined) {
    if (v && v !== 'loading') { mem.delete(key); mem.set(key, v); }
    return v === 'loading' ? null : v;
  }
  mem.set(key, 'loading');
  tx('chunks', 'readonly', (s) => reqP(s.get(key)))
    .then((blob) => (blob ? createImageBitmap(blob) : null))
    .then((bmp) => {
      mem.set(key, bmp);
      while (mem.size > MEM_MAX) {
        const first = mem.keys().next().value;
        const old = mem.get(first);
        if (old && old.close) old.close();
        mem.delete(first);
      }
      if (bmp) onLoad();
    })
    .catch(() => mem.set(key, null));
  return null;
}

/** 取り込んだ画像を描く。v = { center, mpp, W, H, dpr }。描いた画像の名前を返す(出典の表示用)。 */
export function paintUserImagery(ctx, layers, v, redraw) {
  const R = 6378137;
  const ky = (Math.PI / 180) * R / v.mpp, kx = ky * Math.cos((v.center.lat * Math.PI) / 180);
  const sx = (la, ln) => v.W / 2 + (ln - v.center.lng) * kx;
  const sy = (la) => v.H / 2 - (la - v.center.lat) * ky;
  const drawn = [];
  let budget = 160;
  for (const L of layers) {
    // 画面に入っていなければ飛ばす
    const tlx = sx(0, L.bbox[1]), brx = sx(0, L.bbox[3]), tly = sy(L.bbox[2]), bry = sy(L.bbox[0]);
    if (brx < 0 || tlx > v.W || bry < 0 || tly > v.H) continue;
    let any = false;
    for (const s of L.sets) {
      // 画面の1画素(実際の画素)に合う段
      const want = (v.mpp / v.dpr) * 1.3;
      const k = Math.max(0, Math.min(s.maxK, Math.floor(Math.log2(want / s.r0))));
      for (const kk of k === s.maxK ? [k] : [s.maxK, k]) {        // まず全体(粗い段)、その上に細かい段
        for (const p of s.pieces) {
          if (p.k !== kk) continue;
          const c = p.c;
          const ax = sx(c[0], c[1]), ay = sy(c[0]), bx = sx(c[2], c[3]), by = sy(c[2]), cx = sx(c[4], c[5]), cy = sy(c[4]);
          const dx = bx + cx - ax, dy = by + cy - ay;
          if (Math.max(ax, bx, cx, dx) < 0 || Math.min(ax, bx, cx, dx) > v.W || Math.max(ay, by, cy, dy) < 0 || Math.min(ay, by, cy, dy) > v.H) continue;
          if (budget-- <= 0) break;
          const bmp = getPiece(p.key, redraw);
          if (!bmp) continue;
          // 0.5px 広げて小片のすき間を消す
          const gx = 0.5 / p.w, gy = 0.5 / p.h;
          ctx.save();
          ctx.transform((bx - ax) / p.w * (1 + gx * 2), (by - ay) / p.w * (1 + gx * 2), (cx - ax) / p.h * (1 + gy * 2), (cy - ay) / p.h * (1 + gy * 2),
            ax - (bx - ax) * gx - (cx - ax) * gy, ay - (by - ay) * gx - (cy - ay) * gy);
          ctx.drawImage(bmp, 0, 0);
          ctx.restore();
          any = true;
        }
      }
    }
    if (any) drawn.push(L.name);
  }
  return drawn;
}

export function forgetPieces() {
  for (const [, b] of mem) if (b && b.close) b.close();
  mem.clear();
}
