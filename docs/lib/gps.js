/* field_gps_map — GPS(端末の位置情報)の購読、平均化、画面の消灯防止。
 *
 * 位置情報は watchPosition を1本だけ張り、全画面で共有する(複数張ると端末によっては
 * 互いに測位を奪い合い、更新間隔が乱れる)。
 *
 * ★ ブラウザの制約(避けられない):
 *   画面が消える・別のアプリに切り替えると、ブラウザは位置情報の更新を止める。
 *   歩いて境界を記録している最中にこれが起きると、その間の軌跡が抜ける。
 *   そのため記録中は Screen Wake Lock で画面を点けたままにし、抜けが起きたことを
 *   検出して利用者に知らせる(黙って直線で結ばない)。
 */

const listeners = new Set();
let watchId = null;
let last = null;          // 最新の測位 { lat, lng, acc, t, alt, speed, heading }
let status = 'idle';      // idle | waiting | ok | denied | unavailable | unsupported
let lastError = '';

function emit() {
  const s = { fix: last, status, error: lastError };
  listeners.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
}

export function onGps(fn) {
  listeners.add(fn);
  fn({ fix: last, status, error: lastError });
  return () => listeners.delete(fn);
}

export function lastFix() { return last; }
export function gpsStatus() { return status; }

/** 最新の測位が「今の位置」として使える新しさか(既定15秒以内)。 */
export function isFresh(fix = last, ms = 15000) {
  return !!fix && Date.now() - fix.t < ms;
}

export function startGps() {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) { status = 'unsupported'; emit(); return; }
  status = 'waiting';
  emit();
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      last = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        acc: p.coords.accuracy,
        alt: p.coords.altitude,
        speed: p.coords.speed,
        heading: p.coords.heading,
        // 端末の時計ではなく測位の時刻を使う(p.timestamp)。ただし未来の値を返す端末があるので丸める。
        t: Math.min(p.timestamp || Date.now(), Date.now())
      };
      status = 'ok';
      lastError = '';
      emit();
    },
    (err) => {
      if (err.code === 1) { status = 'denied'; lastError = err.message; }
      else if (err.code === 2) { status = 'unavailable'; lastError = err.message; }
      // code 3 (timeout) は電波の悪い場所でよく起きるので状態を落とさない。
      emit();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
}

export function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  status = 'idle';
  emit();
}

/**
 * 一定時間、測位を集める(角の記録・地点の記録)。
 *   seconds   … 集める時間
 *   maxAcc    … これより誤差の大きい測位は使わない(1つも無ければ最良の1つを使う)
 *   onTick({ elapsed, total, n, best }) … 進み具合
 * 戻り値: { fixes, usable }(usable は maxAcc 以下のもの)
 * 呼び出し側で abort() すれば途中で打ち切って、それまでの分で返す。
 */
export function collectFixes(seconds, maxAcc, onTick) {
  const fixes = [];
  const started = Date.now();
  let timer = null;
  let off = null;
  let resolveFn;
  const done = new Promise((resolve) => { resolveFn = resolve; });
  const finish = () => {
    if (timer) clearInterval(timer);
    if (off) off();
    timer = null; off = null;
    const usable = fixes.filter((f) => f.acc <= maxAcc);
    resolveFn({ fixes, usable });
  };
  let lastT = 0;
  off = onGps(({ fix }) => {
    if (!fix || fix.t <= lastT || fix.t < started - 1500) return;   // 古い測位・同じ測位の重複は数えない
    lastT = fix.t;
    fixes.push(fix);
  });
  timer = setInterval(() => {
    const elapsed = (Date.now() - started) / 1000;
    const best = fixes.length ? Math.min(...fixes.map((f) => f.acc)) : null;
    if (onTick) onTick({ elapsed: Math.min(elapsed, seconds), total: seconds, n: fixes.length, best });
    if (elapsed >= seconds) finish();
  }, 250);
  return { done, abort: finish };
}

// ---------------------------------------------------------------- 画面を点けたままにする

let wakeLock = null;
let wantWake = false;

async function acquire() {
  if (!wantWake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* 省電力モードなどで拒否されることがある。記録自体は続ける */ }
}

export function keepScreenOn(on) {
  wantWake = on;
  if (on) acquire();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

export function wakeLockSupported() { return 'wakeLock' in navigator; }

document.addEventListener('visibilitychange', () => {
  // 画面が戻ってきたら取り直す(Wake Lock は画面が隠れると自動で外れる仕様)。
  if (document.visibilityState === 'visible' && wantWake && !wakeLock) acquire();
});
