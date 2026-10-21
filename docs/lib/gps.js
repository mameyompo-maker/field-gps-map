/* field_gps_map — GPS(端末の位置情報)の購読、押した瞬間の位置、画面の消灯防止。
 *
 * 位置情報は watchPosition を1本だけ張り、全画面で共有する(複数張ると端末によっては
 * 互いに測位を奪い合い、更新間隔が乱れる)。
 *
 * ★ ブラウザの制約(避けられない):
 *   画面が消える・別のアプリに切り替えると、ブラウザは位置情報の更新を止める。
 *   角を打ちながら歩いている最中にこれが起きると、戻った直後の位置が古いことがある。
 *   そのため記録中は Screen Wake Lock で画面を点けたままにし、画面が消えていたら
 *   利用者に知らせる。
 */

const listeners = new Set();
let watchId = null;
let last = null;          // 最新の測位 { lat, lng, acc, t, alt, speed, heading }
let status = 'idle';      // idle | waiting | ok | denied | unavailable | unsupported
let lastError = '';
const history = [];       // 直近 10 秒の測位(bestRecentFix 用)

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
      history.push(last);
      while (history.length && Date.now() - history[0].t > 10000) history.shift();
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
 * 「ここを角に」を押した瞬間に使う位置。待ち時間をなくすため平均はしない。
 * 直近 windowMs(既定 2.5 秒)に届いた測位の、基本は最新のもの(誤差が 3 m 以上小さい測位が直前にあればそちら)を返す。
 * 歩きながら押すので、それより古い測位は使わない(数 m 後ろの位置になるため)。
 * 直近に1つも無ければ、6 秒以内の最新の測位(画面が消えていた直後の古い位置は使わない)。無ければ null。
 */
export function bestRecentFix(windowMs = 2500) {
  const now = Date.now();
  const recent = history.filter((f) => now - f.t <= windowMs);
  if (recent.length) {
    // 基本は最新の測位(歩いている途中だと、古い測位は少し手前の位置になる)。
    // 一瞬だけ精度が落ちたときに備えて、直前に「3 m 以上」良い測位があればそちらを使う。
    const newest = recent[recent.length - 1];
    let best = newest;
    for (const f of recent) if (f.acc + 3 <= newest.acc && f.acc < best.acc) best = f;
    return best;
  }
  return isFresh(last, 6000) ? last : null;
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
