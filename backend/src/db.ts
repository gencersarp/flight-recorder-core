import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../data.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Schema versioning and migration system
const CURRENT_SCHEMA_VERSION = 1;

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function getSchemaVersion(): number {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as any;
  return row?.version || 0;
}

function applyMigrations() {
  const version = getSchemaVersion();

  if (version < 1) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'running',
          model TEXT,
          temperature REAL,
          metadata TEXT,
          tags TEXT
        );

        CREATE TABLE IF NOT EXISTS steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          type TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          duration INTEGER,
          payload TEXT,
          FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model);
        CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);

        INSERT INTO schema_version (version) VALUES (1);
      `);
    });
    migrate();
  }
}

applyMigrations();

export default db;
