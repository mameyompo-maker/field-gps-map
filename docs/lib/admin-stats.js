/* field_gps_map — 管理者の画面で使う集計(期間・人ごと・日ごと)。
 *
 * もとにするのは、全員が送った記録そのもの(gpsFeatures)。記録には
 * 「誰が(createdBy)」「いつ(createdAt = サーバーが受け取った時刻 / clientCreatedAt = 端末の時刻)」が
 * 必ず入っている(firestore.rules で本人以外の名前では書けない)ので、別の記録帳は作らない。
 * 時刻は端末の時刻帯(モザンビークなら CAT = UTC+2)で日付に分ける。
 */
const DAY = 86400000;

/** 記録した時刻(ミリ秒)。圏外で記録して後で送ったものは、端末で記録した時刻を使う。 */
export function recordedAt(f) {
  return f.clientCreatedAt || f.createdAtMs || 0;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

/** 期間。key = today / yesterday / d7 / d30 / all / day(day のときは dateStr = 'YYYY-MM-DD')。 */
export function periodRange(key, dateStr, now = new Date()) {
  const today = startOfDay(now);
  if (key === 'today') return { from: today, to: today + DAY };
  if (key === 'yesterday') return { from: today - DAY, to: today };
  if (key === 'd7') return { from: today - 6 * DAY, to: today + DAY };
  if (key === 'd30') return { from: today - 29 * DAY, to: today + DAY };
  if (key === 'day' && dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const from = new Date(y, m - 1, d).getTime();
    return { from, to: from + DAY };
  }
  return { from: 0, to: Infinity };
}

export function inRange(list, r) {
  return list.filter((f) => { const t = recordedAt(f); return t >= r.from && t < r.to; });
}

export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function blank() {
  return { n: 0, polygons: 0, lines: 0, points: 0, areaM2: 0, lengthM: 0, photos: 0, first: Infinity, last: 0 };
}
function add(s, f) {
  s.n++;
  if (f.kind === 'polygon') { s.polygons++; s.areaM2 += f.areaM2 || 0; }
  else if (f.kind === 'line') { s.lines++; s.lengthM += f.lengthM || 0; }
  else s.points++;
  s.photos += f.photoCount || 0;
  const t = recordedAt(f);
  if (t && t < s.first) s.first = t;
  if (t > s.last) s.last = t;
}

/** 合計・人ごと・日ごと。面積は区画だけ、長さは線だけの合計。 */
export function summarize(list) {
  const total = blank();
  const people = new Map();
  const days = new Map();
  for (const f of list) {
    add(total, f);
    const who = (f.createdBy && (f.createdBy.email || f.createdBy.uid)) || '?';
    if (!people.has(who)) people.set(who, { ...blank(), email: (f.createdBy && f.createdBy.email) || '', name: (f.createdBy && f.createdBy.name) || who });
    add(people.get(who), f);
    const day = localDate(recordedAt(f));
    if (!days.has(day)) days.set(day, { ...blank(), date: day, who: new Set() });
    add(days.get(day), f);
    days.get(day).who.add(who);
  }
  total.people = people.size;
  return {
    total,
    people: [...people.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    days: [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map((d) => ({ ...d, people: d.who.size }))
  };
}

const q = (s) => {
  const t = String(s == null ? '' : s);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** 人ごと・日ごとの集計を1つの CSV に(Excel でそのまま開ける)。 */
export function summaryCSV(sum, periodLabel) {
  const lines = [];
  lines.push(['period', periodLabel].map(q).join(','));
  lines.push('');
  lines.push(['person', 'email', 'records', 'plots', 'lines', 'points', 'area_ha', 'line_length_km', 'photos', 'first_record', 'last_record'].join(','));
  for (const p of sum.people) {
    lines.push([p.name, p.email, p.n, p.polygons, p.lines, p.points, (p.areaM2 / 10000).toFixed(2), (p.lengthM / 1000).toFixed(2), p.photos,
      p.first < Infinity ? `${localDate(p.first)} ${localTime(p.first)}` : '', p.last ? `${localDate(p.last)} ${localTime(p.last)}` : ''].map(q).join(','));
  }
  const t = sum.total;
  lines.push(['TOTAL', '', t.n, t.polygons, t.lines, t.points, (t.areaM2 / 10000).toFixed(2), (t.lengthM / 1000).toFixed(2), t.photos, '', ''].map(q).join(','));
  lines.push('');
  lines.push(['date', 'records', 'people', 'plots', 'lines', 'points', 'area_ha', 'line_length_km', 'photos'].join(','));
  for (const d of sum.days) {
    lines.push([d.date, d.n, d.people, d.polygons, d.lines, d.points, (d.areaM2 / 10000).toFixed(2), (d.lengthM / 1000).toFixed(2), d.photos].map(q).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
