import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const configuredPath = process.env.DATABASE_PATH || "./data/secureid.sqlite";
const databasePath = configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath, { timeout: 5000 });
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    otp_last_sent_at INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    age INTEGER,
    date_of_birth TEXT,
    phone_number TEXT,
    address TEXT,
    college_institution TEXT,
    student_id TEXT,
    government_id_masked TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    mfa_verified_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS otp_challenges_user_id ON otp_challenges(user_id);
  
  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS security_events_user_id
    ON security_events(user_id);
  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_shares (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_token TEXT NOT NULL UNIQUE,
    share_data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wallet_shares_user_id ON wallet_shares(user_id);
`);

const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name);
if (!sessionColumns.includes("mfa_verified_until")) {
  database.exec("ALTER TABLE sessions ADD COLUMN mfa_verified_until INTEGER NOT NULL DEFAULT 0");
}

const userColumns = database.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("otp_last_sent_at")) {
  database.exec("ALTER TABLE users ADD COLUMN otp_last_sent_at INTEGER NOT NULL DEFAULT 0");
}

// Add profile columns if they don't exist
const profileFields = ["name", "age", "date_of_birth", "phone_number", "address", "college_institution", "student_id", "government_id_masked"];
profileFields.forEach(field => {
  if (!userColumns.includes(field)) {
    database.exec(`ALTER TABLE users ADD COLUMN ${field} TEXT`);
  }
});

export { databasePath };

