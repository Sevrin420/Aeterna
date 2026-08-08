-- Aeterna SQLite Schema (v4.1)

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  wallet        TEXT NOT NULL UNIQUE,
  token_id      INTEGER UNIQUE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL DEFAULT 'Brother',  -- Brother | Sister | Deacon | Bishop | Cardinal
  sex           TEXT NOT NULL,                    -- male | female
  x_handle      TEXT,
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
  cost_eth      REAL,
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
