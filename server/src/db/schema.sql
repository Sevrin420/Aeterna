-- Aeterna SQLite Schema (v4.1)

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  -- NOT unique on its own. A wallet may hold several Bloodlines and plays one
  -- at a time, so it gets one row per Bloodline; uniqueness is the PAIR, held
  -- by idx_players_wallet_token below. A column-level UNIQUE here would let a
  -- holder bind their first Bloodline and then silently fail on the second.
  wallet        TEXT NOT NULL,
  token_id      INTEGER UNIQUE,
  -- The on-chain holder, lowercased, verified against ownerOf() at bind.
  -- NOT the same as `wallet`, which is a per-BROWSER pseudo-id.
  address       TEXT,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL DEFAULT 'Brother',  -- Brother | Sister | Deacon | Bishop | Cardinal
  sex           TEXT NOT NULL,                    -- male | female
  x_handle      TEXT,
  bloodline_name TEXT,                            -- what the holder named this Bloodline
  level         INTEGER NOT NULL DEFAULT 1,
  devotion      INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  last_duty_date TEXT,                            -- YYYY-MM-DD, last day all 3 duties were completed
  flags_date    TEXT,                             -- YYYY-MM-DD the *_today columns currently reflect
  pray_today    INTEGER DEFAULT 0,
  garden_today  INTEGER DEFAULT 0,
  candles_today INTEGER DEFAULT 0,
  -- GIFTS ARE DORMANT. The mechanic is not in the game: nothing spawns,
  -- carries or offers a gift, and no route or socket event touches these. The
  -- columns, the gifts table and held_gift_id below are kept ON PURPOSE so the
  -- system can be switched back on without a migration. Do not remove them in
  -- a cleanup — they are not leftovers, they are a parked feature.
  gifts_given_today    INTEGER DEFAULT 0,
  gifts_received_today INTEGER DEFAULT 0,
  scourge_today INTEGER DEFAULT 0,        -- the Abbot's rite is once a day
  confession_count     INTEGER DEFAULT 0,         -- kept; the price no longer uses it
  held_gift_id  TEXT,                             -- dormant, see above
  has_child     INTEGER DEFAULT 0,
  parent_id     TEXT,
  last_save     TEXT,
  created_at    TEXT NOT NULL
);

-- Dormant. See the note on gifts_given_today above.
CREATE TABLE IF NOT EXISTS gifts (
  id            TEXT PRIMARY KEY,
  spawned_at    TEXT NOT NULL,
  loc_x         REAL,
  loc_y         REAL,
  picked_up_by  TEXT,
  given_to      TEXT,                             -- player id or 'guru'
  given_at      TEXT,
  expires_at    TEXT
);

CREATE TABLE IF NOT EXISTS saves (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id         TEXT NOT NULL,
  devotion_at_save  INTEGER NOT NULL,
  streak_at_save    INTEGER NOT NULL,
  signature         TEXT NOT NULL,
  signed_at         TEXT NOT NULL,
  used_for_level_up INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS streak_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL,
  date          TEXT NOT NULL,
  streak_before INTEGER,
  broke         INTEGER DEFAULT 0,
  confessed     INTEGER DEFAULT 0,
  confessed_at  TEXT,
  cost_eth      REAL,          -- the COIN amount, NULL when paid in the token
  paid_currency TEXT,          -- 'coin' or the token's ticker
  paid_amount   TEXT,          -- what actually moved, in smallest units
  tx_hash       TEXT
);

-- One payment mends one broken streak, ever. This is what actually stops a
-- transaction hash being spent twice: /confession checks for a duplicate before
-- it writes, but two requests arriving together would both pass that check and
-- both bank the same payment. The index is the half that holds under a race.
-- Partial, so the rows with no hash (a break that has not been confessed) do
-- not collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_streak_logs_tx
  ON streak_logs(tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_awards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  reason      TEXT,
  awarded_by  TEXT DEFAULT 'admin',
  awarded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS souls (
  soul_id     TEXT PRIMARY KEY,
  owner_id    TEXT,
  is_free     INTEGER DEFAULT 0,
  devotion    INTEGER DEFAULT 0,
  bound_at    TEXT
);

-- Ownable Cathedral Rooms (GDD section 11). A fixed small set of alcoves in
-- the transept; first Cultist to claim an unowned one holds it.
CREATE TABLE IF NOT EXISTS cathedral_rooms (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT,
  owner_name  TEXT,
  claimed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_devotion ON players(devotion DESC);
CREATE INDEX IF NOT EXISTS idx_players_wallet ON players(wallet);
CREATE INDEX IF NOT EXISTS idx_gifts_spawned ON gifts(spawned_at);
CREATE INDEX IF NOT EXISTS idx_saves_player ON saves(player_id);

-- Engagement on X, one row per credited interaction. The UNIQUE constraint is
-- the anti-double-claim: a given player can be paid for a given kind of
-- interaction on a given post exactly once, forever.
CREATE TABLE IF NOT EXISTS x_interactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- like | comment | repost
  post_id     TEXT NOT NULL,               -- the X post's id
  devotion    INTEGER NOT NULL,
  awarded_at  TEXT NOT NULL,
  UNIQUE (player_id, kind, post_id)
);
CREATE INDEX IF NOT EXISTS idx_x_player ON x_interactions(player_id);

-- Referrals. One row per person brought in, and the UNIQUE is on the referee's
-- WALLET rather than their player id on purpose: a wallet can mint any number
-- of Bloodlines, so keying this to the row would let one person be "referred"
-- once per Bloodline they raise and pay their friend every time.
CREATE TABLE IF NOT EXISTS referrals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_wallet    TEXT NOT NULL UNIQUE,
  referee_player_id TEXT NOT NULL,
  referrer_wallet   TEXT NOT NULL,
  referrer_player_id TEXT NOT NULL,
  referrer_handle   TEXT NOT NULL,
  devotion_each     INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet);
-- (the UNIQUE index on players.x_handle is created in database.js, guarded:
--  this file is exec'd as one block on every boot, so an index that fails on a
--  database with existing duplicate handles would crash the server outright.)


-- THE FINAL STANDINGS. Written once, when the run's last day has passed, and
-- never updated afterwards.
--
-- A frozen table rather than a query over players, because the payout is
-- settled by hand: the operator reads a list, sends money against it, and has
-- to be able to reconcile what they paid with what they read. A live ranking
-- answers differently every time it is run, which makes that impossible — and
-- Devotion only ever rises, so "the totals cannot change now" is a property of
-- this table existing, not of the game being over.
--
-- rank is NULL for a line that is recorded but excluded from the division —
-- today that is only the founder's. It is kept in the table rather than left
-- out of it so the standings show the whole run and the exclusion is visible
-- rather than implied by an absence.
CREATE TABLE IF NOT EXISTS final_standings (
  token_id       INTEGER PRIMARY KEY,
  rank           INTEGER,
  is_founder     INTEGER NOT NULL DEFAULT 0,
  address        TEXT,
  bloodline_name TEXT,
  devotion       INTEGER NOT NULL,
  cultists       INTEGER NOT NULL,
  streak         INTEGER NOT NULL,
  x_handle       TEXT,
  frozen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_final_standings_rank ON final_standings(rank);
