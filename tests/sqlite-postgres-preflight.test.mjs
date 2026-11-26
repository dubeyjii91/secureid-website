import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSqlitePostgresPreflight } from "../scripts/sqlite-postgres-preflight.mjs";

function createFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "secureid-pg-preflight-"));
  const databasePath = path.join(directory, "source.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_documents_user ON documents(user_id);
    CREATE INDEX idx_documents_recent ON documents(created_at) WHERE created_at > 0;
    CREATE VIEW active_documents AS SELECT id,user_id FROM documents;
    CREATE TRIGGER activity_insert AFTER INSERT ON activity BEGIN
      UPDATE users SET created_at=created_at WHERE id=NEW.user_id;
    END;
  `);
  database.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").run("u1","private@example.test",1);
  database.prepare("INSERT INTO documents(id,user_id,created_at) VALUES(?,?,?)").run("d1","u1",2);
  database.prepare("INSERT INTO activity(user_id,created_at) VALUES(?,?)").run("u1",3);
  database.close();
  return { directory, databasePath };
}

test("PostgreSQL preflight inventories schema and counts without exporting personal data", () => {
  const fixture = createFixture();
  try {
    const report = buildSqlitePostgresPreflight(fixture.databasePath);
    assert.equal(report.source.engine, "sqlite");
    assert.equal(report.integrity.ok, true);
    assert.equal(report.integrity.foreignKeyViolationCount, 0);
    assert.equal(report.summary.tableCount, 3);
    assert.equal(report.summary.rowCount, 3);
    assert.equal(report.summary.indexCount, 3);
    assert.equal(report.summary.viewCount, 1);
    assert.equal(report.summary.triggerCount, 1);
    assert.deepEqual(report.insertionOrder, ["users", "activity", "documents"]);
    assert.ok(report.tables.find((table) => table.name === "users").sqliteFeatures.includes("NOCASE collation"));
    assert.ok(report.tables.find((table) => table.name === "activity").sqliteFeatures.includes("AUTOINCREMENT"));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("private@example.test"), false);
    assert.equal(serialized.includes("private@example"), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("PostgreSQL preflight detects broken foreign keys and reports an unsafe database", () => {
  const fixture = createFixture();
  try {
    const database = new DatabaseSync(fixture.databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.prepare("INSERT INTO documents(id,user_id,created_at) VALUES(?,?,?)").run("orphan","missing-user",4);
    database.close();

    const report = buildSqlitePostgresPreflight(fixture.databasePath);
    assert.equal(report.integrity.ok, true);
    assert.equal(report.integrity.foreignKeyViolationCount, 1);
    assert.equal(report.warnings.some((warning) => warning.includes("foreign_key_check")), true);
    assert.equal(report.integrity.foreignKeyViolations[0].table, "documents");
    assert.equal(report.integrity.foreignKeyViolations[0].parent, "users");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("PostgreSQL preflight flags cyclic foreign-key table dependencies", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "secureid-pg-preflight-"));
  const databasePath = path.join(directory, "cycles.sqlite");
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE left_side (id TEXT PRIMARY KEY, right_id TEXT REFERENCES right_side(id));
      CREATE TABLE right_side (id TEXT PRIMARY KEY, left_id TEXT REFERENCES left_side(id));
    `);
    database.close();
    const report = buildSqlitePostgresPreflight(databasePath);
    assert.deepEqual(report.summary.cyclicForeignKeyTables, ["left_side", "right_side"]);
    assert.equal(report.warnings.some((warning) => warning.includes("cyclic")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PostgreSQL preflight refuses a missing database file", () => {
  assert.throws(
    () => buildSqlitePostgresPreflight(path.join(os.tmpdir(), "secureid-this-file-does-not-exist.sqlite")),
    /does not exist/,
  );
});
