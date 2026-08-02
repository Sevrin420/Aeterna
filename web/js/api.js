// Talks to the Fastify API in server/src/index.js. There is no real wallet
// auth yet (see server/README.md), so we keep a locally generated pseudo-id
// in localStorage and use it exactly where the server expects a `wallet`.

const WALLET_KEY = 'aeterna_wallet_id';
const TOKEN_KEY = 'aeterna_token_id';

// The Bloodline currently being played. Progress is keyed to the token, so
// every call that reads or writes Devotion has to say which one — a holder of
// several would otherwise pour all of them into whichever row came back first.
export function getTokenId() {
  const v = Number(localStorage.getItem(TOKEN_KEY));
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function setTokenId(id) {
  if (id == null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, String(id));
}

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

// The identity every call carries: which wallet, and which Bloodline is being
// played. Devotion is keyed to the token, so leaving it off means the server
// falls back to the oldest row and the day's work lands on the wrong Bloodline.
function who(extra = {}) {
  const t = getTokenId();
  return JSON.stringify({ wallet: getWalletId(), ...(t ? { tokenId: t } : {}), ...extra });
}

export const api = {
  register(name, sex, xHandle) {
    return req('/register', { method: 'POST', body: JSON.stringify({ wallet: getWalletId(), name, sex, xHandle }) });
  },
  me() {
    const t = getTokenId();
    return req('/me', { headers: { 'x-wallet': getWalletId(), ...(t ? { 'x-token': String(t) } : {}) } });
  },
  // Bind this player to one Bloodline. The server checks on-chain that
  // `address` really holds `tokenId` before it will write the row.
  // `bloodlineName` is only meaningful the first time a token is bound — a
  // Bloodline is named when it is raised and keeps that name afterwards.
  bind(tokenId, address, bloodlineName) {
    return req('/bind', {
      method: 'POST',
      body: JSON.stringify({ wallet: getWalletId(), tokenId, address, bloodlineName }),
    });
  },
  duty(type) {
    return req(`/duty/${type}`, { method: 'POST', body: who() });
  },
  confession() {
    return req('/confession', { method: 'POST', body: who() });
  },
  // Engagement on X. Refuses with 503 until X verification is configured on
  // the server — see verifyXInteraction() there.
  xClaim(kind, postId) {
    return req('/x/claim', { method: 'POST', body: who({ kind, postId }) });
  },
  save() {
    return req('/save', { method: 'POST', body: who() });
  },
  // Bind an X handle to the Bloodline being played. It shows on the token's
  // card and is the name others type to credit a referral. Pass '' to clear it.
  setXHandle(xHandle) {
    return req('/x/handle', { method: 'POST', body: who({ xHandle }) });
  },
  // Name whoever brought you in. Both sides are paid, once.
  referral(xHandle) {
    return req('/referral', { method: 'POST', body: who({ xHandle }) });
  },
  // Names (and current standing) for Bloodlines the caller already knows the
  // ids of, so the picker can list them by name instead of by token number.
  bloodlines(tokenIds) {
    const ids = (tokenIds || []).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return Promise.resolve([]);
    return req(`/bloodlines?tokens=${ids.join(',')}`);
  },
  season() {
    return req('/season');
  },
  cathedralList() {
    return req('/cathedral');
  },
  cathedralClaim(roomId) {
    return req(`/cathedral/${roomId}/claim`, { method: 'POST', body: who() });
  },
};
