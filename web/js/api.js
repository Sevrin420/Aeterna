// Talks to the Fastify API in server/src/index.js. There is no real wallet
// auth yet (see server/README.md), so we keep a locally generated pseudo-id
// in localStorage and use it exactly where the server expects a `wallet`.

const WALLET_KEY = 'aeterna_wallet_id';

export function getWalletId() {
  let id = localStorage.getItem(WALLET_KEY);
  if (!id) {
    id = 'local:' + crypto.randomUUID();
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
};
