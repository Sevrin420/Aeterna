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

import db from '../db/database.js';

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
  `);
}

export default async function boyzRoutes(fastify) {
  initBoyzSchema();

  const clean = (w) => String(w || '').trim().slice(0, 64).toLowerCase();

  fastify.post('/boyz/api/register', async (req, reply) => {
    const wallet = clean(req.body?.wallet);
    const name = String(req.body?.name || 'Boy').slice(0, 24);
    if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });
    db.prepare(`INSERT INTO boyz_players (wallet, name) VALUES (?, ?)
                ON CONFLICT(wallet) DO UPDATE SET name = excluded.name,
                updated_at = datetime('now')`).run(wallet, name);
    return db.prepare('SELECT wallet, name, points FROM boyz_players WHERE wallet = ?').get(wallet);
  });

  fastify.get('/boyz/api/profile', async (req, reply) => {
    const wallet = clean(req.query?.wallet);
    if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });
    const p = db.prepare('SELECT wallet, name, points FROM boyz_players WHERE wallet = ?').get(wallet);
    if (!p) return reply.code(404).send({ error: 'Unknown wallet' });
    const ledger = db.prepare(
      'SELECT type, ref, points, created_at FROM boyz_ledger WHERE wallet = ? ORDER BY id DESC LIMIT 50',
    ).all(wallet);
    return { ...p, ledger };
  });

  // The only way points are ever created.
  fastify.post('/boyz/api/event', async (req, reply) => {
    const wallet = clean(req.body?.wallet);
    const type = String(req.body?.type || '').slice(0, 24);
    const ref = String(req.body?.ref ?? '').slice(0, 64);
    if (!wallet || !type) return reply.code(400).send({ error: 'Missing wallet or type' });

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
    const wallet = clean(req.body?.wallet);
    if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });
    const state = JSON.stringify(req.body?.state ?? {}).slice(0, 20000);
    db.prepare(`INSERT INTO boyz_saves (wallet, state) VALUES (?, ?)
                ON CONFLICT(wallet) DO UPDATE SET state = excluded.state,
                updated_at = datetime('now')`).run(wallet, state);
    return { ok: true };
  });

  fastify.get('/boyz/api/leaderboard', async () => {
    const rows = db.prepare(
      'SELECT name, points FROM boyz_players WHERE points > 0 ORDER BY points DESC LIMIT 25',
    ).all();
    return rows;
  });

  // What a payout would look like right now, straight off the ledger. Read-only
  // — it moves nothing, it just shows the split the ledger implies.
  fastify.get('/boyz/api/distribution', async () => {
    const rows = db.prepare(
      'SELECT wallet, name, points FROM boyz_players WHERE points > 0 ORDER BY points DESC',
    ).all();
    const total = rows.reduce((a, r) => a + r.points, 0) || 1;
    return {
      total_points: total,
      holders: rows.length,
      split: rows.map((r) => ({ ...r, share: +(r.points / total).toFixed(6) })),
    };
  });
}
