-- Aeterna SQLite Schema (v4.1)

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  -- NOT unique on its own. A wallet may hold several Bloodlines and plays one
  -- at a time, so it gets one row per Bloodline; uniqueness is the PAIR, held
  -- by idx_players_wallet_token below. A column-level UNIQUE here would let a
  -- holder bind their first Bloodline and then silently fail on the second.
  wallet        TEXT NOT NULL,
  token_id      INTEGER UNIQUE,
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
  gifts_given_today    INTEGER DEFAULT 0,
  gifts_received_today INTEGER DEFAULT 0,
  scourge_today INTEGER DEFAULT 0,        -- the Abbot's rite is once a day
  confession_count     INTEGER DEFAULT 0,         -- for escalating cost
  held_gift_id  TEXT,
  has_child     INTEGER DEFAULT 0,
  parent_id     TEXT,
  last_save     TEXT,
  created_at    TEXT NOT NULL
);

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
  cost_eth      REAL,
  tx_hash       TEXT
);

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

