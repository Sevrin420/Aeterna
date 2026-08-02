import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || './data/aeterna.db';

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schemaPath = path.join(__dirname, '../../../02_Architecture/SQLite_Schema.sql');
// Fallback to local copy if needed
const localSchema = path.join(__dirname, 'schema.sql');
const schemaFile = fs.existsSync(localSchema) ? localSchema : schemaPath;

if (fs.existsSync(schemaFile)) {
  const schema = fs.readFileSync(schemaFile, 'utf8');
  db.exec(schema);
} else {
  console.warn('Schema file not found — tables may need manual creation');
}

// Defensive migrations for DBs created before a column existed. Each runs in
// its own try because the first failure would otherwise skip the rest.
for (const ddl of [
  'ALTER TABLE players ADD COLUMN flags_date TEXT',
  'ALTER TABLE players ADD COLUMN scourge_today INTEGER DEFAULT 0',
  // The Bloodline a player row belongs to. A wallet may hold several and plays
  // one at a time, so the unit of progress is the TOKEN, not the wallet —
  // Devotion, streak and the day's flags all hang off this row.
  'ALTER TABLE players ADD COLUMN token_id INTEGER',
  // Cultists held by that Bloodline, copied from the chain at bind time. Fixed
  // for the life of the token, so it is safe to cache: it is the end-of-season
  // payout multiplier and nothing in play ever changes it.
  'ALTER TABLE players ADD COLUMN cultists INTEGER DEFAULT 0',
]) {
  try {
    db.exec(ddl);
  } catch {
    // column already exists
  }
}

// Drop the legacy column-level UNIQUE on players.wallet.
//
// The composite index below is what makes "one row per (wallet, Bloodline)"
// true, but it was never sufficient on its own: every database built from the
// old schema.sql carries `wallet TEXT NOT NULL UNIQUE` *inside the table*, and
// that constraint outranks any index we add beside it. A holder would bind
// their first Bloodline and the second would fail on a UNIQUE violation — the
// exact case the composite index was added to support.
//
// SQLite cannot drop a column constraint in place, so the table is rebuilt: the
// old CREATE TABLE is read back out of sqlite_master, the UNIQUE is struck from
// the wallet column, and the rows are copied across. A checkpointed file copy
// is taken first, because this is the one migration that could lose Devotion.
const playersDDL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='players'").get();
if (playersDDL && /\bwallet\b[^,]*\bUNIQUE\b/i.test(playersDDL.sql)) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath, `${dbPath}.pre-wallet-unique-rebuild`);
  } catch (e) {
    console.warn('pre-rebuild copy failed:', e.message);
  }
  const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => `"${c.name}"`).join(', ');
  const rebuiltDDL = playersDDL.sql
    .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["'`[]?players["'`\]]?/i, 'CREATE TABLE players_rebuild')
    .replace(/(\bwallet\b[^,]*?)\s+UNIQUE/i, '$1');
  try {
    db.transaction(() => {
      db.exec(rebuiltDDL);
      db.exec(`INSERT INTO players_rebuild (${cols}) SELECT ${cols} FROM players`);
      db.exec('DROP TABLE players');
      db.exec('ALTER TABLE players_rebuild RENAME TO players');
    })();
    // DROP TABLE took the old table's indexes with it.
    db.exec('CREATE INDEX IF NOT EXISTS idx_players_devotion ON players(devotion DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_players_wallet ON players(wallet)');
    console.log('players.wallet UNIQUE dropped; a wallet may now hold several Bloodlines');
  } catch (e) {
    console.error('players rebuild failed, leaving the table as it was:', e.message);
    try { db.exec('DROP TABLE IF EXISTS players_rebuild'); } catch { /* nothing to clean */ }
  }
}

// One player row per (wallet, Bloodline). The old unique index was on wallet
// alone, which would have collapsed a holder's several Bloodlines into one
// pile of Devotion the moment they switched between them.
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_wallet_token ON players(wallet, token_id)'); } catch { /* older sqlite, or rows already conflict */ }

// An X handle identifies a person, so it may be claimed once across the whole
// abbey — otherwise anyone could type someone else's handle onto their own
// Bloodline and collect that person's referrals. Guarded rather than put in
// schema.sql, which is exec'd as one block: on a database that already holds
// duplicate handles this index fails, and there it must be a logged warning
// rather than a server that will not boot.
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_x_handle ON players(x_handle) WHERE x_handle IS NOT NULL');
} catch (e) {
  console.warn('x_handle uniqueness NOT enforced — duplicates already exist:', e.message);
}

// Ghosts earn nothing, so no unbound row should be holding Devotion. Any that
// does earned it before that rule existed, and leaving it would put rows on the
// leaderboard that can never be audited against a Bloodline. Idempotent: once
// the rows are zeroed this matches nothing. An hourly backup and a boot backup
// both predate it, so the old numbers remain recoverable.
try {
  const stale = db.prepare('SELECT COUNT(*) n FROM players WHERE token_id IS NULL AND (devotion > 0 OR streak > 0)').get();
  if (stale && stale.n > 0) {
    db.prepare('UPDATE players SET devotion = 0, streak = 0, level = 1, last_duty_date = NULL WHERE token_id IS NULL AND (devotion > 0 OR streak > 0)').run();
    console.log(`cleared legacy Devotion from ${stale.n} unbound row(s) — a ghost earns nothing`);
  }
} catch (e) {
  console.warn('ghost Devotion cleanup skipped:', e.message);
}

// ---- BACKUPS ---------------------------------------------------------------
// Devotion is the only thing the abbey counts and it exists in exactly one
// file. sqlite's online backup API copies a consistent snapshot while the
// server keeps serving, so this needs no downtime and cannot catch a half-
// written transaction. Hourly, keeping a day's worth, plus one on boot —
// because the most likely moment to lose the file is a bad deploy, and a
// backup taken after the restart would already be too late.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP) || 24;

export async function backupNow(tag = '') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `aeterna-${stamp}${tag ? `-${tag}` : ''}.db`);
  await db.backup(dest);
  const mine = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('aeterna-') && f.endsWith('.db'))
    .sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - BACKUP_KEEP))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch { /* already gone */ }
  }
  return dest;
}

if (process.env.NODE_ENV !== 'test') {
  backupNow('boot').catch((e) => console.error('boot backup failed:', e.message));
  setInterval(() => backupNow().catch((e) => console.error('backup failed:', e.message)), 3600_000).unref();
}

// Seed the fixed set of claimable Cathedral Rooms (see web/js/abbeyMap.js
// CATHEDRAL_ALCOVES for their physical placement in the transept).
const seedRoom = db.prepare('INSERT OR IGNORE INTO cathedral_rooms (id, owner_id, owner_name, claimed_at) VALUES (?, NULL, NULL, NULL)');
for (const id of ['room-1', 'room-2', 'room-3', 'room-4']) seedRoom.run(id);

export default db;
