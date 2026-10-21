/* field_gps_map — 画面全体のつなぎ役。
 *
 * 役割分担:
 *   lib/gps.js        位置情報の購読・平均化・画面の消灯防止
 *   lib/recorder.js   記録中の図形(下書き)の状態
 *   lib/map-google.js 電波があるときの地図(衛星写真)
 *   lib/map-simple.js 圏外用の簡易地図(方眼)
 *   lib/store-*.js    保存先(本番=Firestore、試用=この端末だけ)
 *   lib/export.js     KML/GeoJSON/CSV の書き出しと読み込み
 * ここは画面の出し分けと、ボタンとそれらの配線だけを受け持つ。
 */
import { t, initLang, setLang, getLang, applyI18n, helpHtml, categoryKeyFromLabel } from './lib/i18n.js';
import * as geo from './lib/geo.js';
import { startGps, onGps, lastFix, isFresh, collectFixes, keepScreenOn, gpsStatus } from './lib/gps.js';
import { createRecorder } from './lib/recorder.js';
import { createSimpleMap } from './lib/map-simple.js';
import { getSettings, saveSettings } from './lib/settings.js';
import { CATEGORIES, defaultCategory } from './lib/categories.js';
import { toKML, toGeoJSON, toCSV, toZip, download, stamp, parseKML, parseGeoJSON, readKmz, measure } from './lib/export.js';

const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);
const DEMO_KEY = 'fgm.demo';
const VIEW_KEY = 'fgm.view';

let store = null;
let user = null;
let features = [];          // 保存先から来た全件(アーカイブ済みを除く)
let storeMeta = { pending: 0, fromCache: true, error: '' };
let mapCtl = null;
let googleCtl = null;
let simpleCtl = null;
let authApi = null;
let mainStarted = false;
let collecting = null;      // 測位を集めている最中の { abort }
let openDetailId = null;
let pendingOpenId = null;   // 保存直後など、まだ一覧に来ていない図形を開く予約
let listWasOpen = false;
let hiddenAt = 0;
let followUntil = 0;        // 利用者が地図を動かしてから、追従を止めておく時刻
const filter = { q: '', kind: '', mine: false, group: '', sort: 'new' };
const rec = createRecorder();

// ================================================================ 起動

initLang(getSettings().lang);
applyI18n();
wireStatic();

const isDemo = new URLSearchParams(location.search).has('demo') || safeGet(DEMO_KEY) === '1';
if (isDemo) enterDemo();
else bootFirebase();

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 無視 */ } }

function showScreen(name) {
  $('loginScreen').hidden = name !== 'login';
  $('deniedScreen').hidden = name !== 'denied';
  $('bootError').hidden = name !== 'boot';
  $('mainScreen').hidden = name !== 'main';
}

async function bootFirebase() {
  showScreen('login');
  $('loginStatus').textContent = t('login.loading');
  $('btnSignIn').disabled = true;
  try {
    authApi = await import('./lib/auth.js');
  } catch (err) {
    console.error(err);
    $('bootErrorText').textContent = navigator.onLine ? t('boot.failed') : t('boot.offline');
    showScreen('boot');
    return;
  }
  $('btnSignIn').disabled = false;
  authApi.onAuthChange((s) => {
    if (!s.resolved) return;
    if (s.state === 'signed-out') {
      if (mainStarted) { location.reload(); return; }
      $('loginStatus').textContent = '';
      showScreen('login');
    } else if (s.state === 'checking') {
      $('loginStatus').textContent = t('login.checking');
      showScreen('login');
    } else if (s.state === 'allowed') {
      startMain(s.user, 'firestore');
    } else if (s.state === 'denied') {
      $('deniedText').textContent = t('denied.text', { email: s.user.email });
      showScreen('denied');
    } else {
      $('loginStatus').textContent = t('login.error', { msg: s.error || '' });
      showScreen('login');
    }
  });
}

function enterDemo() {
  safeSet(DEMO_KEY, '1');
  startMain({ uid: 'demo', email: 'demo@this-device', displayName: t('demo.user') }, 'local');
}

async function startMain(u, mode) {
  if (mainStarted) return;
  mainStarted = true;
  user = u;
  if (mode === 'local') {
    const { createLocalStore } = await import('./lib/store-local.js');
    store = createLocalStore(u);
  } else {
    const { createFirestoreStore } = await import('./lib/store-firestore.js');
    store = createFirestoreStore(u);
  }
  showScreen('main');
  $('menuName').textContent = u.displayName || '';
  $('menuEmail').textContent = mode === 'local' ? t('demo.note') : u.email;
  $('menuSignoutText').textContent = mode === 'local' ? t('menu.leaveDemo') : t('menu.signout');
  $('menuVersion').textContent = `Field GPS Map v${VERSION}`;

  startGps();
  onGps(onGpsUpdate);
  await initMap();

  store.subscribe((list, meta) => {
    features = list;
    storeMeta = meta;
    refreshAll();
    if (pendingOpenId && features.some((f) => f.id === pendingOpenId)) {
      const id = pendingOpenId;
      pendingOpenId = null;
      openDetail(id, { fit: true });
    }
  });
  store.onError((msg) => toast(t('err.write', { msg }), 7000));
  updateSyncChip();

  // 前回の記録の続き
  const d = rec.loadDraft();
  if (d && d.vertices && d.vertices.length) {
    const yes = await confirmDlg(t('rec.resume', { n: d.vertices.length }), t('rec.resume.yes'), t('rec.resume.no'));
    if (yes) { rec.resume(d); showRecPanel(); }
    else rec.discardDraft();
  } else if (d) rec.discardDraft();

  // 共有リンク(#f=<id>)で開いたとき
  const m = location.hash.match(/f=([\w-]+)/);
  if (m) pendingOpenId = m[1];

  if (!safeGet('fgm.helpSeen')) { safeSet('fgm.helpSeen', '1'); openHelp(); }
}

// ================================================================ 地図

function loadView() {
  try { const v = JSON.parse(safeGet(VIEW_KEY) || 'null'); if (v && Number.isFinite(v.lat)) return v; } catch { /* 無視 */ }
  return null;
}

const mapHandlers = () => ({
  onTap: onMapTap,
  onUserMove: () => { followUntil = Date.now() + 20000; },
  onFeatureTap: (id) => { if (!rec.active) openDetail(id); },
  onIdle: (v) => {
    const prev = loadView() || {};
    safeSet(VIEW_KEY, JSON.stringify({ ...prev, ...v }));
  },
  view: { ...(loadView() || {}), mapType: getSettings().mapType }
});

async function initMap() {
  const mode = getSettings().mapMode;
  if (mode !== 'simple' && navigator.onLine) {
    try {
      if (!googleCtl) {
        const { createGoogleMap } = await import('./lib/map-google.js');
        googleCtl = await createGoogleMap($('mapGoogle'), mapHandlers());
        googleCtl.whenTilesFail(12000, () => {
          if (mapCtl === googleCtl) showBanner(t('map.tilesFail'), t('map.useSimple'), useSimple);
        });
        // APIキーの制限などで Google が地図を拒否したら、エラー画面を見せずに簡易地図へ。
        window.addEventListener('fgm-maps-auth-failed', () => {
          if (mapCtl === googleCtl) { useSimple(); toast(t('map.googleFail'), 6000); }
        });
      }
      useMap(googleCtl);
      return;
    } catch (err) {
      console.warn('Google Maps unavailable:', err && err.message);
      if (mode === 'google') toast(t('map.googleFail'));
    }
  }
  useSimple();
}

function useSimple() {
  if (!simpleCtl) simpleCtl = createSimpleMap($('mapSimple'), mapHandlers());
  hideBanner();
  useMap(simpleCtl);
}

function useMap(ctl) {
  const prevView = mapCtl && mapCtl.getView ? mapCtl.getView() : null;
  mapCtl = ctl;
  $('mapGoogle').hidden = ctl.type !== 'google';
  $('mapSimple').hidden = ctl.type !== 'simple';
  if (ctl.type === 'simple') ctl.resize();
  if (prevView && prevView.lat) ctl.centerOn(prevView, Math.round(prevView.zoom));
  ctl.setFeatures(visibleFeatures());
  ctl.setDraft(rec.state);
  ctl.setMyLocation(isFresh(lastFix(), 120000) ? lastFix() : null);
  ctl.setFeaturesClickable(!tapMode());
  if (openDetailId) ctl.highlight(openDetailId);
  const tag = $('mapModeTag');
  if (ctl.type === 'simple') { tag.hidden = false; tag.textContent = t('map.simpleTag'); }
  else tag.hidden = true;
  // 初回で保存済みの表示位置が無いなら、現在地か登録済みの図形へ寄せる
  if (!loadView()) {
    const fx = lastFix();
    if (fx) ctl.centerOn(fx, 17);
  }
}

function tapMode() {
  return rec.active && rec.state.method === 'tap';
}

function onMapTap(ll) {
  if (!rec.active) return;
  const st = rec.state;
  if (st.method === 'tap') {
    rec.addVertex({ lat: ll.lat, lng: ll.lng, acc: null, src: 'tap' });
  }
}

window.addEventListener('offline', () => {
  updateSyncChip();
  if (mapCtl && mapCtl.type === 'google') showBanner(t('map.offlineBanner'), t('map.useSimple'), useSimple);
});
window.addEventListener('online', () => {
  updateSyncChip();
  hideBanner();
  if (mapCtl && mapCtl.type === 'simple' && getSettings().mapMode !== 'simple') {
    showBanner(t('map.onlineBanner'), t('map.useGoogle'), () => { hideBanner(); initMap(); });
  }
});

// ================================================================ GPS 表示

function onGpsUpdate({ fix, status }) {
  const chip = $('gpsChip');
  const s = getSettings();
  chip.className = 'chip';
  if (status === 'denied' || status === 'unsupported' || status === 'unavailable') {
    chip.classList.add('gps-off');
    $('gpsText').textContent = t('gps.off');
  } else if (!fix) {
    chip.classList.add('gps-wait');
    $('gpsText').textContent = t('gps.wait');
  } else {
    const acc = Math.round(fix.acc);
    chip.classList.add(acc <= 5 ? 'gps-good' : acc <= s.maxAcc ? 'gps-ok' : 'gps-bad');
    $('gpsText').textContent = `±${acc} m`;
  }
  if (fix && mapCtl) mapCtl.setMyLocation(fix);
  if (fix && rec.active && rec.state.method === 'walk') {
    rec.onFix(fix, { maxAcc: s.maxAcc, minDist: s.minDist });
  }
  // 歩いて記録している間は、現在地が画面の外へ出ないよう地図を追いかける。
  // 利用者が地図を動かした直後(20秒)は追わない(確かめたい場所を見ているので)。
  if (fix && rec.active && GPS_METHODS.includes(rec.state.method) && Date.now() > followUntil && mapCtl) {
    mapCtl.centerOn({ lat: fix.lat, lng: fix.lng });
  }
  if (rec.active) renderRecStats();
}

function gpsHelp() {
  const st = gpsStatus();
  const fx = lastFix();
  if (st === 'denied') return t('gps.denied');
  if (st === 'unsupported' || st === 'unavailable') return t('gps.unavailable');
  if (!fx) return t('gps.waiting');
  const age = Math.round((Date.now() - fx.t) / 1000);
  return t('gps.detail', { acc: Math.round(fx.acc), age, lat: fx.lat.toFixed(6), lng: fx.lng.toFixed(6) });
}

// ================================================================ 記録

const GPS_METHODS = ['walk', 'corners', 'gps'];

function methodsFor(kind) {
  if (kind === 'point') return ['gps', 'tap'];
  return ['walk', 'corners', 'tap'];
}

function openNewSheet() {
  closeSheets();
  $('newKinds').hidden = false;
  $('newMethods').hidden = true;
  $('newSheetTitle').textContent = t('new.title');
  $('newSheet').hidden = false;
}

function chooseKind(kind) {
  const box = $('newMethods');
  box.innerHTML = '';
  methodsFor(kind).forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    const icon = m === 'walk' ? 'i-walk' : m === 'corners' ? 'i-corner' : m === 'tap' ? 'i-tap' : 'i-target';
    b.innerHTML = `<svg class="ic"><use href="#${icon}"/></svg><strong>${t('method.' + m)}${i === 0 ? `<span class="rec-tag">${t('new.recommended')}</span>` : ''}</strong><span>${t('method.' + m + '.d.' + kind)}</span>`;
    b.addEventListener('click', () => startRecording(kind, m));
    box.appendChild(b);
  });
  $('newKinds').hidden = true;
  box.hidden = false;
  $('newSheetTitle').textContent = t('new.how', { kind: t('kind.' + kind) });
}

function startRecording(kind, method) {
  if (GPS_METHODS.includes(method) && ['denied', 'unsupported', 'unavailable'].includes(gpsStatus())) {
    toast(t('gps.denied'), 6000);
    return;
  }
  rec.start(kind, method);
  closeSheets();
  showRecPanel();
  const fx = lastFix();
  if (fx && isFresh(fx, 60000)) mapCtl.centerOn(fx, 19);
  if (kind === 'point' && method === 'gps') measurePoint();
}

function showRecPanel() {
  const st = rec.state;
  window.__fgmRecording = true;
  keepScreenOn(GPS_METHODS.includes(st.method));
  $('fabNew').hidden = true;
  $('recPanel').hidden = false;
  $('mainScreen').classList.add('recording');
  mapCtl.setFeaturesClickable(st.method !== 'tap');
  renderRec();
}

function stopRecording() {
  if (collecting) { collecting.abort(); collecting = null; }
  rec.clear();
  keepScreenOn(false);
  window.__fgmRecording = false;
  $('recPanel').hidden = true;
  $('mainScreen').classList.remove('recording');
  $('fabNew').hidden = false;
  $('recProgress').hidden = true;
  if (mapCtl) { mapCtl.setDraft(null); mapCtl.setFeaturesClickable(true); }
}

rec.onChange((st) => {
  if (!mapCtl) return;
  mapCtl.setDraft(st);
  if (st) renderRec();
});

function renderRec() {
  const st = rec.state;
  if (!st) return;
  $('recKindIcon').setAttribute('href', st.kind === 'polygon' ? '#i-polygon' : st.kind === 'line' ? '#i-line' : '#i-point');
  $('recTitle').textContent = `${t('kind.' + st.kind)} — ${t('method.' + st.method)}`;
  let hint;
  if (st.method === 'walk') hint = st.paused ? t('rec.hint.walkPaused') : t('rec.hint.walk');
  else hint = t(`rec.hint.${st.method}.${st.kind}`);
  $('recHint').textContent = hint;
  $('recDot').hidden = !(st.method === 'walk' && !st.paused);

  const mark = $('btnRecMark');
  if (st.method === 'corners') {
    mark.hidden = false;
    $('btnRecMarkText').textContent = collecting ? t('rec.stopNow') : t('rec.mark', { n: st.vertices.length + 1 });
  } else if (st.kind === 'point' && st.method === 'gps') {
    mark.hidden = false;
    $('btnRecMarkText').textContent = collecting ? t('rec.stopNow') : t('rec.remeasure');
  } else mark.hidden = true;

  const pause = $('btnRecPause');
  pause.hidden = st.method !== 'walk';
  $('recPauseIcon').setAttribute('href', st.paused ? '#i-play' : '#i-pause');
  $('btnRecPauseText').textContent = st.paused ? (st.vertices.length ? t('rec.continue') : t('rec.begin')) : t('rec.pause');
  $('btnRecUndo').hidden = st.kind === 'point';
  $('btnRecFinishText').textContent = st.kind === 'point' ? t('rec.savePoint') : t('rec.finish');
  $('btnRecFinish').disabled = !!collecting;
  $('stAreaBox').hidden = st.kind !== 'polygon';
  $('stLenLabel').textContent = st.kind === 'polygon' ? t('rec.perimeter') : st.kind === 'line' ? t('rec.length') : t('rec.coords');
  renderRecStats();
}

function renderRecStats() {
  const st = rec.state;
  if (!st) return;
  const s = rec.stats();
  const lang = getLang();
  $('stVertices').textContent = String(s.n);
  $('stArea').textContent = s.areaM2 ? geo.fmtHa(s.areaM2, lang) : '—';
  if (st.kind === 'point') {
    $('stLen').textContent = s.n ? `${st.vertices[0].lat.toFixed(5)}, ${st.vertices[0].lng.toFixed(5)}` : '—';
  } else {
    $('stLen').textContent = s.lengthM ? geo.fmtLength(s.lengthM, lang) : '—';
  }
  const fx = lastFix();
  $('stAcc').textContent = fx && isFresh(fx) ? `±${Math.round(fx.acc)} m` : '—';

  const warns = [];
  const set = getSettings();
  if (st.method === 'walk' && st.rejected > 0) warns.push(t('rec.warn.rejected', { n: st.rejected, max: set.maxAcc }));
  if (st.gapCount > 0) warns.push(t('rec.warn.gap'));
  if (st.kind === 'polygon' && s.selfIntersects) warns.push(t('rec.warn.cross'));
  if (st.kind === 'polygon' && st.method === 'walk' && s.closingGapM != null && s.n > 5 && s.closingGapM > Math.max(15, set.maxAcc * 2)) {
    warns.push(t('rec.warn.close', { m: Math.round(s.closingGapM) }));
  }
  const w = $('recWarn');
  w.hidden = !warns.length;
  w.textContent = warns.join(' ');
}

async function collect(onDone) {
  const set = getSettings();
  const seconds = Number(set.avgSeconds) || 5;
  $('recProgress').hidden = false;
  $('recProgressBar').style.width = '0%';
  $('recProgressText').textContent = t('rec.collecting', { s: seconds, n: 0 });
  collecting = collectFixes(seconds, set.maxAcc, ({ elapsed, total, n, best }) => {
    $('recProgressBar').style.width = `${Math.round((elapsed / total) * 100)}%`;
    $('recProgressText').textContent = t('rec.collecting', { s: Math.max(0, Math.ceil(total - elapsed)), n }) +
      (best != null ? ` · ±${Math.round(best)} m` : '');
  });
  renderRec();
  const { fixes, usable } = await collecting.done;
  collecting = null;
  $('recProgress').hidden = true;
  let list = usable;
  if (!list.length && fixes.length) {
    const best = fixes.reduce((a, b) => (a.acc <= b.acc ? a : b));
    list = [best];
    toast(t('rec.lowAcc', { acc: Math.round(best.acc), max: set.maxAcc }), 6000);
  }
  if (!list.length) {
    // 平均する時間内に1つも測位が来なかった。直前の測位が新しければそれを使う。
    const fx = lastFix();
    if (fx && isFresh(fx, 10000)) list = [fx];
  }
  if (!list.length) { toast(t('rec.noFix'), 6000); renderRec(); return; }
  const avg = geo.averageFixes(list);
  onDone({ ...avg, src: 'gps', t: Date.now() });
  renderRec();
}

function markCorner() {
  if (collecting) { collecting.abort(); return; }
  if (!rec.active) return;
  collect((v) => rec.addVertex(v));
}

function measurePoint() {
  if (collecting) { collecting.abort(); return; }
  collect((v) => {
    rec.addVertex(v);
    const fx = { lat: v.lat, lng: v.lng };
    mapCtl.centerOn(fx);
  });
}

function finishRecording() {
  if (collecting) return;
  const err = rec.validate();
  if (err) { toast(t(err), 5000); return; }
  if (rec.state.method === 'walk' && !rec.state.paused) rec.setPaused(true);
  openSaveDialog(null);
}

async function cancelRecording() {
  if (rec.active && rec.state.vertices.length) {
    const ok = await confirmDlg(t('rec.confirmCancel'), t('rec.cancel.yes'), t('common.back'));
    if (!ok) return;
  }
  stopRecording();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  const st = rec.state;
  if (st && st.method === 'walk' && !st.paused && hiddenAt && Date.now() - hiddenAt > 5000) {
    toast(t('rec.wasHidden'), 8000);
  }
  hiddenAt = 0;
});

// ================================================================ 保存・編集

let saveTarget = null;   // null = 新規(記録中の図形) / 図形のid = 属性の編集

function fillCategorySelect(sel, value) {
  sel.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.key;
    o.textContent = t('cat.' + c.key);
    sel.appendChild(o);
  });
  sel.value = value;
}

function groupsList() {
  return [...new Set(features.map((f) => (f.group || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillGroupDatalist() {
  const dl = $('groupList');
  dl.innerHTML = '';
  groupsList().forEach((g) => { const o = document.createElement('option'); o.value = g; dl.appendChild(o); });
}

function openSaveDialog(editId) {
  saveTarget = editId;
  fillGroupDatalist();
  const lang = getLang();
  const warn = $('saveWarn');
  warn.hidden = true;
  if (editId) {
    const f = features.find((x) => x.id === editId);
    if (!f) return;
    $('saveTitle').textContent = t('save.editTitle');
    $('saveSummary').textContent = summaryText(f.kind, f.areaM2, f.lengthM, f.vertices, lang);
    $('fName').value = f.name || '';
    fillCategorySelect($('fCategory'), f.category || defaultCategory(f.kind));
    $('fGroup').value = f.group || '';
    $('fNotes').value = f.notes || '';
  } else {
    const st = rec.state;
    const s = rec.stats();
    $('saveTitle').textContent = t('save.title');
    $('saveSummary').textContent = summaryText(st.kind, s.areaM2, s.lengthM, st.vertices, lang);
    const warns = [];
    if (s.tapCount) warns.push(t('save.warn.tap', { n: s.tapCount }));
    if (st.kind === 'polygon' && s.selfIntersects) warns.push(t('rec.warn.cross'));
    if (st.gapCount) warns.push(t('rec.warn.gap'));
    if (warns.length) { warn.hidden = false; warn.textContent = warns.join(' '); }
    $('fName').value = '';
    fillCategorySelect($('fCategory'), safeGet('fgm.lastCat.' + st.kind) || defaultCategory(st.kind));
    $('fGroup').value = safeGet('fgm.lastGroup') || '';
    $('fNotes').value = '';
  }
  $('saveDialog').showModal();
  setTimeout(() => $('fName').focus(), 50);
}

function summaryText(kind, areaM2, lengthM, vertices, lang) {
  if (kind === 'polygon') return `${t('rec.area')}: ${geo.fmtArea(areaM2, lang)} · ${t('rec.perimeter')}: ${geo.fmtLength(lengthM, lang)} · ${t('rec.vertices')}: ${vertices.length}`;
  if (kind === 'line') return `${t('rec.length')}: ${geo.fmtLength(lengthM, lang)} · ${t('rec.vertices')}: ${vertices.length}`;
  const v = vertices[0];
  return `${geo.fmtCoord(v)}${v && v.acc != null ? ` (±${Math.round(v.acc)} m)` : ''}`;
}

function onSaveSubmit(e) {
  e.preventDefault();
  const name = $('fName').value.trim();
  if (!name) { $('fName').focus(); return; }
  const category = $('fCategory').value;
  const group = $('fGroup').value.trim();
  const notes = $('fNotes').value.trim();
  if (saveTarget) {
    store.update(saveTarget, { name, category, group, notes });
    $('saveDialog').close();
    toast(t('save.updated'));
    openDetail(saveTarget);
    return;
  }
  const st = rec.state;
  const s = rec.stats();
  const docData = {
    kind: st.kind, method: st.method, name, category, group, notes,
    vertices: st.vertices.map((v) => {
      const o = { lat: v.lat, lng: v.lng, acc: v.acc == null ? null : v.acc, t: v.t || 0, src: v.src || 'gps' };
      if (v.n) o.n = v.n;
      return o;
    }),
    areaM2: s.areaM2 == null ? null : Math.round(s.areaM2 * 10) / 10,
    lengthM: s.lengthM == null ? null : Math.round(s.lengthM * 10) / 10,
    center: geo.centroid(st.vertices, st.kind),
    nVertices: s.n,
    accMedian: s.accMedian == null ? null : s.accMedian,
    accMax: s.accMax == null ? null : s.accMax,
    tapCount: s.tapCount,
    gapCount: st.gapCount || 0,
    startedAt: st.startedAt,
    durationS: Math.round((Date.now() - st.startedAt) / 1000)
  };
  const id = store.add(docData);
  safeSet('fgm.lastCat.' + st.kind, category);
  safeSet('fgm.lastGroup', group);
  $('saveDialog').close();
  stopRecording();
  toast(store.mode === 'local' ? t('save.ok.demo') : navigator.onLine ? t('save.ok.online') : t('save.ok.offline'), 5000);
  pendingOpenId = id;
  if (features.some((f) => f.id === id)) { pendingOpenId = null; openDetail(id); }
}

// ================================================================ 一覧

function applyFilter(list) {
  const q = filter.q.trim().toLowerCase();
  let out = list.filter((f) => {
    if (filter.kind && f.kind !== filter.kind) return false;
    if (filter.mine && (!f.createdBy || f.createdBy.uid !== user.uid)) return false;
    if (filter.group && (f.group || '') !== filter.group) return false;
    if (q) {
      const hay = `${f.name || ''} ${f.group || ''} ${f.notes || ''} ${(f.createdBy && f.createdBy.name) || ''} ${t('cat.' + (f.category || 'other'))}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (filter.sort === 'name') out = out.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  else if (filter.sort === 'area') out = out.sort((a, b) => (b.areaM2 || b.lengthM || 0) - (a.areaM2 || a.lengthM || 0));
  else out = out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return out;
}

function visibleFeatures() { return applyFilter(features); }

function refreshAll() {
  const vis = visibleFeatures();
  if (mapCtl) mapCtl.setFeatures(vis);
  $('listCount').textContent = String(vis.length);
  if (!$('listPanel').hidden) renderList();
  if (openDetailId && !$('detailSheet').hidden) {
    if (features.some((f) => f.id === openDetailId)) renderDetail(openDetailId);
    else closeDetail();
  }
  updateSyncChip();
}

function renderGroupSelect() {
  const sel = $('listGroup');
  const cur = filter.group;
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('list.allGroups');
  sel.appendChild(all);
  groupsList().forEach((g) => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
  sel.value = groupsList().includes(cur) ? cur : '';
}

function renderList() {
  renderGroupSelect();
  const lang = getLang();
  const vis = visibleFeatures();
  const ul = $('listItems');
  ul.innerHTML = '';
  const areas = vis.filter((f) => f.kind === 'polygon');
  const total = areas.reduce((s, f) => s + (f.areaM2 || 0), 0);
  $('listSummary').textContent = t('list.summary', {
    n: vis.length, a: areas.length, ha: (total / 10000).toLocaleString(lang === 'ja' ? 'ja-JP' : 'pt-PT', { maximumFractionDigits: 2 })
  });
  if (!vis.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = features.length ? t('list.noMatch') : t('list.empty');
    ul.appendChild(li);
    return;
  }
  const frag = document.createDocumentFragment();
  vis.slice(0, 1000).forEach((f) => {
    const li = document.createElement('li');
    const icon = f.kind === 'polygon' ? 'i-polygon' : f.kind === 'line' ? 'i-line' : 'i-point';
    const val = f.kind === 'polygon' ? geo.fmtHa(f.areaM2, lang) : f.kind === 'line' ? geo.fmtLength(f.lengthM, lang) : '';
    const who = (f.createdBy && f.createdBy.name) || '';
    const when = f.createdAtMs ? new Date(f.createdAtMs).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-PT') : '';
    li.innerHTML = `<svg class="ic"><use href="#${icon}"/></svg><span class="fl-name"></span><span class="fl-val"></span><span class="fl-sub"></span>`;
    li.querySelector('.fl-name').textContent = f.name || t('d.noName');
    if (f._pending) {
      const b = document.createElement('span');
      b.className = 'badge badge-pending';
      b.textContent = t('sync.badge');
      li.querySelector('.fl-name').appendChild(b);
    }
    li.querySelector('.fl-val').textContent = val;
    li.querySelector('.fl-sub').textContent = [t('cat.' + (f.category || 'other')), f.group, who, when].filter(Boolean).join(' · ');
    li.addEventListener('click', () => { listWasOpen = true; openDetail(f.id, { fit: true }); });
    frag.appendChild(li);
  });
  ul.appendChild(frag);
}

function openList() {
  closeSheets();
  $('listPanel').hidden = false;
  renderList();
}

// ================================================================ 詳細

function openDetail(id, { fit = false } = {}) {
  const f = features.find((x) => x.id === id);
  if (!f) { pendingOpenId = id; return; }
  $('listPanel').hidden = true;
  $('newSheet').hidden = true;
  openDetailId = id;
  mapCtl.highlight(id);
  renderDetail(id);
  $('detailSheet').hidden = false;
  if (fit) mapCtl.fitPoints(f.vertices);
  if (location.hash !== `#f=${id}`) history.replaceState(null, '', `#f=${id}`);
}

function closeDetail() {
  $('detailSheet').hidden = true;
  openDetailId = null;
  if (mapCtl) mapCtl.highlight(null);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (listWasOpen) { listWasOpen = false; openList(); }
}

function featureCenter(f) {
  return f.center || geo.centroid(f.vertices || [], f.kind);
}

function renderDetail(id) {
  const f = features.find((x) => x.id === id);
  if (!f) return;
  const lang = getLang();
  $('dTitle').textContent = f.name || t('d.noName');
  $('dSub').textContent = `${t('kind.' + f.kind)} · ${t('cat.' + (f.category || 'other'))}${f.group ? ' · ' + f.group : ''}`;
  const stats = [];
  if (f.kind === 'polygon') {
    stats.push([t('rec.area'), geo.fmtHa(f.areaM2, lang)]);
    stats.push(['m²', Math.round(f.areaM2 || 0).toLocaleString(lang === 'ja' ? 'ja-JP' : 'pt-PT')]);
    stats.push([t('rec.perimeter'), geo.fmtLength(f.lengthM, lang)]);
  } else if (f.kind === 'line') {
    stats.push([t('rec.length'), geo.fmtLength(f.lengthM, lang)]);
  } else {
    const v = f.vertices[0];
    stats.push([t('rec.coords'), `${v.lat.toFixed(6)}, ${v.lng.toFixed(6)}`]);
  }
  $('dStats').innerHTML = '';
  stats.forEach(([k, v]) => {
    const d = document.createElement('div');
    d.innerHTML = '<span class="stat-label"></span><strong></strong>';
    d.querySelector('span').textContent = k;
    d.querySelector('strong').textContent = v;
    $('dStats').appendChild(d);
  });
  const meta = [
    [t('d.by'), (f.createdBy && (f.createdBy.name || f.createdBy.email)) || '—'],
    [t('d.date'), f.createdAtMs ? new Date(f.createdAtMs).toLocaleString(lang === 'ja' ? 'ja-JP' : 'pt-PT') : '—'],
    [t('d.method'), t('method.' + (f.method || 'gps'))],
    [t('rec.vertices'), String((f.vertices || []).length)],
    [t('d.accuracy'), f.accMedian != null ? t('d.accText', { med: Math.round(f.accMedian), max: Math.round(f.accMax || f.accMedian) }) : '—']
  ];
  if (f.tapCount) meta.push([t('d.tapped'), String(f.tapCount)]);
  if (f.notes) meta.push([t('save.notes'), f.notes]);
  if (f.updatedBy && f.updatedAtMs && f.createdBy && f.updatedBy.uid !== f.createdBy.uid) {
    meta.push([t('d.editedBy'), f.updatedBy.name || f.updatedBy.email]);
  }
  meta.push([t('d.sync'), f._pending ? t('d.sync.pending') : store.mode === 'local' ? t('d.sync.demo') : t('d.sync.ok')]);
  const dl = $('dMeta');
  dl.innerHTML = '';
  meta.forEach(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  });
  const c = featureCenter(f);
  $('dGmaps').href = `https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
}

function shareText(f) {
  const lang = getLang();
  const c = featureCenter(f);
  const lines = [f.name || t('d.noName')];
  if (f.kind === 'polygon') lines.push(`${t('rec.area')}: ${geo.fmtArea(f.areaM2, lang)}`, `${t('rec.perimeter')}: ${geo.fmtLength(f.lengthM, lang)}`);
  if (f.kind === 'line') lines.push(`${t('rec.length')}: ${geo.fmtLength(f.lengthM, lang)}`);
  if (f.group) lines.push(`${t('save.group')}: ${f.group}`);
  lines.push(`${t('d.by')}: ${(f.createdBy && f.createdBy.name) || ''} (${f.createdAtMs ? new Date(f.createdAtMs).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'pt-PT') : ''})`);
  lines.push(`Google Maps: https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
  if (store.mode !== 'local') lines.push(`${t('d.appLink')}: ${location.origin}${location.pathname}#f=${f.id}`);
  return lines.join('\n');
}

async function shareFeature() {
  const f = features.find((x) => x.id === openDetailId);
  if (!f) return;
  const text = shareText(f);
  if (navigator.share) {
    try { await navigator.share({ title: f.name, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast(t('d.copied')); } catch { prompt(t('d.copyPrompt'), text); }
}

function safeFileName(s) {
  return (s || 'field').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'field';
}

async function shareKml() {
  const f = features.find((x) => x.id === openDetailId);
  if (!f) return;
  const kml = toKML([f], { title: f.name, catName: (k) => t('cat.' + k) });
  const name = `${safeFileName(f.name)}.kml`;
  const file = new File([kml], name, { type: 'application/vnd.google-earth.kml+xml' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: f.name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  download(file, name);
}

async function archiveFeature() {
  const f = features.find((x) => x.id === openDetailId);
  if (!f) return;
  const ok = await confirmDlg(t('d.archive.confirm', { name: f.name || '' }), t('d.archive'), t('common.cancel'));
  if (!ok) return;
  store.archive(f.id);
  listWasOpen = false;
  closeDetail();
  toast(t('d.archived'));
}

// ================================================================ 書き出し・読み込み

function exportScope() {
  const scope = $('expScope').value;
  if (scope === 'filtered') return visibleFeatures();
  if (scope === 'mine') return features.filter((f) => f.createdBy && f.createdBy.uid === user.uid);
  return [...features].sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
}

function openExport() {
  $('expCount').textContent = t('exp.count', { n: exportScope().length });
  $('exportDialog').showModal();
}

async function doExport(fmt) {
  const list = exportScope();
  if (!list.length) { toast(t('exp.none')); return; }
  const base = `field_gps_map_${stamp()}`;
  const opts = { title: `Field GPS Map ${stamp()}`, catName: (k) => t('cat.' + k) };
  if (fmt === 'kml') download(toKML(list, opts), `${base}.kml`, 'application/vnd.google-earth.kml+xml');
  else if (fmt === 'geojson') download(toGeoJSON(list), `${base}.geojson`, 'application/geo+json');
  else if (fmt === 'csv') download(toCSV(list, opts), `${base}.csv`, 'text/csv;charset=utf-8');
  else download(await toZip(list, opts, t('exp.readme')), `${base}.zip`);
  toast(t('exp.done', { n: list.length }));
}

let importItems = [];

async function onImportFile() {
  const file = $('impFile').files[0];
  importItems = [];
  $('impOk').disabled = true;
  if (!file) { $('impPreview').textContent = ''; return; }
  try {
    let items;
    if (/\.kmz$/i.test(file.name)) items = parseKML(await readKmz(file));
    else {
      const text = await file.text();
      items = /^\s*</.test(text) ? parseKML(text) : parseGeoJSON(text);
    }
    importItems = items;
    const c = (k) => items.filter((x) => x.kind === k).length;
    $('impPreview').textContent = t('imp.found', { p: c('polygon'), l: c('line'), pt: c('point') });
    $('impOk').disabled = !items.length;
  } catch (err) {
    console.error(err);
    $('impPreview').textContent = t('imp.error');
  }
}

function doImport() {
  if (!importItems.length) return;
  const group = $('impGroup').value.trim();
  const now = Date.now();
  const all = [];
  importItems.slice(0, 2000).forEach((it, i) => {
    const m = measure(it);
    const vertices = it.vertices.map((v) => ({ lat: v.lat, lng: v.lng, acc: null, t: now, src: 'import' }));
    store.add({
      kind: it.kind, method: 'import', name: it.name || t('imp.unnamed', { n: i + 1 }),
      category: categoryKeyFromLabel(it.category) || defaultCategory(it.kind),
      group: group || it.group || '', notes: it.notes || '',
      vertices, areaM2: m.areaM2 == null ? null : Math.round(m.areaM2 * 10) / 10,
      lengthM: m.lengthM == null ? null : Math.round(m.lengthM * 10) / 10,
      center: m.center, nVertices: vertices.length, accMedian: null, accMax: null,
      tapCount: 0, gapCount: 0, startedAt: now, durationS: 0
    });
    all.push(...vertices);
  });
  $('importDialog').close();
  toast(t('imp.done', { n: Math.min(importItems.length, 2000) }), 5000);
  if (all.length) mapCtl.fitPoints(all);
  importItems = [];
  $('impFile').value = '';
  $('impPreview').textContent = '';
}

// ================================================================ 同期の表示

function updateSyncChip() {
  const chip = $('syncChip');
  if (!store) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.className = 'chip';
  const icon = $('syncIcon');
  if (store.mode === 'local') {
    chip.classList.add('sync-demo');
    icon.setAttribute('href', '#i-cloud-off');
    $('syncText').textContent = t('sync.demo');
    return;
  }
  const n = storeMeta.pending || 0;
  if (!navigator.onLine) {
    chip.classList.add('sync-off');
    icon.setAttribute('href', '#i-cloud-off');
    $('syncText').textContent = n ? t('sync.offlineN', { n }) : t('sync.offline');
  } else if (n) {
    chip.classList.add('sync-pending');
    icon.setAttribute('href', '#i-cloud-off');
    $('syncText').textContent = t('sync.pending', { n });
  } else {
    chip.classList.add('sync-ok');
    icon.setAttribute('href', '#i-cloud-ok');
    $('syncText').textContent = storeMeta.fromCache ? t('sync.cache') : t('sync.ok');
  }
}

async function syncNow() {
  if (!store) return;
  if (store.mode === 'local') { toast(t('sync.demoHelp'), 6000); return; }
  if (!navigator.onLine) { toast(t('sync.offlineHelp', { n: storeMeta.pending || 0 }), 6000); return; }
  toast(t('sync.trying'));
  const ok = await store.flush();
  toast(ok ? t('sync.done') : t('sync.wait'), 5000);
}

// ================================================================ 設定・ヘルプ・メニュー

function openSettings() {
  const s = getSettings();
  $('sLang').value = getLang();
  $('sMaxAcc').value = String(s.maxAcc);
  $('sMinDist').value = String(s.minDist);
  $('sAvg').value = String(s.avgSeconds);
  $('sMapMode').value = s.mapMode;
  $('sMapType').value = s.mapType;
  $('settingsDialog').showModal();
}

function saveSettingsFromDialog() {
  const prev = getSettings();
  const next = saveSettings({
    lang: $('sLang').value,
    maxAcc: Number($('sMaxAcc').value),
    minDist: Number($('sMinDist').value),
    avgSeconds: Number($('sAvg').value),
    mapMode: $('sMapMode').value,
    mapType: $('sMapType').value
  });
  $('settingsDialog').close();
  if (next.lang !== getLang()) changeLang(next.lang);
  if (next.mapType !== prev.mapType && googleCtl) googleCtl.setMapType(next.mapType);
  if (next.mapMode !== prev.mapMode) {
    if (next.mapMode === 'simple') useSimple();
    else initMap();
  }
  toast(t('set.saved'));
}

function changeLang(lang) {
  setLang(lang);
  saveSettings({ lang });
  applyI18n();
  refreshAll();
  if (rec.active) renderRec();
  if (mapCtl) useMap(mapCtl);
  if (user && store) {
    $('menuEmail').textContent = store.mode === 'local' ? t('demo.note') : user.email;
    $('menuSignoutText').textContent = store.mode === 'local' ? t('menu.leaveDemo') : t('menu.signout');
  }
  updateSyncChip();
  document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

function openHelp() {
  $('helpBody').innerHTML = helpHtml();
  $('helpDialog').showModal();
}

async function signOutOrLeave() {
  if (store && store.mode === 'local') {
    safeSet(DEMO_KEY, null);
    location.href = location.pathname;
    return;
  }
  if (rec.active && rec.state.vertices.length) {
    const ok = await confirmDlg(t('menu.signout.rec'), t('menu.signout'), t('common.cancel'));
    if (!ok) return;
  }
  if (authApi) await authApi.signOutUser();
  location.reload();
}

function openLayers() {
  const d = document.createElement('dialog');
  d.className = 'dlg menu-dlg';
  const opts = [
    ['hybrid', t('set.mapType.hybrid')], ['satellite', t('set.mapType.satellite')],
    ['roadmap', t('set.mapType.roadmap')], ['terrain', t('set.mapType.terrain')], ['simple', t('set.mapMode.simple')]
  ];
  d.innerHTML = `<h2>${t('map.layers')}</h2><nav class="menu-items"></nav><p class="muted small">${t('map.layersNote')}</p><div class="dlg-buttons"><button type="button" class="btn-text">${t('common.close')}</button></div>`;
  const nav = d.querySelector('nav');
  opts.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    const on = (k === 'simple' && mapCtl.type === 'simple') || (mapCtl.type === 'google' && getSettings().mapType === k);
    b.innerHTML = `<svg class="ic"><use href="#${on ? 'i-check' : 'i-layers'}"/></svg><span></span>`;
    b.querySelector('span').textContent = label;
    b.addEventListener('click', async () => {
      d.close();
      if (k === 'simple') { useSimple(); return; }
      saveSettings({ mapType: k, mapMode: getSettings().mapMode === 'simple' ? 'auto' : getSettings().mapMode });
      if (!googleCtl || mapCtl.type !== 'google') await initMap();
      if (googleCtl) googleCtl.setMapType(k);
      if (!googleCtl) toast(t('map.googleFail'));
    });
    nav.appendChild(b);
  });
  d.querySelector('.dlg-buttons button').addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  d.showModal();
}

// ================================================================ 小物

function closeSheets() {
  $('newSheet').hidden = true;
  $('listPanel').hidden = true;
  if (!$('detailSheet').hidden) { listWasOpen = false; closeDetail(); }
}

let toastTimer = 0;
function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let bannerAction = null;
function showBanner(text, actionLabel, action) {
  const b = $('banner');
  b.textContent = text;
  if (actionLabel && action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel;
    bannerAction = action;
    btn.addEventListener('click', () => { hideBanner(); bannerAction(); });
    b.appendChild(btn);
  }
  b.hidden = false;
}
function hideBanner() { $('banner').hidden = true; }

function confirmDlg(text, yes, no) {
  return new Promise((resolve) => {
    const d = $('confirmDialog');
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yes || t('common.ok');
    $('confirmNo').textContent = no || t('common.cancel');
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      $('confirmYes').onclick = null;
      $('confirmNo').onclick = null;
      d.onclose = null;
      if (d.open) d.close();
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
    d.onclose = () => done(false);
    d.showModal();
  });
}

// ================================================================ ボタンの配線(起動時に1回)

function wireStatic() {
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === getLang());
    b.addEventListener('click', () => changeLang(b.dataset.lang));
  });
  $('btnSignIn').addEventListener('click', async () => {
    if (!authApi) return;
    $('loginStatus').textContent = t('login.opening');
    try { await authApi.signInWithGoogle(); }
    catch (err) {
      const code = (err && err.code) || '';
      $('loginStatus').textContent = code === 'auth/popup-closed-by-user' ? '' : t('login.failed', { msg: code || err.message });
    }
  });
  $('btnDemo').addEventListener('click', enterDemo);
  $('btnDemo2').addEventListener('click', () => { showScreen('main'); enterDemo(); });
  $('btnRecheck').addEventListener('click', () => authApi && authApi.recheckAllowed());
  $('btnSignOutDenied').addEventListener('click', () => authApi && authApi.signOutUser());

  $('fabNew').addEventListener('click', openNewSheet);
  document.querySelectorAll('#newKinds .choice').forEach((b) => b.addEventListener('click', () => chooseKind(b.dataset.kind)));
  document.querySelectorAll('.sheet [data-close]').forEach((b) => b.addEventListener('click', () => {
    const sheet = b.closest('.sheet');
    if (sheet.id === 'detailSheet') closeDetail();
    else sheet.hidden = true;
  }));
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('btnRecMark').addEventListener('click', () => {
    const st = rec.state;
    if (!st) return;
    if (st.kind === 'point') measurePoint(); else markCorner();
  });
  $('btnRecPause').addEventListener('click', () => { if (rec.active) rec.setPaused(!rec.state.paused); });
  $('btnRecUndo').addEventListener('click', () => rec.undo());
  $('btnRecFinish').addEventListener('click', finishRecording);
  $('btnRecCancel').addEventListener('click', cancelRecording);

  $('saveForm').addEventListener('submit', onSaveSubmit);
  $('saveCancel').addEventListener('click', () => $('saveDialog').close());

  $('btnMenu').addEventListener('click', () => $('menuDialog').showModal());
  $('btnList').addEventListener('click', () => ($('listPanel').hidden ? openList() : ($('listPanel').hidden = true)));
  $('gpsChip').addEventListener('click', () => toast(gpsHelp(), 7000));
  $('syncChip').addEventListener('click', syncNow);
  $('btnLocate').addEventListener('click', () => {
    const fx = lastFix();
    followUntil = 0;
    if (fx) mapCtl.centerOn(fx, 18);
    else toast(gpsHelp(), 6000);
  });
  $('btnZoomIn').addEventListener('click', () => mapCtl && mapCtl.zoomBy(1));
  $('btnZoomOut').addEventListener('click', () => mapCtl && mapCtl.zoomBy(-1));
  $('btnLayers').addEventListener('click', () => mapCtl && openLayers());

  $('menuDialog').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    $('menuDialog').close();
    const act = b.dataset.act;
    if (act === 'list') openList();
    else if (act === 'export') openExport();
    else if (act === 'import') { fillGroupDatalist(); $('importDialog').showModal(); }
    else if (act === 'settings') openSettings();
    else if (act === 'help') openHelp();
    else if (act === 'lang') changeLang(getLang() === 'pt' ? 'ja' : 'pt');
    else if (act === 'sync') syncNow();
    else if (act === 'signout') signOutOrLeave();
  }));

  $('listSearch').addEventListener('input', (e) => { filter.q = e.target.value; refreshAll(); });
  $('listKind').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filter.kind = b.dataset.k;
    $('listKind').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    refreshAll();
  }));
  $('listMine').addEventListener('change', (e) => { filter.mine = e.target.checked; refreshAll(); });
  $('listGroup').addEventListener('change', (e) => { filter.group = e.target.value; refreshAll(); });
  $('listSort').addEventListener('change', (e) => { filter.sort = e.target.value; refreshAll(); });

  $('dZoom').addEventListener('click', () => {
    const f = features.find((x) => x.id === openDetailId);
    if (f) mapCtl.fitPoints(f.vertices);
  });
  $('dShare').addEventListener('click', shareFeature);
  $('dShareKml').addEventListener('click', shareKml);
  $('dEdit').addEventListener('click', () => openDetailId && openSaveDialog(openDetailId));
  $('dArchive').addEventListener('click', archiveFeature);

  $('expScope').addEventListener('change', () => { $('expCount').textContent = t('exp.count', { n: exportScope().length }); });
  $('exportDialog').querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.fmt)));
  $('impFile').addEventListener('change', onImportFile);
  $('impOk').addEventListener('click', doImport);
  $('sOk').addEventListener('click', saveSettingsFromDialog);
}

// 自動テスト用の入口(画面の外から状態を確かめる。本番の動作には関係しない)
window.__fgm = {
  get features() { return features; },
  get recorder() { return rec.state; },
  get mapType() { return mapCtl && mapCtl.type; },
  stats: () => rec.stats()
};
