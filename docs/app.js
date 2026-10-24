/* field_gps_map — 画面全体のつなぎ役。
 *
 * 役割分担:
 *   lib/gps.js        位置情報の購読・「押した瞬間の位置」・画面の消灯防止
 *   lib/recorder.js   記録中の図形(下書き)の状態
 *   lib/map-simple.js 地図(v2.0.0 からただ1つ。高画質の衛星写真+道・川+行政境界。電波があってもなくても同じ)
 *   lib/imagery.js     地図データの自動取り込み(衛星写真の束・道と川・行政境界。Background Fetch)と読み出し
 *   lib/offline-map.js 「この辺りを保存」(OpenStreetMap の建物まで。10 km 四方と半径 100 km の2段)
 *   lib/store-*.js    保存先(本番=Firestore、試用=この端末だけ)。写真もここ
 *   lib/photos.js     写真の縮小
 *   lib/export.js     KML/GeoJSON/CSV/ZIP の書き出しと読み込み(使うときだけ読み込む)
 * ここは画面の出し分けと、ボタンとそれらの配線、更新・圏外の見張りを受け持つ。
 */
import { t, initLang, setLang, getLang, applyI18n, helpHtml, categoryKeyFromLabel, locale } from './lib/i18n.js';
import * as geo from './lib/geo.js';
import { startGps, onGps, lastFix, isFresh, bestRecentFix, keepScreenOn, gpsStatus } from './lib/gps.js';
import { createRecorder } from './lib/recorder.js';
import { createSimpleMap } from './lib/map-simple.js';
import { getSettings, saveSettings } from './lib/settings.js';
import { catColor, defaultCategory, categoriesFor } from './lib/categories.js';
import { preparePhoto, dataUrlToFile, MAX_PHOTOS } from './lib/photos.js';
import { downloadArea, listAreas, deleteArea, mergeAreas, AREA_KM, WIDE_KM } from './lib/offline-map.js';
import { loadCatalog, forgetCatalog, resetMemory, ensureAll, progress as mapProgress, onProgress as onMapProgress, afterBackground, loadVectors } from './lib/imagery.js';
import { importImagery, listImagery, deleteImagery } from './lib/user-imagery.js';
// 書き出し・読み込みは使うときだけ読み込む(起動を軽くする)
const loadExport = () => import('./lib/export.js');
const loadAdmin = () => import('./lib/admin-stats.js');

const VERSION = '2.0.0';
const $ = (id) => document.getElementById(id);
const DEMO_KEY = 'fgm.demo';
const VIEW_KEY = 'fgm.view';
const LAST_SERVER_KEY = 'fgm.lastServer';

let store = null;
let user = null;
let isAdminUser = false;    // allowedUsers の行に admin: true がある人(体験モードでは誰でも)
let features = [];          // 保存先から来た全件(アーカイブ済みを除く)
let storeMeta = { pending: 0, photosPending: 0, fromCache: true, error: '' };
let mapCtl = null;
let simpleCtl = null;
let regionVectors = { osm: [], admin: [] };   // 範囲全体の道と川・行政境界(imagery.js が自動で入れる)
let authApi = null;
let mainStarted = false;
let openDetailId = null;
let detailPhotos = [];      // 開いている記録の写真
let unwatchPhotos = null;
let pendingOpenId = null;   // 保存直後など、まだ一覧に来ていない図形を開く予約
let listWasOpen = false;
let hiddenAt = 0;
let followUntil = 0;        // 利用者が地図を動かしてから、追従を止めておく時刻
let stagedPhotos = [];      // 保存ダイアログで選んだ、まだ保存していない写真
let photoTarget = null;     // 'save' | 記録の id(詳細から追加)
let saveCategory = 'field';
let prevPending = 0;
let savedAreas = [];        // 保存した圏外用の地図(この端末だけ)
let userImagery = [];       // 取り込んだ衛星写真・空撮写真のファイル(この端末だけ)
const filter = { q: '', group: '' };
const rec = createRecorder();

// ================================================================ 起動

initLang(getSettings().lang);
applyI18n();
wireStatic();
announceUpdate();

// 地図データ(衛星写真・道・境界)は、ログインを待たずに取り込み始める(Kazさん 10/24「入れたら自動で全部」)
onMapProgress(onMapDataProgress);
setTimeout(startMapSync, 1500);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'maps-updated') { afterBackground(); refreshMapData(); }
  });
}

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
      isAdminUser = !!s.admin;
      renderMenuUser();
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
  renderMenuVersion();
  renderMenuUser();

  // 端末の保存領域を「消さないで」と頼む(容量が逼迫しても未送信の記録・写真が消されないように)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* 無視 */ }

  startGps();
  onGps(onGpsUpdate);
  savedAreas = await listAreas();
  userImagery = await listImagery();
  await initMap();

  store.subscribe((list, meta) => {
    features = list;
    storeMeta = meta;
    if (store.mode !== 'local' && !meta.fromCache) safeSet(LAST_SERVER_KEY, String(Date.now()));
    const pendingNow = (meta.pending || 0) + (meta.photosPending || 0);
    // 電波が戻って未送信がゼロになったら、何件送れたかを知らせる(jatlog と同じ)
    if (prevPending > 0 && pendingNow === 0 && navigator.onLine && store.mode !== 'local') {
      toast(t('sync.sentN', { n: prevPending }), 5000);
    }
    prevPending = pendingNow;
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
  startUpdateWatch();
}

function renderMenuVersion() {
  $('menuVersion').textContent = `v${VERSION} · ${t('menu.update')}`;
}

function renderMenuUser() {
  if (!store) return;
  $('menuEmail').textContent = store.mode === 'local' ? t('demo.note') : user.email;
  $('menuSignoutText').textContent = store.mode === 'local' ? t('menu.leaveDemo') : t('menu.signout');
  // 管理者の集計:メニューに出すかどうかだけの切り替え(記録はもともと全員が読める。書き換えの権限は変わらない)
  $('menuAdmin').hidden = !(store.mode === 'local' || isAdminUser);
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
  view: { ...(loadView() || {}) }
});

async function initMap() {
  if (!simpleCtl) {
    simpleCtl = createSimpleMap($('mapSimple'), mapHandlers());
    simpleCtl.setSatellite(getSettings().sat !== false);
    simpleCtl.setUserImagery(userImagery);
    refreshBasemap();
    refreshMapData();
  }
  useMap(simpleCtl);
}

function useMap(ctl) {
  mapCtl = ctl;
  ctl.resize();
  ctl.setFeatures(visibleFeatures());
  ctl.setDraft(rec.state);
  ctl.setMyLocation(isFresh(lastFix(), 120000) ? lastFix() : null);
  ctl.setFeaturesClickable(!tapMode());
  if (openDetailId) ctl.highlight(openDetailId);
  // 初回で保存済みの表示位置が無いなら、現在地へ寄せる
  if (!loadView()) {
    const fx = lastFix();
    if (fx) ctl.centerOn(fx, 15);
  }
}

function tapMode() {
  return rec.active && rec.state.method === 'tap';
}

function onMapTap(ll) {
  if (!rec.active || rec.state.method !== 'tap') return;
  rec.addVertex({ lat: ll.lat, lng: ll.lng, acc: null, src: 'tap' });
}

window.addEventListener('offline', () => {
  updateSyncChip();
});
window.addEventListener('online', () => {
  updateSyncChip();
  checkForUpdate({ silent: true });
  setTimeout(startMapSync, 3000);
});

// ================================================================ GPS 表示

function onGpsUpdate({ fix, status }) {
  const chip = $('gpsChip');
  const s = getSettings();
  chip.className = 'glass-btn chip tappable';
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
  // GPSで記録している間は、現在地が画面の外へ出ないよう地図を追いかける。
  // 利用者が地図を動かした直後(20秒)は追わない(確かめたい場所を見ているので)。
  if (fix && rec.active && rec.state.method !== 'tap' && Date.now() > followUntil && mapCtl) {
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

const GOAL_POINTS = 10;     // 1つの圃場の点はこのくらいまで(Kazさん 2026-10-21)

/** 種類ごとの「GPSで打つ」方式の名前(保存データの method に入る)。 */
function gpsMethodFor(kind) { return kind === 'point' ? 'gps' : 'corners'; }

function gpsBlocked() { return ['denied', 'unsupported', 'unavailable'].includes(gpsStatus()); }

function openNewSheet() {
  closeSheets();
  $('newSheet').hidden = false;
}

/** 種類を選んだら、すぐ GPS で記録を始める(位置情報が使えなければ地図をタップで)。 */
function startRecording(kind) {
  const blocked = gpsBlocked();
  rec.start(kind, blocked ? 'tap' : gpsMethodFor(kind));
  closeSheets();
  showRecPanel();
  if (blocked) toast(t('gps.denied'), 6000);
  const fx = lastFix();
  if (fx && isFresh(fx, 60000)) mapCtl.centerOn(fx, 19);
}

/** 記録の途中で「歩いて」と「地図をタップ」を切り替える。 */
function setRecMode(mode) {
  const st = rec.state;
  if (!st) return;
  if (mode === 'gps' && gpsBlocked()) { toast(t('gps.denied'), 6000); return; }
  rec.setMethod(mode === 'tap' ? 'tap' : gpsMethodFor(st.kind));
  keepScreenOn(mode !== 'tap');
  mapCtl.setFeaturesClickable(mode !== 'tap');
  if (mode === 'gps') followUntil = 0;
}

function showRecPanel() {
  const st = rec.state;
  window.__fgmRecording = true;
  keepScreenOn(st.method !== 'tap');
  $('fabNew').hidden = true;
  $('recPanel').hidden = false;
  $('mainScreen').classList.add('recording');
  document.body.classList.add('is-recording');
  mapCtl.setFeaturesClickable(st.method !== 'tap');
  renderRec();
}

function stopRecording() {
  rec.clear();
  keepScreenOn(false);
  window.__fgmRecording = false;
  $('recPanel').hidden = true;
  $('mainScreen').classList.remove('recording');
  document.body.classList.remove('is-recording');
  $('fabNew').hidden = false;
  if (mapCtl) { mapCtl.setDraft(null); mapCtl.setFeaturesClickable(true); }
  // 記録中に届いた新しい版は、記録が終わったここで入れる
  if (window.__fgmUpdatePending) setTimeout(() => location.reload(), 1200);
}

rec.onChange((st) => {
  if (!mapCtl) return;
  mapCtl.setDraft(st);
  if (st) renderRec();
});

function markLabel(st) {
  if (st.kind === 'point') return st.vertices.length ? t('rec.again') : t('rec.here');
  return st.kind === 'polygon' ? t('rec.addCorner') : t('rec.addPoint');
}

function renderRec() {
  const st = rec.state;
  if (!st) return;
  $('recKindIcon').setAttribute('href', st.kind === 'polygon' ? '#i-polygon' : st.kind === 'line' ? '#i-line' : '#i-point');
  $('recTitle').textContent = t('kind.' + st.kind);
  const tap = st.method === 'tap';
  $('recMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'tap') === tap));
  $('recHint').textContent = t(`rec.hint.${st.method}.${st.kind}`);
  const mark = $('btnRecMark');
  mark.hidden = st.method === 'tap';
  $('recMarkIcon').setAttribute('href', st.kind === 'polygon' ? '#i-corner' : '#i-point');
  $('btnRecMarkText').textContent = markLabel(st);
  $('btnRecUndo').hidden = st.kind === 'point';
  $('btnRecFinishText').textContent = st.kind === 'point' ? t('rec.savePoint') : t('rec.finish');
  $('stAreaBox').hidden = st.kind !== 'polygon';
  $('stLenLabel').textContent = st.kind === 'polygon' ? t('rec.perimeter') : st.kind === 'line' ? t('rec.length') : t('rec.coords');
  $('stGoal').textContent = st.kind === 'point' ? '' : `/ ${t('rec.goal')}`;
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
  const fresh = fx && isFresh(fx);
  $('stAcc').textContent = fresh ? `±${Math.round(fx.acc)} m` : '—';
  // GPS の位置が無いうちは、押しても入らないことが見て分かるようにする
  $('btnRecMark').classList.toggle('waiting', st.method !== 'tap' && !fresh);

  const warns = [];
  const set = getSettings();
  if (st.method !== 'tap' && fresh && fx.acc > set.maxAcc) warns.push(t('rec.warn.lowAcc', { acc: Math.round(fx.acc) }));
  if (st.kind === 'polygon' && s.selfIntersects) warns.push(t('rec.warn.cross'));
  if (st.kind !== 'point' && s.n > GOAL_POINTS + 2) warns.push(t('rec.warn.many', { n: s.n }));
  const w = $('recWarn');
  w.hidden = !warns.length;
  w.textContent = warns.join(' ');
}

/** 「ここを角に」:押した瞬間の位置で1点。待たせない。 */
function markHere() {
  const st = rec.state;
  if (!st) return;
  const fx = bestRecentFix();
  if (!fx) { toast(t('rec.waitGps'), 5000); return; }
  const last = st.vertices[st.vertices.length - 1];
  // 同じ場所での押し間違い(2度押し)を拾わない
  if (st.kind !== 'point' && last && last.src === 'gps' && Date.now() - last.t < 4000 && geo.distance(last, fx) < 2) {
    toast(t('rec.dup'));
    return;
  }
  rec.addVertex({ lat: fx.lat, lng: fx.lng, acc: fx.acc, src: 'gps', t: Date.now() });
  const n = rec.state.vertices.length;
  const acc = Math.round(fx.acc);
  const low = acc > getSettings().maxAcc;
  toast(low ? t('rec.addedLow', { n, acc }) : t('rec.added', { n, acc }), low ? 6000 : 2200);
  try { if (navigator.vibrate) navigator.vibrate(low ? [60, 80, 60] : 40); } catch { /* 無視 */ }
  const b = $('btnRecMark');
  b.classList.remove('flash');
  void b.offsetWidth;
  b.classList.add('flash');
  if (st.kind === 'point') mapCtl.centerOn({ lat: fx.lat, lng: fx.lng });
}

function finishRecording() {
  const err = rec.validate();
  if (err) { toast(t(err), 5000); return; }
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
  if (st && st.method !== 'tap' && st.kind !== 'point' && hiddenAt && Date.now() - hiddenAt > 5000) {
    toast(t('rec.wasHidden'), 8000);
  }
  hiddenAt = 0;
  maybeCheckOnReturn();
});

// ================================================================ 保存・編集

let saveTarget = null;   // null = 新規(記録中の図形) / 図形のid = 属性の編集

function renderCategoryChips() {
  const box = $('fCatChips');
  box.innerHTML = '';
  const kind = saveTarget ? (features.find((x) => x.id === saveTarget) || {}).kind : rec.state && rec.state.kind;
  categoriesFor(kind, saveCategory).forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-sel tappable' + (c.key === saveCategory ? ' on' : '');
    b.innerHTML = `<span class="cdot" style="background:${c.color}"></span><span></span>`;
    b.lastChild.textContent = t('cat.' + c.key);
    b.addEventListener('click', () => { saveCategory = c.key; renderCategoryChips(); });
    box.appendChild(b);
  });
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
    saveCategory = f.category || defaultCategory(f.kind);
    $('fGroup').value = f.group || '';
    $('fNotes').value = f.notes || '';
    $('savePhotosBox').hidden = true;     // 写真は詳細の画面で足し引きする
  } else {
    const st = rec.state;
    const s = rec.stats();
    $('saveTitle').textContent = t('save.title');
    $('saveSummary').textContent = summaryText(st.kind, s.areaM2, s.lengthM, st.vertices, lang);
    const warns = [];
    if (s.tapCount && s.tapCount < s.n) warns.push(t('save.warn.tap', { n: s.tapCount }));
    if (st.kind === 'polygon' && s.selfIntersects) warns.push(t('rec.warn.cross'));
    if (warns.length) { warn.hidden = false; warn.textContent = warns.join(' '); }
    $('fName').value = '';
    saveCategory = safeGet('fgm.lastCat.' + st.kind) || defaultCategory(st.kind);
    $('fGroup').value = safeGet('fgm.lastGroup') || '';
    $('fNotes').value = '';
    $('savePhotosBox').hidden = false;
    stagedPhotos = [];
    renderStagedPhotos();
  }
  renderCategoryChips();
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
  const category = saveCategory;
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
    kind: st.kind, method: s.tapCount === s.n ? 'tap' : gpsMethodFor(st.kind), name, category, group, notes,
    vertices: st.vertices.map((v) => ({ lat: v.lat, lng: v.lng, acc: v.acc == null ? null : v.acc, t: v.t || 0, src: v.src || 'gps' })),
    areaM2: s.areaM2 == null ? null : Math.round(s.areaM2 * 10) / 10,
    lengthM: s.lengthM == null ? null : Math.round(s.lengthM * 10) / 10,
    center: geo.centroid(st.vertices, st.kind),
    nVertices: s.n,
    accMedian: s.accMedian == null ? null : s.accMedian,
    accMax: s.accMax == null ? null : s.accMax,
    tapCount: s.tapCount,
    startedAt: st.startedAt,
    durationS: Math.round((Date.now() - st.startedAt) / 1000),
    photoCount: stagedPhotos.length,
    cover: stagedPhotos.length ? stagedPhotos[0].thumb : null
  };
  const id = store.add(docData);
  stagedPhotos.forEach((p) => store.addPhoto(id, p));
  stagedPhotos = [];
  safeSet('fgm.lastCat.' + st.kind, category);
  safeSet('fgm.lastGroup', group);
  $('saveDialog').close();
  stopRecording();
  toast(store.mode === 'local' ? t('save.ok.demo') : navigator.onLine ? t('save.ok.online') : t('save.ok.offline'), 5000);
  pendingOpenId = id;
  if (features.some((f) => f.id === id)) { pendingOpenId = null; openDetail(id); }
}

// ================================================================ 写真

function pickPhotos(target) {
  photoTarget = target;
  const count = target === 'save' ? stagedPhotos.length : detailPhotos.length;
  if (count >= MAX_PHOTOS) { toast(t('photo.max', { n: MAX_PHOTOS })); return; }
  $('photoInput').value = '';
  $('photoInput').click();
}

async function onPhotosChosen() {
  const files = [...($('photoInput').files || [])];
  if (!files.length) return;
  const target = photoTarget;
  const already = target === 'save' ? stagedPhotos.length : detailPhotos.length;
  const room = MAX_PHOTOS - already;
  if (files.length > room) toast(t('photo.max', { n: MAX_PHOTOS }));
  toast(t('photo.busy'), 10000);
  const ready = [];
  for (const f of files.slice(0, Math.max(0, room))) {
    try { ready.push(await preparePhoto(f)); }
    catch (err) { console.error(err); toast(t('photo.failed'), 5000); }
  }
  if (!ready.length) return;
  if (target === 'save') {
    stagedPhotos.push(...ready);
    renderStagedPhotos();
    hideToast();
    return;
  }
  const f = features.find((x) => x.id === target);
  if (!f) return;
  ready.forEach((p) => store.addPhoto(f.id, p));
  const patch = { photoCount: (detailPhotos.length || 0) + ready.length };
  if (!f.cover) patch.cover = ready[0].thumb;
  store.update(f.id, patch);
  toast(t('photo.added'));
}

function photoTile(src, { badge = '', onClick, onRemove } = {}) {
  const b = document.createElement('div');
  b.className = 'ph tappable';
  b.setAttribute('role', 'button');
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  b.appendChild(img);
  if (badge) { const s = document.createElement('span'); s.className = 'ph-badge'; s.textContent = badge; b.appendChild(s); }
  if (onClick) b.addEventListener('click', onClick);
  if (onRemove) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ph-x';
    x.setAttribute('aria-label', t('photo.remove'));
    x.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
    x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
    b.appendChild(x);
  }
  return b;
}

function addTile(onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ph-add tappable';
  b.innerHTML = '<svg class="ic"><use href="#i-camera"/></svg><span></span>';
  b.lastChild.textContent = t('photo.add');
  b.addEventListener('click', onClick);
  return b;
}

function renderStagedPhotos() {
  const box = $('savePhotos');
  box.innerHTML = '';
  stagedPhotos.forEach((p, i) => box.appendChild(photoTile(p.thumb, {
    onRemove: () => { stagedPhotos.splice(i, 1); renderStagedPhotos(); }
  })));
  if (stagedPhotos.length < MAX_PHOTOS) box.appendChild(addTile(() => pickPhotos('save')));
}

function renderDetailPhotos() {
  const box = $('dPhotos');
  box.innerHTML = '';
  detailPhotos.forEach((p, i) => box.appendChild(photoTile(p.thumb || p.data, {
    badge: p._pending && store.mode !== 'local' ? t('photo.pending') : '',
    onClick: () => openViewer(i)
  })));
  if (openDetailId) box.appendChild(addTile(() => pickPhotos(openDetailId)));
  if (!detailPhotos.length) {
    const s = document.createElement('span');
    s.className = 'ph-empty';
    s.textContent = t('photo.none');
    box.appendChild(s);
  }
}

let viewerIndex = 0;
function openViewer(i) {
  viewerIndex = i;
  renderViewer();
  if (!$('viewerDialog').open) $('viewerDialog').showModal();
}

function renderViewer() {
  const p = detailPhotos[viewerIndex];
  if (!p) { if ($('viewerDialog').open) $('viewerDialog').close(); return; }
  $('viewerImg').src = p.data;
  const who = (p.uploadedBy && p.uploadedBy.name) || '';
  const when = p.takenAt ? new Date(p.takenAt).toLocaleString(locale()) : '';
  $('viewerCaption').textContent = `${viewerIndex + 1} / ${detailPhotos.length} · ${t('photo.by', { name: who, date: when })}`;
  $('viewerPrev').hidden = viewerIndex === 0;
  $('viewerNext').hidden = viewerIndex >= detailPhotos.length - 1;
}

async function removeViewerPhoto() {
  const p = detailPhotos[viewerIndex];
  const fid = openDetailId;
  if (!p || !fid) return;
  const ok = await confirmDlg(t('photo.removeConfirm'), t('photo.remove'), t('common.cancel'));
  if (!ok) return;
  store.removePhoto(fid, p.id);
  const rest = detailPhotos.filter((x) => x.id !== p.id);
  store.update(fid, { photoCount: rest.length, cover: rest.length ? (rest[0].thumb || null) : null });
  $('viewerDialog').close();
  toast(t('photo.removed'));
}

// ================================================================ 一覧

function applyFilter(list) {
  const q = filter.q.trim().toLowerCase();
  const out = list.filter((f) => {
    if (filter.group && (f.group || '') !== filter.group) return false;
    if (q) {
      const hay = `${f.name || ''} ${f.group || ''} ${f.notes || ''} ${(f.createdBy && f.createdBy.name) || ''} ${t('cat.' + (f.category || 'other'))}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
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
  if ($('menuDialog').open) renderStatus();
}

/** グループの絞り込み(チップ)。グループが1つも無ければ出さない。 */
function renderGroupChips() {
  const box = $('listGroups');
  const groups = groupsList();
  if (filter.group && !groups.includes(filter.group)) filter.group = '';
  box.hidden = !groups.length;
  box.innerHTML = '';
  ['', ...groups].forEach((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-sel tappable' + (g === filter.group ? ' on' : '');
    b.textContent = g || t('list.all');
    b.addEventListener('click', () => { filter.group = g; refreshAll(); });
    box.appendChild(b);
  });
}

function renderList() {
  renderGroupChips();
  const lang = getLang();
  const vis = visibleFeatures();
  const ul = $('listItems');
  ul.innerHTML = '';
  const areas = vis.filter((f) => f.kind === 'polygon');
  const total = areas.reduce((s, f) => s + (f.areaM2 || 0), 0);
  $('listSummary').textContent = t('list.summary', {
    n: vis.length, a: areas.length, ha: (total / 10000).toLocaleString(locale(), { maximumFractionDigits: 2 })
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
    const when = f.createdAtMs ? new Date(f.createdAtMs).toLocaleDateString(locale()) : '';
    const thumb = f.cover
      ? `<img class="fl-thumb" alt="" loading="lazy">`
      : `<span class="fl-thumb" style="background:${catColor(f.category || 'other')}"><svg class="ic"><use href="#${icon}"/></svg></span>`;
    li.innerHTML = `${thumb}<span class="fl-name"></span><span class="fl-val"></span><span class="fl-sub"></span>`;
    if (f.cover) li.querySelector('img').src = f.cover;
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
  if (openDetailId !== id) {
    if (unwatchPhotos) unwatchPhotos();
    detailPhotos = [];
    unwatchPhotos = store.watchPhotos(id, (list) => {
      if (openDetailId !== id) return;
      detailPhotos = list;
      renderDetailPhotos();
      if ($('viewerDialog').open) renderViewer();
    });
  }
  openDetailId = id;
  mapCtl.highlight(id);
  renderDetail(id);
  renderDetailPhotos();
  $('detailSheet').hidden = false;
  if (fit) mapCtl.fitPoints(f.vertices);
  if (location.hash !== `#f=${id}`) history.replaceState(null, '', `#f=${id}`);
}

function closeDetail() {
  $('detailSheet').hidden = true;
  openDetailId = null;
  if (unwatchPhotos) { unwatchPhotos(); unwatchPhotos = null; }
  detailPhotos = [];
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
    stats.push([t('rec.area'), geo.fmtHa(f.areaM2, lang), `${Math.round(f.areaM2 || 0).toLocaleString(locale())} m²`]);
    stats.push([t('rec.perimeter'), geo.fmtLength(f.lengthM, lang)]);
  } else if (f.kind === 'line') {
    stats.push([t('rec.length'), geo.fmtLength(f.lengthM, lang)]);
  } else {
    const v = f.vertices[0];
    stats.push([t('rec.coords'), `${v.lat.toFixed(6)}, ${v.lng.toFixed(6)}`]);
  }
  $('dStats').innerHTML = '';
  stats.forEach(([k, v, sub]) => {
    const d = document.createElement('div');
    d.innerHTML = '<span class="stat-label"></span><strong></strong><small></small>';
    d.querySelector('span').textContent = k;
    d.querySelector('strong').textContent = v;
    d.querySelector('small').textContent = sub || '';
    $('dStats').appendChild(d);
  });
  const pts = [String((f.vertices || []).length)];
  if (f.accMedian != null) pts.push(`GPS ±${Math.round(f.accMedian)} m`);
  if (f.tapCount) pts.push(t('d.tappedN', { n: f.tapCount }));
  if (f.method === 'import') pts.push(t('method.import'));
  const who = (f.createdBy && (f.createdBy.name || f.createdBy.email)) || '';
  const when = f.createdAtMs ? new Date(f.createdAtMs).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const meta = [
    [t('d.by'), [who, when].filter(Boolean).join(' · ') || '-'],
    [t('rec.vertices'), pts.join(' · ')]
  ];
  if (f.notes) meta.push([t('save.notes'), f.notes]);
  if (f._pending) meta.push([t('d.sync'), t('d.sync.pending')]);
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
  lines.push(`${t('d.by')}: ${(f.createdBy && f.createdBy.name) || ''} (${f.createdAtMs ? new Date(f.createdAtMs).toLocaleDateString(locale()) : ''})`);
  lines.push(`Google Maps: https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
  if (store.mode !== 'local') lines.push(`${t('d.appLink')}: ${location.origin}${location.pathname}#f=${f.id}`);
  return lines.join('\n');
}

async function shareFeature() {
  const f = features.find((x) => x.id === openDetailId);
  if (!f) return;
  const text = shareText(f);
  if (navigator.share) {
    // 写真があれば一緒に送る(WhatsApp は文章+写真を1度に受け取れる)
    const files = detailPhotos.slice(0, MAX_PHOTOS).map((p, i) => dataUrlToFile(p.data, `${safeFileName(f.name)}_${i + 1}.jpg`));
    if (files.length && navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ title: f.name, text, files }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
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
  const { toKML, download } = await loadExport();
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

// ================================================================ 管理者:チームの集計

const adm = { period: 'today', date: '' };

function admPeriodLabel() {
  return adm.period === 'day' ? adm.date : t('adm.' + adm.period);
}

async function admCurrent() {
  const A = await loadAdmin();
  const list = A.inRange(features, A.periodRange(adm.period, adm.date)).sort((a, b) => A.recordedAt(b) - A.recordedAt(a));
  return { A, list, sum: A.summarize(list) };
}

function openAdmin() {
  $('adminDialog').showModal();
  renderAdmin();
}

const escHtml = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function renderAdmin() {
  const dlg = $('adminDialog');
  dlg.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === adm.period));
  $('admDate').classList.toggle('on', adm.period === 'day');
  const { A, list, sum } = await admCurrent();
  const tt = sum.total;
  const lang = getLang();
  const multiDay = !['today', 'yesterday', 'day'].includes(adm.period);
  const hm = (ms) => (ms && ms < Infinity ? A.localTime(ms) : '');
  const md = (ms) => (ms && ms < Infinity ? A.localDate(ms).slice(5) : '');
  const ha = (x) => (x.polygons ? geo.fmtHa(x.areaM2, lang) : '');
  const km = (x) => (x.lines ? geo.fmtLength(x.lengthM, lang) : '');

  $('admTotals').innerHTML = [
    [tt.n, t('adm.records'), t('adm.kinds', { p: tt.polygons, l: tt.lines, pt: tt.points })],
    [geo.fmtHa(tt.areaM2, lang), t('adm.area')],
    [geo.fmtLength(tt.lengthM, lang), t('adm.length')],
    [tt.photos, t('adm.photos')],
    [tt.people, t('adm.people')]
  ].map(([v, k, sub]) => `<div class="adm-card"><b>${escHtml(v)}</b><span>${escHtml(k)}${sub ? '<br>' + escHtml(sub) : ''}</span></div>`).join('');

  const pT = $('admPeople');
  if (!sum.people.length) pT.innerHTML = `<tr><td>${escHtml(t('adm.none'))}</td></tr>`;
  else {
    pT.innerHTML = `<tr><th>${escHtml(t('adm.col.person'))}</th><th class="num">${escHtml(t('adm.col.n'))}</th><th class="num">${escHtml(t('adm.col.area'))}</th><th class="num">${escHtml(t('adm.col.len'))}</th><th>${escHtml(multiDay ? t('adm.col.date') : t('adm.col.time'))}</th></tr>`
      + sum.people.map((p) => `<tr><td class="who">${escHtml(p.name)}${p.email && p.email !== p.name ? `<small>${escHtml(p.email)}</small>` : ''}</td>`
        + `<td class="num">${p.n}</td><td class="num">${escHtml(ha(p))}</td><td class="num">${escHtml(km(p))}</td>`
        + `<td>${escHtml(multiDay ? `${md(p.first)} – ${md(p.last)}` : `${hm(p.first)} – ${hm(p.last)}`)}</td></tr>`).join('');
  }

  $('admDaysBox').hidden = !multiDay || !sum.days.length;
  $('admDays').innerHTML = `<tr><th>${escHtml(t('adm.col.date'))}</th><th class="num">${escHtml(t('adm.col.n'))}</th><th class="num">${escHtml(t('adm.people'))}</th><th class="num">${escHtml(t('adm.col.area'))}</th><th class="num">${escHtml(t('adm.col.len'))}</th></tr>`
    + sum.days.map((d) => `<tr data-day="${d.date}"><td>${d.date}</td><td class="num">${d.n}</td><td class="num">${d.people}</td><td class="num">${escHtml(ha(d))}</td><td class="num">${escHtml(km(d))}</td></tr>`).join('');
  // 日をタップすると、その日だけの集計に切り替える
  $('admDays').querySelectorAll('[data-day]').forEach((tr) => tr.addEventListener('click', () => {
    adm.period = 'day';
    adm.date = tr.dataset.day;
    $('admDate').value = adm.date;
    renderAdmin();
  }));

  const ul = $('admList');
  ul.innerHTML = '';
  if (!list.length) ul.innerHTML = `<li class="empty">${escHtml(t('adm.none'))}</li>`;
  const MAX = 200;
  list.slice(0, MAX).forEach((f) => {
    const li = document.createElement('li');
    const ms = A.recordedAt(f);
    const val = f.kind === 'polygon' ? geo.fmtHa(f.areaM2, lang) : f.kind === 'line' ? geo.fmtLength(f.lengthM, lang) : '';
    li.innerHTML = '<span class="t"></span><span class="n"></span><span class="v"></span>';
    li.querySelector('.t').textContent = `${multiDay ? md(ms) + ' ' : ''}${hm(ms)}`;
    li.querySelector('.n').textContent = `${f.name || t('d.noName')} · ${(f.createdBy && f.createdBy.name) || ''}`;
    li.querySelector('.v').textContent = val;
    li.addEventListener('click', () => { $('adminDialog').close(); openDetail(f.id, { fit: true }); });
    ul.appendChild(li);
  });
  if (list.length > MAX) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('adm.more', { n: list.length - MAX });
    ul.appendChild(li);
  }
}

async function admExport(fmt) {
  const { A, list, sum } = await admCurrent();
  if (!list.length) { toast(t('adm.none')); return; }
  const { toKML, toCSV, download, stamp } = await loadExport();
  const tag = adm.period === 'day' ? adm.date : adm.period === 'today' ? A.localDate(Date.now()) : adm.period;
  const base = `field_gps_map_${tag}_${stamp()}`;
  const asc = [...list].reverse();      // ファイルの中は古い順
  const opts = { title: `Field GPS Map ${admPeriodLabel()}`, catName: (k) => t('cat.' + k) };
  if (fmt === 'csv') download(toCSV(asc, opts), `${base}.csv`, 'text/csv;charset=utf-8');
  else if (fmt === 'summary') download(A.summaryCSV(sum, admPeriodLabel()), `${base}_summary.csv`, 'text/csv;charset=utf-8');
  else download(toKML(asc, opts), `${base}.kml`, 'application/vnd.google-earth.kml+xml');
  toast(t('exp.done', { n: list.length }));
}

// ================================================================ 書き出し・読み込み

function exportList() {
  return [...features].sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
}

function openExport() {
  $('expCount').textContent = t('exp.count', { n: features.length });
  $('exportDialog').showModal();
}

async function doExport(fmt) {
  const list = exportList();
  if (!list.length) { toast(t('exp.none')); return; }
  const { toKML, toCSV, toZip, download, stamp } = await loadExport();
  const base = `field_gps_map_${stamp()}`;
  const opts = { title: `Field GPS Map ${stamp()}`, catName: (k) => t('cat.' + k) };
  if (fmt === 'kml') download(toKML(list, opts), `${base}.kml`, 'application/vnd.google-earth.kml+xml');
  else if (fmt === 'csv') download(toCSV(list, opts), `${base}.csv`, 'text/csv;charset=utf-8');
  else {
    toast(t('exp.busy'), 20000);
    const photos = [];
    for (const f of list.filter((x) => x.photoCount)) {
      try {
        const ps = await store.getPhotos(f.id);
        ps.forEach((p, i) => photos.push({ name: `photos/${safeFileName(f.name)}_${f.id.slice(-4)}_${i + 1}.jpg`, file: dataUrlToFile(p.data, 'p.jpg') }));
      } catch (err) { console.warn('photos', f.id, err); }
    }
    download(await toZip(list, opts, t('exp.readme'), photos), `${base}.zip`);
  }
  toast(t('exp.done', { n: list.length }));
}

let importItems = [];

async function onImportFile() {
  const file = $('impFile').files[0];
  importItems = [];
  $('impOk').disabled = true;
  if (!file) { $('impPreview').textContent = ''; return; }
  try {
    const { parseKML, parseGeoJSON, readKmz } = await loadExport();
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

async function doImport() {
  if (!importItems.length) return;
  const { measure } = await loadExport();
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
      tapCount: 0, startedAt: now, durationS: 0, photoCount: 0, cover: null
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

// ================================================================ 送信の表示

function pendingCount() { return (storeMeta.pending || 0) + (storeMeta.photosPending || 0); }

function updateSyncChip() {
  const chip = $('syncChip');
  if (!store) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.className = 'glass-btn chip tappable';
  const icon = $('syncIcon');
  if (store.mode === 'local') {
    chip.classList.add('sync-demo');
    icon.setAttribute('href', '#i-cloud-off');
    $('syncText').textContent = t('sync.demo');
    return;
  }
  const n = pendingCount();
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
  if (!navigator.onLine) { toast(t('sync.offlineHelp', { n: pendingCount() }), 6000); return; }
  toast(t('sync.trying'));
  const ok = await store.flush();
  toast(ok ? t('sync.done') : t('sync.wait'), 5000);
}

// ================================================================ 圏外の準備・自動更新(jatlog_offline に倣う)

/** Service Worker に「アプリ本体が全部キャッシュに入っているか」を尋ねる。 */
function askSw(msg, ms = 3000) {
  return new Promise((resolve) => {
    const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctl) { resolve(null); return; }
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    try { ctl.postMessage(msg, [ch.port2]); } catch { clearTimeout(timer); resolve(null); }
  });
}

async function renderStatus() {
  const maps = $('stMaps');
  maps.className = 'status-row ' + (savedAreas.length ? 'ok' : 'warn');
  maps.querySelector('span').textContent = savedAreas.length ? t('off.map.count', { n: savedAreas.length }) : t('off.map.none');

  const sat = $('stSat');
  sat.className = 'status-row ' + (mapProgress.done ? 'ok' : 'warn');
  sat.querySelector('span').textContent = mapDataText();

  const off = $('stOffline');
  const st = await askSw({ type: 'status' });
  const ready = !!(st && st.ready);
  off.className = 'status-row ' + (ready ? 'ok' : 'warn');
  off.querySelector('span').textContent = ready ? t('off.ready') : t('off.notReady');

  const pend = $('stPending');
  const n = pendingCount();
  pend.className = 'status-row ' + (store && store.mode === 'local' ? '' : n ? 'warn' : 'ok');
  pend.querySelector('use').setAttribute('href', n ? '#i-cloud-off' : '#i-cloud-ok');
  pend.querySelector('span').textContent = !store ? '' : store.mode === 'local' ? t('off.demo') : n ? t('off.pending', { n }) : t('off.allSent');

  const last = Number(safeGet(LAST_SERVER_KEY) || 0);
  $('stLast').hidden = !store || store.mode === 'local';
  $('stLast').textContent = last ? t('off.lastSync', { time: new Date(last).toLocaleString(locale()) }) : t('off.never');
}

/** 更新したあとの最初の起動で「v○ に更新しました」と知らせる。 */
function announceUpdate() {
  const prev = safeGet('fgm.version');
  if (prev && prev !== VERSION) setTimeout(() => toast(t('upd.done', { v: VERSION }), 5000), 1500);
  safeSet('fgm.version', VERSION);
}

let lastUpdateCheck = 0;

/**
 * 新しい版があるか確かめる。sw.js が変わっていれば、ブラウザが新しい SW を入れ、
 * skipWaiting → controllerchange → index.html の仕掛けで再読み込みされる。
 * silent = 自動の確認(結果を画面に出さない)。手動はメニューの「アップデートを確認」。
 */
async function checkForUpdate({ silent = false } = {}) {
  lastUpdateCheck = Date.now();
  if (!('serviceWorker' in navigator)) { if (!silent) toast(t('upd.unsupported'), 5000); return; }
  if (!navigator.onLine) { if (!silent) toast(t('upd.offline'), 5000); return; }
  let reg;
  try { reg = await navigator.serviceWorker.getRegistration(); } catch { reg = null; }
  if (!reg) { if (!silent) toast(t('upd.unsupported'), 5000); return; }
  let found = false;
  const onFound = () => { found = true; };
  reg.addEventListener('updatefound', onFound);
  if (!silent) toast(t('upd.checking'));
  try { await reg.update(); } catch { if (!silent) toast(t('upd.offline'), 5000); reg.removeEventListener('updatefound', onFound); return; }
  setTimeout(() => {
    reg.removeEventListener('updatefound', onFound);
    if (found || reg.installing || reg.waiting) { if (!silent || window.__fgmRecording) toast(t('upd.found'), 5000); }
    else if (!silent) toast(t('upd.latest', { v: VERSION }));
  }, 1200);
}

function startUpdateWatch() {
  setTimeout(() => checkForUpdate({ silent: true }), 8000);
  setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate({ silent: true }); }, 30 * 60 * 1000);
  window.addEventListener('fgm-update-deferred', () => {
    $('updDot').hidden = false;
    $('menuUpdDot').hidden = false;
    toast(t('upd.deferred'), 6000);
  });
}

function maybeCheckOnReturn() {
  // アプリに戻ってきたとき(前回の確認から5分以上たっていれば)
  if (mainStarted && document.visibilityState === 'visible' && Date.now() - lastUpdateCheck > 5 * 60 * 1000) {
    checkForUpdate({ silent: true });
  }
}

// ================================================================ 設定・言語・ヘルプ・メニュー

function changeLang(lang) {
  setLang(lang);
  saveSettings({ lang });
  applyI18n();
  refreshAll();
  if (rec.active) renderRec();
  if (mapCtl) useMap(mapCtl);
  renderMenuUser();
  renderMenuVersion();
  if (openDetailId) renderDetailPhotos();
  updateSyncChip();
  document.querySelectorAll('.lang-switch button, .lang-list button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

function openLangDialog() {
  document.querySelectorAll('.lang-list button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  $('langDialog').showModal();
}

function openHelp() {
  $('helpBody').innerHTML = helpHtml();
  const d = $('helpDialog');
  d.showModal();
  // 開くと一番下の「閉じる」にフォーカスが当たって末尾までスクロールされるので、先頭に戻す
  d.scrollTop = 0;
  requestAnimationFrame(() => { d.scrollTop = 0; });
}

function openMenu() {
  renderStatus();
  $('menuDialog').showModal();
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
  const opts = [['sat', t('map.type.sat')], ['plain', t('map.type.plain')]];
  d.innerHTML = `<h2></h2><nav class="menu-items lang-list"></nav>
    <section class="offmap mapdata"><h3></h3><p class="mapdata-state"></p><div class="mapdata-bar"><i></i></div><p class="muted small mapdata-note"></p><button type="button" class="btn-secondary btn-wide tappable mapdata-go"><svg class="ic"><use href="#i-download"/></svg><span></span></button></section>
    <section class="offmap"><h3></h3><p class="muted small"></p><button type="button" class="btn-secondary btn-wide tappable offmap-save"><svg class="ic"><use href="#i-download"/></svg><span></span></button><button type="button" class="btn-secondary btn-wide tappable offmap-wide"><svg class="ic"><use href="#i-download"/></svg><span></span></button><ul class="offmap-list"></ul></section>
    <section class="offmap offimg"><h3></h3><p class="muted small"></p><button type="button" class="btn-secondary btn-wide tappable offimg-add"><svg class="ic"><use href="#i-upload"/></svg><span></span></button><input type="file" class="offimg-file" accept=".tif,.tiff,.kmz,.kml,image/tiff,application/vnd.google-earth.kmz" hidden><ul class="offmap-list offimg-list"></ul></section>
    <div class="dlg-buttons"><button type="button" class="btn-ghost"></button></div>`;
  d.querySelector('h2').textContent = t('map.layers');
  // 地図データ(自動で入るもの)の状態
  const md = d.querySelector('.mapdata');
  md.querySelector('h3').textContent = t('mapdata.title');
  md.querySelector('.mapdata-note').textContent = t('mapdata.note');
  md.querySelector('.mapdata-go span').textContent = t('mapdata.retry');
  md.querySelector('.mapdata-go').addEventListener('click', () => { startMapSync(); renderMapData(md); });
  renderMapData(md);
  const off = onMapProgress(() => renderMapData(md));
  // この辺りを保存(建物まで)
  const om = d.querySelectorAll('.offmap')[1];
  om.querySelector('h3').textContent = t('off.map.title');
  om.querySelector('p').textContent = t('off.map.note', { km: AREA_KM, r: WIDE_KM / 2 });
  om.querySelector('.offmap-save span').textContent = t('off.map.save', { km: AREA_KM });
  om.querySelector('.offmap-wide span').textContent = t('off.map.saveWide', { r: WIDE_KM / 2 });
  om.querySelector('.offmap-save').addEventListener('click', () => { d.close(); saveOfflineArea(false); });
  om.querySelector('.offmap-wide').addEventListener('click', () => { d.close(); saveOfflineArea(true); });
  renderAreaList(om.querySelector('.offmap-list'), d);
  d.querySelector('.offimg h3').textContent = t('off.img.title');
  d.querySelector('.offimg p').textContent = t('off.img.note');
  d.querySelector('.offimg-add span').textContent = t('off.img.add');
  d.querySelector('.offimg-add').addEventListener('click', () => d.querySelector('.offimg-file').click());
  d.querySelector('.offimg-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    d.close();
    if (file) addImageryFile(file);
  });
  renderImageryList(d.querySelector('.offimg-list'), d);
  d.querySelector('.dlg-buttons button').textContent = t('common.close');
  const nav = d.querySelector('nav');
  const satOn = getSettings().sat !== false;
  opts.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.classList.toggle('on', (k === 'sat') === satOn);
    b.innerHTML = `<svg class="ic"><use href="#i-check"/></svg><span></span>`;
    b.querySelector('span').textContent = label;
    b.addEventListener('click', () => {
      d.close();
      saveSettings({ sat: k === 'sat' });
      if (simpleCtl) simpleCtl.setSatellite(k === 'sat');
    });
    nav.appendChild(b);
  });
  d.querySelector('.dlg-buttons button').addEventListener('click', () => d.close());
  d.addEventListener('close', () => { off(); d.remove(); });
  document.body.appendChild(d);
  d.showModal();
}

// ================================================================ 地図データ(衛星写真・道と川・行政境界。自動で全部入れる)

const fmtMB = (b) => (b / 1048576).toLocaleString(locale(), { maximumFractionDigits: 0 });

function mapDataText() {
  const p = mapProgress;
  if (!p.total) return navigator.onLine ? t('mapdata.checking') : t('mapdata.waiting');
  if (p.done) return t('mapdata.ready', { mb: fmtMB(p.total) });
  const pct = Math.floor((p.have / p.total) * 100);
  if (p.running) {
    const v = { pct, have: fmtMB(p.have), total: fmtMB(p.total) };
    return p.mode === 'background' ? t('mapdata.busyBg', v) : t('mapdata.busy', v);
  }
  return navigator.onLine ? t('mapdata.partial', { pct }) : t('mapdata.waitingPct', { pct });
}

function renderMapData(sec) {
  const p = mapProgress;
  sec.querySelector('.mapdata-state').textContent = mapDataText();
  sec.querySelector('.mapdata-bar i').style.width = `${p.total ? Math.round((p.have / p.total) * 100) : 0}%`;
  sec.querySelector('.mapdata-bar').hidden = !p.total || p.done;
  sec.querySelector('.mapdata-go').hidden = p.done || p.running || !navigator.onLine;
}

/** 取り込みを始める(足りない分だけ。電波が無ければ何もしない)。起動・電波が戻ったとき・手動で呼ぶ。 */
function startMapSync() {
  return ensureAll().then(() => refreshMapData()).catch((err) => console.warn('map data', err));
}

let mapPaintAt = 0;
let mapToldStart = false;
function onMapDataProgress(p) {
  if (p.running && !mapToldStart && p.have < p.total && mainStarted) {
    mapToldStart = true;
    const v = { mb: fmtMB(p.total - p.have) };
    toast(p.mode === 'background' ? t('mapdata.startBg', v) : t('mapdata.start', v), 8000);
  }
  // 入ったタイルが地図に出るよう、時々描き直す
  if (Date.now() - mapPaintAt > 3000) { mapPaintAt = Date.now(); resetMemory(); refreshImageryOnly(); }
  if (p.done && mapToldStart) { mapToldStart = false; toast(t('mapdata.done'), 6000); refreshMapData(); }
  if ($('menuDialog').open) renderStatus();
}

async function refreshImageryOnly() {
  if (simpleCtl) simpleCtl.setImagery(await loadCatalog());
}

/** 目録・道と川・行政境界を読み直して地図に渡す(取り込みが済んだあとなど)。 */
async function refreshMapData() {
  forgetCatalog();
  resetMemory();
  regionVectors = await loadVectors();
  if (!simpleCtl) return;
  simpleCtl.setImagery(await loadCatalog());
  simpleCtl.setAdmin(regionVectors.admin);
  refreshBasemap();
}

// ================================================================ 圏外用の地図(OpenStreetMap を端末に保存)

function refreshBasemap() {
  // 範囲全体の道・川(自動)と、「この辺りを保存」で入れた分(建物まで)を合わせて描く
  const areas = regionVectors.osm.map((data) => ({ data })).concat(savedAreas);
  if (simpleCtl) simpleCtl.setBasemap(mergeAreas(areas));
  if ($('menuDialog').open) renderStatus();
}

function refreshImagery() {
  if (simpleCtl) simpleCtl.setUserImagery(userImagery);
}

/** いま地図の真ん中に見えている所を中心に、地図(と範囲内なら衛星写真)を取り込む。
 *  wide = false:一辺 AREA_KM km、建物まで。wide = true:一辺 WIDE_KM km、道・川・集落名だけ。 */
async function saveOfflineArea(wide) {
  if (!navigator.onLine) { toast(t('off.map.offline'), 6000); return; }
  const v = (mapCtl && mapCtl.getView && mapCtl.getView()) || lastFix();
  if (!v) return;
  toast(t('off.map.busy'), 300000);
  try {
    const area = await downloadArea({ lat: v.lat, lng: v.lng }, {
      wide,
    });
    savedAreas = await listAreas();
    refreshBasemap();
    toast(t('off.map.done', { name: area.name, n: area.n.toLocaleString(locale()) }), 7000);
  } catch (err) {
    console.warn('offline map', err);
    toast(t('off.map.fail'), 7000);
  }
}

// ================================================================ 手持ちの写真ファイル(GeoTIFF・KMZ)

/** 画像の範囲がちょうど画面に入るズーム。 */
function zoomToFit(L) {
  const cosl = Math.cos((L.center.lat * Math.PI) / 180);
  const sizeM = Math.max((L.bbox[2] - L.bbox[0]) * 111320, (L.bbox[3] - L.bbox[1]) * 111320 * cosl, 50);
  const px = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(8, Math.min(19, Math.floor(Math.log2((156543.03 * cosl * px) / (sizeM * 1.15)))));
}

function showImageryLayer(L) {
  mapCtl.centerOn(L.center, zoomToFit(L));
}

async function addImageryFile(file) {
  toast(t('off.img.busy', { done: 0, total: '…' }), 600000);
  try {
    const L = await importImagery(file, (done, total) => updateToast(t('off.img.busy', { done, total }), 600000));
    userImagery = await listImagery();
    refreshImagery();
    showImageryLayer(L);
    toast(t('off.img.done', { name: L.name, res: fmtRes(L.res) }), 7000);
  } catch (err) {
    console.warn('imagery import', err);
    const code = err && err.code;
    toast(code ? t('off.img.err.' + code) : t('off.img.fail', { msg: (err && err.message) || '' }), 10000);
  }
}

function fmtRes(m) {
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(m < 10 ? 1 : 0)} m`;
}

function renderImageryList(ul, dlg) {
  ul.innerHTML = '';
  userImagery.slice().sort((a, b) => b.addedAt - a.addedAt).forEach((L) => {
    const li = document.createElement('li');
    li.innerHTML = '<button type="button" class="offmap-go tappable"><strong></strong><span class="muted small"></span></button><button type="button" class="icon-btn tappable offmap-del"><svg class="ic"><use href="#i-close"/></svg></button>';
    li.querySelector('strong').textContent = L.name;
    li.querySelector('span').textContent = t('off.img.item', {
      date: new Date(L.addedAt).toLocaleDateString(locale()), res: fmtRes(L.res),
      mb: (L.bytes / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 })
    });
    li.querySelector('.offmap-del').setAttribute('aria-label', t('off.map.remove'));
    li.querySelector('.offmap-go').addEventListener('click', () => { dlg.close(); showImageryLayer(L); });
    li.querySelector('.offmap-del').addEventListener('click', async () => {
      dlg.close();
      const ok = await confirmDlg(t('off.img.removeConfirm', { name: L.name }), t('off.map.remove'), t('common.cancel'));
      if (!ok) return;
      await deleteImagery(L.id);
      userImagery = await listImagery();
      refreshImagery();
    });
    ul.appendChild(li);
  });
}

function renderAreaList(ul, dlg) {
  ul.innerHTML = '';
  savedAreas.slice().sort((a, b) => b.savedAt - a.savedAt).forEach((a) => {
    const li = document.createElement('li');
    li.innerHTML = '<button type="button" class="offmap-go tappable"><strong></strong><span class="muted small"></span></button><button type="button" class="icon-btn tappable offmap-del"><svg class="ic"><use href="#i-close"/></svg></button>';
    li.querySelector('strong').textContent = a.name;
    li.querySelector('span').textContent = [
      a.kind === 'wide' ? t('off.map.kindWide', { r: WIDE_KM / 2 }) : t('off.map.kindNear', { km: AREA_KM }),
      t('off.map.item', { date: new Date(a.savedAt).toLocaleDateString(locale()), n: a.n.toLocaleString(locale()) }),
      a.sat ? t('off.map.withSat') : ''
    ].filter(Boolean).join(' · ');
    li.querySelector('.offmap-del').setAttribute('aria-label', t('off.map.remove'));
    li.querySelector('.offmap-go').addEventListener('click', () => { dlg.close(); mapCtl.centerOn(a.center, a.kind === 'wide' ? 10 : 15); });
    li.querySelector('.offmap-del').addEventListener('click', async () => {
      dlg.close();
      const ok = await confirmDlg(t('off.map.removeConfirm', { name: a.name }), t('off.map.remove'), t('common.cancel'));
      if (!ok) return;
      await deleteArea(a.id);
      savedAreas = await listAreas();
      // 衛星写真は消さない(範囲全体を常に入れておくため)
      refreshBasemap();
    });
    ul.appendChild(li);
  });
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
  // 同じ要素のまま文言だけ変わったときも、出てくる動きをもう一度見せる
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
/** 進み具合など、出ているトーストの文言だけを差し替える(出てくる動きをくり返さない)。 */
function updateToast(msg, ms) {
  const el = $('toast');
  if (el.hidden) { toast(msg, ms); return; }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }

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
  document.querySelectorAll('.lang-switch button, .lang-list button').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === getLang());
    b.addEventListener('click', () => {
      changeLang(b.dataset.lang);
      if ($('langDialog').open) $('langDialog').close();
    });
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
  document.querySelectorAll('#newKinds .choice').forEach((b) => b.addEventListener('click', () => startRecording(b.dataset.kind)));
  $('recMode').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setRecMode(b.dataset.mode)));
  document.querySelectorAll('.sheet [data-close]').forEach((b) => b.addEventListener('click', () => {
    const sheet = b.closest('.sheet');
    if (sheet.id === 'detailSheet') closeDetail();
    else sheet.hidden = true;
  }));
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('btnRecMark').addEventListener('click', markHere);
  $('btnRecUndo').addEventListener('click', () => rec.undo());
  $('btnRecFinish').addEventListener('click', finishRecording);
  $('btnRecCancel').addEventListener('click', cancelRecording);

  $('saveForm').addEventListener('submit', onSaveSubmit);
  $('saveCancel').addEventListener('click', () => $('saveDialog').close());
  $('photoInput').addEventListener('change', onPhotosChosen);

  $('viewerPrev').addEventListener('click', () => { if (viewerIndex > 0) { viewerIndex--; renderViewer(); } });
  $('viewerNext').addEventListener('click', () => { if (viewerIndex < detailPhotos.length - 1) { viewerIndex++; renderViewer(); } });
  $('viewerRemove').addEventListener('click', removeViewerPhoto);
  let touchX = null;
  $('viewerDialog').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('viewerDialog').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (dx > 50 && viewerIndex > 0) { viewerIndex--; renderViewer(); }
    else if (dx < -50 && viewerIndex < detailPhotos.length - 1) { viewerIndex++; renderViewer(); }
  });

  $('btnMenu').addEventListener('click', openMenu);
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
    if (act === 'export') openExport();
    else if (act === 'admin') openAdmin();
    else if (act === 'import') { fillGroupDatalist(); $('importDialog').showModal(); }
    else if (act === 'help') openHelp();
    else if (act === 'lang') openLangDialog();
    else if (act === 'signout') signOutOrLeave();
  }));

  $('menuUpdate').addEventListener('click', () => { $('menuDialog').close(); checkForUpdate({ silent: false }); });
  $('listSearch').addEventListener('input', (e) => { filter.q = e.target.value; refreshAll(); });
  $('dShare').addEventListener('click', shareFeature);
  $('dShareKml').addEventListener('click', shareKml);
  $('dEdit').addEventListener('click', () => openDetailId && openSaveDialog(openDetailId));
  $('dArchive').addEventListener('click', archiveFeature);

  $('adminDialog').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { adm.period = b.dataset.p; renderAdmin(); }));
  $('admDate').addEventListener('change', (e) => { if (e.target.value) { adm.period = 'day'; adm.date = e.target.value; renderAdmin(); } });
  $('adminDialog').querySelectorAll('[data-adm]').forEach((b) => b.addEventListener('click', () => admExport(b.dataset.adm)));
  $('exportDialog').querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.fmt)));
  $('impFile').addEventListener('change', onImportFile);
  $('impOk').addEventListener('click', doImport);
}

// 自動テスト用の入口(画面の外から状態を確かめる。本番の動作には関係しない)
window.__fgm = {
  get features() { return features; },
  get recorder() { return rec.state; },
  get photos() { return detailPhotos; },
  get savedAreas() { return savedAreas; },
  get userImagery() { return userImagery; },
  get mapData() { return { ...mapProgress }; },
  syncMapData: () => startMapSync(),
  // 範囲全体の道と川・行政境界が読めているか(数だけ)
  get vectors() {
    const n = (l, k) => l.reduce((s, a) => s + ((a && a[k]) || []).length, 0);
    return { osm: regionVectors.osm.length, admin: regionVectors.admin.length, adminLines: n(regionVectors.admin, 'lines'), adminLabels: n(regionVectors.admin, 'labels') };
  },
  get map() { return mapCtl; },
  get version() { return VERSION; },
  stats: () => rec.stats(),
  checkForUpdate
};
