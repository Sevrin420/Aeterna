// Talks to the Fastify API in server/src/index.js. There is no real wallet
// auth yet (see server/README.md), so we keep a locally generated pseudo-id
// in localStorage and use it exactly where the server expects a `wallet`.

const WALLET_KEY = 'aeterna_wallet_id';

// crypto.randomUUID() only exists in a secure context (HTTPS or localhost).
// This game is currently served over plain HTTP, where that function is
// undefined on many browsers (notably mobile) — so build a v4 UUID from
// crypto.getRandomValues (which does work over HTTP) with a Math.random
// fallback, instead of relying on crypto.randomUUID.
function uuid() {
  const c = (typeof crypto !== 'undefined') ? crypto : null;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* not available in this context */ }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

export function getWalletId() {
  let id = localStorage.getItem(WALLET_KEY);
  if (!id) {
    id = 'local:' + uuid();
    localStorage.setItem(WALLET_KEY, id);
  }
  return id;
}

export function clearWalletId() {
  localStorage.removeItem(WALLET_KEY);
}

async function req(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
  return body;
}

export const api = {
  register(name, sex, xHandle) {
    return req('/register', { method: 'POST', body: JSON.stringify({ wallet: getWalletId(), name, sex, xHandle }) });
  },
  me() {
    return req('/me', { headers: { 'x-wallet': getWalletId() } });
  },
  duty(type) {
    return req(`/duty/${type}`, { method: 'POST', body: JSON.stringify({ wallet: getWalletId() }) });
  },
  confession() {
    return req('/confession', { method: 'POST', body: JSON.stringify({ wallet: getWalletId() }) });
  },
  giftsNearby() {
    return req('/gifts/nearby');
  },
  giftPickup(giftId) {
    return req('/gifts/pickup', { method: 'POST', body: JSON.stringify({ wallet: getWalletId(), giftId }) });
  },
  giftGive({ targetWallet, toGuru }) {
    return req('/gifts/give', { method: 'POST', body: JSON.stringify({ wallet: getWalletId(), targetWallet, toGuru }) });
  },
  giftDrop(x, y) {
    return req('/gifts/drop', { method: 'POST', body: JSON.stringify({ wallet: getWalletId(), x, y }) });
  },
  save() {
    return req('/save', { method: 'POST', body: JSON.stringify({ wallet: getWalletId() }) });
  },
  leaderboard() {
    return req('/leaderboard');
  },
  season() {
    return req('/season');
  },
  cathedralList() {
    return req('/cathedral');
  },
  cathedralClaim(roomId) {
    return req(`/cathedral/${roomId}/claim`, { method: 'POST', body: JSON.stringify({ wallet: getWalletId() }) });
  },
};
