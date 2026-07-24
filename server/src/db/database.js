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

// Defensive migration for DBs created before flags_date existed.
try {
  db.exec('ALTER TABLE players ADD COLUMN flags_date TEXT');
} catch {
  // column already exists
}

// Seed the fixed set of claimable Cathedral Rooms (see web/js/abbeyMap.js
// CATHEDRAL_ALCOVES for their physical placement in the transept).
const seedRoom = db.prepare('INSERT OR IGNORE INTO cathedral_rooms (id, owner_id, owner_name, claimed_at) VALUES (?, NULL, NULL, NULL)');
for (const id of ['room-1', 'room-2', 'room-3', 'room-4']) seedRoom.run(id);

export default db;
