// Points — the crypto-facing layer.
//
// Design intent: POINTS are the only number that should ever back a token
// payout, so they are kept deliberately separate from in-game cash and are
// never trusted from the client. The client posts *events* ("mission 3
// complete", "district taken"), the server prices them from its own table and
// appends to an immutable ledger. That way a tampered client can at worst
// replay an event the server already knows how to value and de-duplicate — it
// can't mint points.
//
// The ledger is append-only and every row records what earned it, so a later
// distribution can be computed and audited off the same rows without any
// migration.

const BASE = '/boyz/api';

function walletId() {
  let id = localStorage.getItem('boyz_wallet');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('boyz_wallet', id);
  }
  return id;
}
export const getWalletId = walletId;

// --- session --------------------------------------------------------------
// Once a wallet is linked, the session token IS the identity: the server reads
// the wallet off the token and ignores the one in the body. Until then the
// `dev-…` id in the body identifies an anonymous scratch account, which the
// server will happily accumulate points for but will not pay out.
const TOKEN_KEY = 'boyz_token';
function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export function isLinked() { return !!token(); }

function headers(json = true) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ wallet: walletId(), ...body }),
  });
  if (res.status === 401 && token()) {
    // the session expired or was revoked — drop back to anonymous rather than
    // failing every call from here on
    setToken('');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
async function get(path) {
  const res = await fetch(BASE + path, { headers: headers(false) });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export const api = {
  register: (name) => post('/register', { name }),
  profile: () => get(`/profile?wallet=${encodeURIComponent(walletId())}`),
  // The client never sends an amount — only what happened.
  event: (type, ref) => post('/event', { type, ref }),
  save: (state) => post('/save', { state }),
  leaderboard: () => get('/leaderboard'),
};

// --- linking a real wallet -------------------------------------------------
// Sign-in-with-Ethereum, in three steps: connect, ask the server for a
// single-use challenge, sign it. The signature never authorises a transaction
// and costs no gas — it only proves control of the address, which is the one
// thing a client cannot fake and the one thing a payout has to be sure of.
//
// The anonymous id is passed along so the server can migrate a run's points
// onto the wallet, once. That is why you can play the whole game before you
// ever connect anything.
export async function linkWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No wallet found in this browser');

  const accounts = await eth.request({ method: 'eth_requestAccounts' });
  const address = String(accounts?.[0] || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error('No account returned');

  const { nonce, message } = await post('/nonce', { wallet: address });
  const signature = await eth.request({ method: 'personal_sign', params: [message, address] });

  const res = await post('/link', { wallet: address, nonce, signature, from: walletId() });
  setToken(res.token);
  return res;
}

export async function unlinkWallet() {
  try { await post('/unlink', {}); } catch { /* the token is going either way */ }
  setToken('');
}

// Queue events so a dropped connection doesn't lose points; flush on the next
// success. Everything is idempotent server-side via (wallet, type, ref).
const pending = JSON.parse(localStorage.getItem('boyz_pending') || '[]');
function persistQueue() { localStorage.setItem('boyz_pending', JSON.stringify(pending)); }

export async function sendEvent(type, ref) {
  pending.push({ type, ref });
  persistQueue();
  await flush();
}

export async function flush() {
  while (pending.length) {
    const e = pending[0];
    try {
      await api.event(e.type, e.ref);
      pending.shift();
      persistQueue();
    } catch {
      return false;   // offline — try again next time
    }
  }
  return true;
}
