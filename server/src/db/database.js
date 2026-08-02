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

// One player row per (wallet, Bloodline). The old unique index was on wallet
// alone, which would have collapsed a holder's several Bloodlines into one
// pile of Devotion the moment they switched between them.
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_wallet_token ON players(wallet, token_id)'); } catch { /* older sqlite, or rows already conflict */ }

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
