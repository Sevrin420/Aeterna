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

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: walletId(), ...body }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
async function get(path) {
  const res = await fetch(BASE + path);
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
