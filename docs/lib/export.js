/* field_gps_map — 書き出し(KML / GeoJSON / CSV / ZIP)と読み込み(KML / GeoJSON)。
 *
 * KML には多角形をそのまま入れる(KoboToolbox の KML は多角形が入らない、という
 * 2つ目のレポートの指摘への答え)。Google マイマップ・Google Earth・QGIS で開ける。
 * CSV は BOM 付き UTF-8(無いと日本語版 Excel が文字化けする)。WKT 列も付けるので
 * QGIS の「区切りテキスト」でそのまま図形として読める。
 */
import { catColor } from './categories.js';
import { createZip } from './zip.js';
import { polygonArea, pathLength, centroid } from './geo.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

// KML の色は aabbggrr
function kmlColor(hex, alpha) {
  const h = hex.replace('#', '');
  return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
}

function coordsText(vs, close) {
  const list = vs.map((v) => `${v.lng.toFixed(7)},${v.lat.toFixed(7)},0`);
  if (close && vs.length) list.push(list[0]);
  return list.join(' ');
}

export function toKML(features, { title = 'Field GPS Map', catName = (k) => k } = {}) {
  const cats = [...new Set(features.map((f) => f.category || 'other'))];
  const styles = cats.map((c) => {
    const col = catColor(c);
    return `<Style id="c-${esc(c)}"><LineStyle><color>${kmlColor(col, 'ff')}</color><width>3</width></LineStyle>` +
      `<PolyStyle><color>${kmlColor(col, '55')}</color></PolyStyle>` +
      `<IconStyle><color>${kmlColor(col, 'ff')}</color><scale>1.0</scale></IconStyle></Style>`;
  }).join('\n');
  const marks = features.map((f) => {
    const v = f.vertices || [];
    let geom = '';
    if (f.kind === 'polygon' && v.length >= 3) {
      geom = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsText(v, true)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    } else if (f.kind === 'line' && v.length >= 2) {
      geom = `<LineString><tessellate>1</tessellate><coordinates>${coordsText(v, false)}</coordinates></LineString>`;
    } else if (v.length) {
      geom = `<Point><coordinates>${coordsText([v[0]], false)}</coordinates></Point>`;
    }
    const data = {
      category: catName(f.category || 'other'),
      group: f.group || '',
      area_ha: f.areaM2 != null ? (f.areaM2 / 10000).toFixed(4) : '',
      area_m2: f.areaM2 != null ? Math.round(f.areaM2) : '',
      length_m: f.lengthM != null ? Math.round(f.lengthM) : '',
      method: f.method || '',
      accuracy_median_m: f.accMedian != null ? f.accMedian : '',
      recorded_by: (f.createdBy && (f.createdBy.name || f.createdBy.email)) || '',
      recorded_at: iso(f.createdAtMs || f.clientCreatedAt),
      notes: f.notes || '',
      id: f.id
    };
    const ext = Object.entries(data).map(([k, val]) => `<Data name="${k}"><value>${esc(val)}</value></Data>`).join('');
    const desc = [
      data.area_ha && `${data.area_ha} ha`, data.length_m && `${data.length_m} m`,
      data.group, data.recorded_by, data.recorded_at.slice(0, 10), data.notes
    ].filter(Boolean).join(' | ');
    return `<Placemark><name>${esc(f.name || '')}</name><description>${esc(desc)}</description>` +
      `<styleUrl>#c-${esc(f.category || 'other')}</styleUrl><ExtendedData>${ext}</ExtendedData>${geom}</Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>\n${styles}\n${marks}\n</Document></kml>\n`;
}

export function toGeoJSON(features) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: features.map((f) => {
      const c = (f.vertices || []).map((v) => [Number(v.lng.toFixed(7)), Number(v.lat.toFixed(7))]);
      let geometry = null;
      if (f.kind === 'polygon' && c.length >= 3) geometry = { type: 'Polygon', coordinates: [[...c, c[0]]] };
      else if (f.kind === 'line' && c.length >= 2) geometry = { type: 'LineString', coordinates: c };
      else if (c.length) geometry = { type: 'Point', coordinates: c[0] };
      return {
        type: 'Feature', id: f.id, geometry,
        properties: {
          id: f.id, name: f.name || '', kind: f.kind, category: f.category || '', group: f.group || '',
          area_m2: f.areaM2 != null ? Math.round(f.areaM2 * 10) / 10 : null,
          area_ha: f.areaM2 != null ? Math.round(f.areaM2) / 10000 : null,
          length_m: f.lengthM != null ? Math.round(f.lengthM * 10) / 10 : null,
          method: f.method || '', n_vertices: (f.vertices || []).length,
          accuracy_median_m: f.accMedian != null ? f.accMedian : null,
          accuracy_max_m: f.accMax != null ? f.accMax : null,
          recorded_by: (f.createdBy && f.createdBy.email) || '',
          recorded_by_name: (f.createdBy && f.createdBy.name) || '',
          recorded_at: iso(f.createdAtMs || f.clientCreatedAt),
          notes: f.notes || ''
        }
      };
    })
  }, null, 1);
}

function wkt(f) {
  const v = f.vertices || [];
  const pts = (arr) => arr.map((p) => `${p.lng.toFixed(7)} ${p.lat.toFixed(7)}`).join(', ');
  if (f.kind === 'polygon' && v.length >= 3) return `POLYGON((${pts([...v, v[0]])}))`;
  if (f.kind === 'line' && v.length >= 2) return `LINESTRING(${pts(v)})`;
  if (v.length) return `POINT(${pts([v[0]])})`;
  return '';
}

export function toCSV(features, { catName = (k) => k } = {}) {
  const head = ['id', 'name', 'kind', 'category', 'group', 'area_ha', 'area_m2', 'length_m', 'center_lat', 'center_lng',
    'n_vertices', 'accuracy_median_m', 'accuracy_max_m', 'method', 'recorded_by', 'recorded_by_email', 'recorded_at', 'notes', 'wkt'];
  const q = (s) => {
    const t = String(s == null ? '' : s);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = features.map((f) => {
    const c = f.center || centroid(f.vertices || [], f.kind) || {};
    return [
      f.id, f.name, f.kind, catName(f.category || 'other'), f.group,
      f.areaM2 != null ? (f.areaM2 / 10000).toFixed(4) : '', f.areaM2 != null ? Math.round(f.areaM2) : '',
      f.lengthM != null ? Math.round(f.lengthM * 10) / 10 : '',
      c.lat != null ? c.lat.toFixed(7) : '', c.lng != null ? c.lng.toFixed(7) : '',
      (f.vertices || []).length, f.accMedian, f.accMax, f.method,
      f.createdBy && f.createdBy.name, f.createdBy && f.createdBy.email,
      iso(f.createdAtMs || f.clientCreatedAt), f.notes, wkt(f)
    ].map(q).join(',');
  });
  return '﻿' + [head.join(','), ...rows].join('\r\n') + '\r\n';
}

export function download(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function toZip(features, opts, readme) {
  const zip = createZip();
  await zip.add('field_gps_map.kml', toKML(features, opts));
  await zip.add('field_gps_map.geojson', toGeoJSON(features));
  await zip.add('field_gps_map.csv', toCSV(features, opts));
  await zip.add('README.txt', readme);
  return zip.finish();
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------- 読み込み

function parseCoordText(text) {
  return text.trim().split(/\s+/).map((tok) => {
    const [lng, lat] = tok.split(',').map(Number);
    return { lat, lng };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function dropClosing(pts) {
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) return pts.slice(0, -1);
  }
  return pts;
}

/** KML の文字列 → [{ kind, name, notes, vertices }]。MultiGeometry は中身を別々の図形にする。 */
export function parseKML(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('KML');
  const out = [];
  const byTag = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
  byTag(xml, 'Placemark').forEach((pm) => {
    const nameEl = byTag(pm, 'name')[0];
    const descEl = byTag(pm, 'description')[0];
    const name = nameEl ? nameEl.textContent.trim() : '';
    // このアプリが書き出した KML なら ExtendedData に分類・グループ・メモが入っている
    const props = {};
    byTag(pm, 'Data').forEach((d) => {
      const v = byTag(d, 'value')[0];
      if (d.getAttribute('name') && v) props[d.getAttribute('name')] = v.textContent;
    });
    const notes = props.notes != null ? props.notes
      : descEl ? descEl.textContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : '';
    const extra = { category: props.category || '', group: props.group || '' };
    byTag(pm, 'Polygon').forEach((pg) => {
      const outer = byTag(pg, 'outerBoundaryIs')[0] || pg;
      const c = byTag(outer, 'coordinates')[0];
      if (c) out.push({ kind: 'polygon', name, notes, ...extra, vertices: dropClosing(parseCoordText(c.textContent)) });
    });
    byTag(pm, 'LineString').forEach((ls) => {
      const c = byTag(ls, 'coordinates')[0];
      if (c) out.push({ kind: 'line', name, notes, ...extra, vertices: parseCoordText(c.textContent) });
    });
    byTag(pm, 'Point').forEach((pt) => {
      const c = byTag(pt, 'coordinates')[0];
      if (c) out.push({ kind: 'point', name, notes, ...extra, vertices: parseCoordText(c.textContent).slice(0, 1) });
    });
  });
  return out.filter((f) => (f.kind === 'polygon' ? f.vertices.length >= 3 : f.kind === 'line' ? f.vertices.length >= 2 : f.vertices.length === 1));
}

export function parseGeoJSON(text) {
  const gj = JSON.parse(text);
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }];
  const out = [];
  const pt = (c) => ({ lat: c[1], lng: c[0] });
  feats.forEach((f) => {
    const g = f.geometry;
    const props = f.properties || {};
    const name = String(props.name || props.Name || props.NAME || '');
    const notes = String(props.notes || props.description || '');
    const extra = { category: String(props.category || ''), group: String(props.group || '') };
    if (!g) return;
    const add = (type, coords) => {
      if (type === 'Polygon') out.push({ kind: 'polygon', name, notes, ...extra, vertices: dropClosing(coords[0].map(pt)) });
      else if (type === 'LineString') out.push({ kind: 'line', name, notes, ...extra, vertices: coords.map(pt) });
      else if (type === 'Point') out.push({ kind: 'point', name, notes, ...extra, vertices: [pt(coords)] });
    };
    if (g.type.startsWith('Multi')) g.coordinates.forEach((c) => add(g.type.slice(5), c));
    else add(g.type, g.coordinates);
  });
  return out.filter((f) => f.vertices.every((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng)) &&
    (f.kind === 'polygon' ? f.vertices.length >= 3 : f.kind === 'line' ? f.vertices.length >= 2 : true));
}

/** KMZ(ZIP の中の doc.kml)を開く。無圧縮/deflate のどちらにも対応(DecompressionStream)。 */
export async function readKmz(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let i = 0;
  while (i + 30 < buf.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const csize = dv.getUint32(i + 18, true);
    const nlen = dv.getUint16(i + 26, true);
    const xlen = dv.getUint16(i + 28, true);
    const name = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + nlen));
    const start = i + 30 + nlen + xlen;
    const data = buf.subarray(start, start + csize);
    if (/\.kml$/i.test(name)) {
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8 && 'DecompressionStream' in window) {
        const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(ds).text();
      }
      throw new Error('KMZ');
    }
    i = start + csize;
  }
  throw new Error('KMZ');
}

/** 読み込んだ図形に面積・長さ・中心を付ける(保存前の共通処理)。 */
export function measure(f) {
  return {
    areaM2: f.kind === 'polygon' ? polygonArea(f.vertices) : null,
    lengthM: f.kind === 'polygon' ? pathLength(f.vertices, true) : f.kind === 'line' ? pathLength(f.vertices) : null,
    center: centroid(f.vertices, f.kind)
  };
}
