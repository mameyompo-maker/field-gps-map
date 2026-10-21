/* field_gps_map — Googleログインと許可リスト(allowedUsers)によるアクセス判定。
 * field_visit_map の lib/auth.js をそのまま踏襲(同じ Firebase プロジェクト・同じ許可リスト)。
 *
 * 「誰が記録したか」は必ずここが返す currentUser() から取る。記録者を手入力させない。
 * ここでの判定は画面の出し分け用で、本当のガードは firestore.rules 側。
 *
 * 状態は必ず次のどれかに確定させる(「判定保留」で画面が固まる不具合を
 * field_visit_map で一度出したため):
 *   'signed-out' | 'checking' | 'allowed' | 'denied' | 'error'
 */
import {
  auth, db, doc, getDoc,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged
} from './firebase-init.js';

const CHECK_TIMEOUT_MS = 10000;
const LS_PREFIX = 'fgm.allowed.';

let current = null;
let state = 'signed-out';
let lastError = '';
let generation = 0;
let resolved = false;    // onAuthStateChanged が一度でも返ってきたか(起動直後の「未確定」を区別する)
const listeners = [];

const snapshot = () => ({ user: current, state, error: lastError, resolved });
function notify() { const s = snapshot(); listeners.forEach((fn) => fn(s)); }

export function onAuthChange(fn) {
  listeners.push(fn);
  fn(snapshot());
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

export function currentUser() { return current; }

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  // 複数アカウントを使い分けている端末で、意図しないアカウントに黙って入るのを防ぐ。
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // ホーム画面に追加したアプリ(standalone)ではポップアップが開けない端末がある。
    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export async function signOutUser() { await signOut(auth); }

function cachedAllowed(email) {
  try { return localStorage.getItem(LS_PREFIX + email) === '1'; } catch { return false; }
}
function rememberAllowed(email, ok) {
  try {
    if (ok) localStorage.setItem(LS_PREFIX + email, '1');
    else localStorage.removeItem(LS_PREFIX + email);
  } catch { /* 書けなくても致命的ではない */ }
}

async function fetchAllowed(email) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  const snap = await Promise.race([getDoc(doc(db, 'allowedUsers', email)), timeout]);
  return snap.exists() && snap.data().active !== false;
}

async function runCheck() {
  const my = ++generation;
  const email = current.email;
  // 圏外で開き直したときに締め出さない: 一度許可された端末はすぐ地図を出し、照会は裏で行う。
  if (cachedAllowed(email)) { state = 'allowed'; notify(); }
  else { state = 'checking'; lastError = ''; notify(); }

  let next;
  try {
    const ok = await fetchAllowed(email);
    rememberAllowed(email, ok);
    next = ok ? 'allowed' : 'denied';
  } catch (err) {
    if (cachedAllowed(email)) next = 'allowed';
    else { next = 'error'; lastError = (err && err.message) || String(err); }
  }
  if (my !== generation) return;
  if (next !== state) { state = next; notify(); }
}

export function recheckAllowed() {
  if (!current) return Promise.resolve();
  return runCheck();
}

onAuthStateChanged(auth, (user) => {
  resolved = true;
  if (!user) {
    generation++;
    current = null;
    state = 'signed-out';
    lastError = '';
    notify();
    return;
  }
  current = {
    uid: user.uid,
    email: (user.email || '').toLowerCase(),
    displayName: user.displayName || user.email || ''
  };
  runCheck();
});
