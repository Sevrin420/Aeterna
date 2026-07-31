// BOYZ N THE HOOD — points API.
//
// The design rule here is that the client is never trusted with a number. It
// posts an EVENT ("mission 3 complete", "district jimothys taken") and the
// server prices it from POINT_VALUES below, then appends to an immutable
// ledger keyed (wallet, type, ref). That key makes every award idempotent: a
// replayed request, a double-tap, or a client retry after a dropped connection
// all collapse to the same single row.
//
// This matters because points are the intended basis for a later token
// distribution. Anything a player can inflate from the browser is worthless for
// that purpose, and a ledger you can't recompute from is worse — so every row
// records the type, the ref and the value applied at the time. A distribution
// can be derived and audited from these rows alone, with no migration and no
// trust in the client's arithmetic.

import crypto from 'node:crypto';
import { verifyMessage } from 'viem';
import db from '../db/database.js';

// --- identity -------------------------------------------------------------
// Play is anonymous by default: the client mints a local `dev-…` id so nobody
// has to hold a wallet to try the game. That id is NOT a claim to anything —
// it is a scratch account, and the leaderboard and distribution both say so.
//
// Linking a real wallet is sign-in-with-Ethereum: the server issues a nonce,
// the client signs a message containing it with personal_sign, and the server
// recovers the signing address and compares. A signature over a server-issued,
// single-use nonce is the only thing here that proves control of an address —
// a client simply *asserting* an address proves nothing, which is exactly the
// hole this closes.
//
// After that, a session token is the identity. Every earning call derives its
// wallet from the token and IGNORES any wallet in the body, because a body
// field is just the client asserting an address again.

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_DAYS = 30;

const isEvmAddress = (w) => /^0x[0-9a-f]{40}$/.test(w);
const isDevId = (w) => /^dev-[0-9a-z]{4,40}$/.test(w);

function signInMessage(wallet, nonce) {
  return [
    'BOYZ N THE HOOD — Robinhood Block',
    '',
    'Sign this message to link this wallet to your points.',
    'It costs nothing and authorises no transaction.',
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

// The price list. Server-side and versioned — changing a value here does NOT
// rewrite history, because each ledger row stores the points it was awarded.
const POINT_VALUES = {
  mission: {
    1: 250, 2: 400, 3: 600, 4: 700, 5: 1000,
    6: 1200, 7: 1400, 8: 2000, 9: 2400, 10: 5000,
  },
  district: 750,        // per district taken
  firstblood: 100,      // first Cabal kill
  rampage: 120,         // 10 Cabal inside 60s
  carjack: 15,          // per distinct vehicle boosted
  escape: 90,           // shed a 3+ star wanted level
  delivery: 60,         // side-hustle drop completed
  survive: 45,          // 5 minutes alive with heat on you
};

// Anything repeatable needs a ceiling, or a bot parked in an alley out-earns
// every real player and the whole distribution is worthless. Missions and
// districts are one-shot by their (type, ref) key and need no cap; the
// free-play events are capped per wallet per UTC day.
const DAILY_CAPS = {
  rampage: 10, carjack: 40, escape: 12, delivery: 20, survive: 12,
};

function valueFor(type, ref) {
  if (type === 'mission') return POINT_VALUES.mission[Number(ref)] || 0;
  return POINT_VALUES[type] || 0;
}

function utcDay() { return new Date().toISOString().slice(0, 10); }

export function initBoyzSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boyz_players (
      wallet      TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      points      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Append-only. The UNIQUE key is what makes awards idempotent.
    CREATE TABLE IF NOT EXISTS boyz_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet      TEXT NOT NULL,
      type        TEXT NOT NULL,
      ref         TEXT NOT NULL DEFAULT '',
      points      INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (wallet, type, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_boyz_ledger_wallet ON boyz_ledger(wallet);
    CREATE TABLE IF NOT EXISTS boyz_saves (
      wallet      TEXT PRIMARY KEY,
      state       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Single-use, short-lived challenges. Deleted on use, so a captured
    -- signature cannot be replayed into a second session.
    CREATE TABLE IF NOT EXISTS boyz_nonces (
      nonce       TEXT PRIMARY KEY,
      wallet      TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS boyz_sessions (
      token       TEXT PRIMARY KEY,
      wallet      TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_boyz_sessions_wallet ON boyz_sessions(wallet);
  `);
  // `verified` marks a wallet whose control has actually been proven. Added
  // separately because the table predates it and SQLite has no IF NOT EXISTS
  // for columns.
  const cols = db.prepare('PRAGMA table_info(boyz_players)').all().map((c) => c.name);
  if (!cols.includes('verified')) {
    db.exec('ALTER TABLE boyz_players ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('linked_from')) {
    db.exec('ALTER TABLE boyz_players ADD COLUMN linked_from TEXT');
  }
}

export default async function boyzRoutes(fastify) {
  initBoyzSchema();

  const clean = (w) => String(w || '').trim().slice(0, 64).toLowerCase();

  // Sweep expired challenges and sessions on the way past. Cheap, and it keeps
  // a long-lived instance from accumulating dead rows forever.
  const sweep = () => {
    const now = Date.now();
    db.prepare('DELETE FROM boyz_nonces WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM boyz_sessions WHERE expires_at < ?').run(now);
  };

  // The wallet a request is entitled to act as. A bearer token beats anything
  // in the body: the body is the client asserting an identity, the token is
  // the server remembering one it verified.
  const identify = (req) => {
    const auth = String(req.headers?.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) {
      const s = db.prepare('SELECT wallet, expires_at FROM boyz_sessions WHERE token = ?').get(token);
      if (s && s.expires_at > Date.now()) return { wallet: s.wallet, verified: true };
    }
    // No token: fall back to the anonymous scratch id, which only ever
    // identifies a `dev-` account and can never name a real address.
    const w = clean(req.body?.wallet ?? req.query?.wallet);
    if (isDevId(w)) return { wallet: w, verified: false };
    return { wallet: null, verified: false };
  };

  // --- linking ------------------------------------------------------------
  // Step 1: hand out a single-use challenge.
  fastify.post('/boyz/api/nonce', async (req, reply) => {
    sweep();
    const wallet = clean(req.body?.wallet);
    if (!isEvmAddress(wallet)) return reply.code(400).send({ error: 'Not an address' });
    const nonce = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO boyz_nonces (nonce, wallet, expires_at) VALUES (?, ?, ?)')
      .run(nonce, wallet, Date.now() + NONCE_TTL_MS);
    return { nonce, message: signInMessage(wallet, nonce) };
  });

  // Step 2: check the signature, and only then hand out a session.
  fastify.post('/boyz/api/link', async (req, reply) => {
    sweep();
    const wallet = clean(req.body?.wallet);
    const nonce = String(req.body?.nonce || '').slice(0, 64);
    const signature = String(req.body?.signature || '').slice(0, 300);
    const from = clean(req.body?.from);   // optional anonymous id to migrate
    if (!isEvmAddress(wallet)) return reply.code(400).send({ error: 'Not an address' });

    // Consume the challenge first, whatever happens next. A nonce that survives
    // a failed attempt is a nonce an attacker gets unlimited tries against.
    const row = db.prepare('SELECT wallet, expires_at FROM boyz_nonces WHERE nonce = ?').get(nonce);
    db.prepare('DELETE FROM boyz_nonces WHERE nonce = ?').run(nonce);
    if (!row || row.wallet !== wallet || row.expires_at < Date.now()) {
      return reply.code(400).send({ error: 'Nonce expired or unknown' });
    }

    let ok = false;
    try {
      ok = await verifyMessage({ address: wallet, message: signInMessage(wallet, nonce), signature });
    } catch { ok = false; }
    if (!ok) return reply.code(401).send({ error: 'Bad signature' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_TTL_DAYS * 86400000;

    // Carry an anonymous run over, once. Every ledger row moves with its
    // (type, ref) key intact, so idempotency survives the move and a row that
    // would collide is dropped rather than double-counted. Only a `dev-` id can
    // be migrated — allowing a real address here would let anyone drain another
    // player's balance by naming it.
    const migrate = db.transaction(() => {
      db.prepare(`INSERT INTO boyz_players (wallet, name, verified) VALUES (?, 'Boy', 1)
                  ON CONFLICT(wallet) DO UPDATE SET verified = 1,
                  updated_at = datetime('now')`).run(wallet);
      let moved = 0;
      if (isDevId(from)) {
        const src = db.prepare('SELECT wallet, name, linked_from FROM boyz_players WHERE wallet = ?').get(from);
        const already = db.prepare('SELECT 1 FROM boyz_players WHERE linked_from = ?').get(from);
        if (src && !already) {
          const rows = db.prepare('SELECT type, ref, points, created_at FROM boyz_ledger WHERE wallet = ?').all(from);
          const ins = db.prepare(
            `INSERT OR IGNORE INTO boyz_ledger (wallet, type, ref, points, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          );
          for (const r of rows) {
            if (ins.run(wallet, r.type, r.ref, r.points, r.created_at).changes) moved += r.points;
          }
          db.prepare(`UPDATE boyz_players SET points = points + ?, name = ?, linked_from = ?,
                      updated_at = datetime('now') WHERE wallet = ?`)
            .run(moved, src.name, from, wallet);
          // the scratch account is spent — zero it so it cannot be re-migrated
          db.prepare('DELETE FROM boyz_ledger WHERE wallet = ?').run(from);
          db.prepare('UPDATE boyz_players SET points = 0 WHERE wallet = ?').run(from);
        }
      }
      db.prepare('INSERT INTO boyz_sessions (token, wallet, expires_at) VALUES (?, ?, ?)')
        .run(token, wallet, expires);
      return moved;
    });
    const moved = migrate();
    const p = db.prepare('SELECT wallet, name, points, verified FROM boyz_players WHERE wallet = ?').get(wallet);
    return { token, expires, migrated: moved, ...p };
  });

  fastify.post('/boyz/api/unlink', async (req) => {
    const auth = String(req.headers?.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) db.prepare('DELETE FROM boyz_sessions WHERE token = ?').run(token);
    return { ok: true };
  });

  fastify.post('/boyz/api/register', async (req, reply) => {
    const { wallet } = identify(req);
    const name = String(req.body?.name || 'Boy').slice(0, 24);
    if (!wallet) return reply.code(400).send({ error: 'Missing or invalid wallet' });
    db.prepare(`INSERT INTO boyz_players (wallet, name) VALUES (?, ?)
                ON CONFLICT(wallet) DO UPDATE SET name = excluded.name,
                updated_at = datetime('now')`).run(wallet, name);
    return db.prepare('SELECT wallet, name, points, verified FROM boyz_players WHERE wallet = ?').get(wallet);
  });

  fastify.get('/boyz/api/profile', async (req, reply) => {
    const { wallet } = identify(req);
    if (!wallet) return reply.code(400).send({ error: 'Missing or invalid wallet' });
    const p = db.prepare('SELECT wallet, name, points, verified FROM boyz_players WHERE wallet = ?').get(wallet);
    if (!p) return reply.code(404).send({ error: 'Unknown wallet' });
    const ledger = db.prepare(
      'SELECT type, ref, points, created_at FROM boyz_ledger WHERE wallet = ? ORDER BY id DESC LIMIT 50',
    ).all(wallet);
    return { ...p, ledger };
  });

  // The only way points are ever created.
  fastify.post('/boyz/api/event', async (req, reply) => {
    // The wallet comes from the session, never from the body. Posting
    // someone else's address is the most obvious attack on a points system
    // and this is the line that stops it.
    const { wallet } = identify(req);
    const type = String(req.body?.type || '').slice(0, 24);
    const ref = String(req.body?.ref ?? '').slice(0, 64);
    if (!wallet) return reply.code(401).send({ error: 'Unknown identity' });
    if (!type) return reply.code(400).send({ error: 'Missing type' });

    const pts = valueFor(type, ref);
    if (!pts) return reply.code(400).send({ error: 'Unknown event' });

    const exists = db.prepare('SELECT 1 FROM boyz_players WHERE wallet = ?').get(wallet);
    if (!exists) db.prepare('INSERT INTO boyz_players (wallet, name) VALUES (?, ?)').run(wallet, 'Boy');

    // Repeatable events are namespaced by day so the idempotency key stays
    // unique per occurrence, and are counted against the day's cap.
    const cap = DAILY_CAPS[type];
    const key = cap ? `${utcDay()}:${ref}` : ref;

    // One transaction: the ledger insert decides whether the balance moves, so
    // a duplicate event can never double-credit even under concurrent posts,
    // and the cap is read inside the same transaction it is enforced by.
    const apply = db.transaction(() => {
      if (cap) {
        const used = db.prepare(
          `SELECT COUNT(*) n FROM boyz_ledger
           WHERE wallet = ? AND type = ? AND ref LIKE ?`,
        ).get(wallet, type, `${utcDay()}:%`).n;
        if (used >= cap) return { capped: true, awarded: 0, duplicate: false };
      }
      const r = db.prepare(
        `INSERT OR IGNORE INTO boyz_ledger (wallet, type, ref, points) VALUES (?, ?, ?, ?)`,
      ).run(wallet, type, key, pts);
      if (r.changes === 0) return { duplicate: true, awarded: 0 };
      db.prepare(
        `UPDATE boyz_players SET points = points + ?, updated_at = datetime('now') WHERE wallet = ?`,
      ).run(pts, wallet);
      return { duplicate: false, awarded: pts };
    });
    const out = apply();
    const total = db.prepare('SELECT points FROM boyz_players WHERE wallet = ?').get(wallet).points;
    return { ...out, points: total };
  });

  // Free-roam progress. Cosmetic/QoL only — never a source of points.
  fastify.post('/boyz/api/save', async (req, reply) => {
    const { wallet } = identify(req);
    if (!wallet) return reply.code(400).send({ error: 'Missing or invalid wallet' });
    const state = JSON.stringify(req.body?.state ?? {}).slice(0, 20000);
    db.prepare(`INSERT INTO boyz_saves (wallet, state) VALUES (?, ?)
                ON CONFLICT(wallet) DO UPDATE SET state = excluded.state,
                updated_at = datetime('now')`).run(wallet, state);
    return { ok: true };
  });

  fastify.get('/boyz/api/leaderboard', async () => {
    // `verified` is surfaced so the board can mark which entries are backed by
    // a proven wallet — an unverified scratch account is not a payout claim.
    return db.prepare(
      'SELECT name, points, verified FROM boyz_players WHERE points > 0 ORDER BY points DESC LIMIT 25',
    ).all();
  });

  // What a payout would look like right now, straight off the ledger. Read-only
  // — it moves nothing, it just shows the split the ledger implies.
  fastify.get('/boyz/api/distribution', async () => {
    // Only VERIFIED wallets are payable. An anonymous scratch account has
    // proven nothing, so it cannot be a share of a distribution — it is shown
    // separately rather than silently dropped, because a total that quietly
    // omits rows is how a distribution stops being auditable.
    const all = db.prepare(
      'SELECT wallet, name, points, verified FROM boyz_players WHERE points > 0 ORDER BY points DESC',
    ).all();
    const payable = all.filter((r) => r.verified);
    const total = payable.reduce((a, r) => a + r.points, 0) || 1;
    return {
      total_points: total,
      holders: payable.length,
      unverified_points: all.filter((r) => !r.verified).reduce((a, r) => a + r.points, 0),
      unverified_accounts: all.length - payable.length,
      split: payable.map((r) => ({ ...r, share: +(r.points / total).toFixed(6) })),
    };
  });
}
