import { mkdirSync } from \"node:fs\";
import { dirname, resolve } from \"node:path\";
import { DatabaseSync } from \"node:sqlite\";

const configuredPath = process.env.DATABASE_PATH || \"./data/secureid.sqlite\";
const databasePath = configuredPath === \":memory:\" ? configuredPath : resolve(configuredPath);
if (databasePath !== \":memory:\") mkdirSync(dirname(databasePath), { recursive: true });

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
    otp_last_sent_at INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    locked INTEGER NOT NULL DEFAULT 0,
    share_data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wallets_user_id ON wallets(user_id);

  CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    date_of_birth TEXT,
    verification_status TEXT,
    phone_number TEXT,
    college_institution TEXT,
    student_id TEXT,
    government_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_profiles_user_id ON user_profiles(user_id);
`);\n\nconst sessionColumns = database.prepare(\"PRAGMA table_info(sessions)\").all().map((column) => column.name);\nif (!sessionColumns.includes(\"mfa_verified_until\")) {\n  database.exec(\"ALTER TABLE sessions ADD COLUMN mfa_verified_until INTEGER NOT NULL DEFAULT 0\");\n}\n\nconst userColumns = database.prepare(\"PRAGMA table_info(users)\").all().map((column) => column.name);\nif (!userColumns.includes(\"otp_last_sent_at\")) {\n  database.exec(\"ALTER TABLE users ADD COLUMN otp_last_sent_at INTEGER NOT NULL DEFAULT 0\");\n}\n\nconst walletColumns = database.prepare(\"PRAGMA table_info(wallets)\").all().map((column) => column.name);\nif (walletColumns.length === 0) {\n  // Table will be created from the CREATE TABLE IF NOT EXISTS above\n}\n\nconst profileColumns = database.prepare(\"PRAGMA table_info(user_profiles)\").all().map((column) => column.name);\nif (profileColumns.length === 0) {\n  // Table will be created from the CREATE TABLE IF NOT EXISTS above\n}\n\nexport { databasePath };\n
