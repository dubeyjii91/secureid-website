import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
  CREATE INDEX IF NOT EXISTS security_events_user_id ON security_events(user_id);

  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    risk INTEGER NOT NULL DEFAULT 18,
    locked INTEGER NOT NULL DEFAULT 0,
    share_name INTEGER NOT NULL DEFAULT 1,
    share_age INTEGER NOT NULL DEFAULT 0,
    share_address INTEGER NOT NULL DEFAULT 0,
    share_identity_id INTEGER NOT NULL DEFAULT 1
  );
`);

const securityEventColumns = database.prepare("PRAGMA table_info(security_events)").all().map((column) => column.name);
if (!securityEventColumns.includes("user_agent")) {
  database.exec("ALTER TABLE security_events ADD COLUMN user_agent TEXT");
}
if (!securityEventColumns.includes("ip_hash")) {
  database.exec("ALTER TABLE security_events ADD COLUMN ip_hash TEXT");
}
if (!securityEventColumns.includes("metadata_json")) {
  database.exec("ALTER TABLE security_events ADD COLUMN metadata_json TEXT");
}

const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name);
if (!sessionColumns.includes("mfa_verified_until")) {
  database.exec("ALTER TABLE sessions ADD COLUMN mfa_verified_until INTEGER NOT NULL DEFAULT 0");
}

const userColumns = database.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("otp_last_sent_at")) {
  database.exec("ALTER TABLE users ADD COLUMN otp_last_sent_at INTEGER NOT NULL DEFAULT 0");
}

database.exec(`

  -- SECUREID_EMAIL_RECOVERY_V1
  CREATE TABLE IF NOT EXISTS email_verification_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id ON email_verification_tokens(user_id);
  CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_at ON email_verification_tokens(expires_at);

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id ON password_reset_tokens(user_id);
  CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

`);

// export { databasePath };
