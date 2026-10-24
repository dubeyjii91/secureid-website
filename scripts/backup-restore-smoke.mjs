import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "secureid-backup-restore-test-"));
const dbPath = path.join(temp, "db", "secureid.sqlite");
const backupDir = path.join(temp, "backups");
const documentDir = path.join(temp, "documents");
const key = randomBytes(32).toString("base64");
const documentId = randomUUID();
const documentPath = path.join(documentDir, documentId + ".json");
const originalDocument = JSON.stringify({ version: 1, test: "dummy document round-trip" });

function run(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: dbPath, BACKUP_DIR: backupDir, DOCUMENT_STORAGE_PATH: documentDir, BACKUP_ENCRYPTION_KEY: key },
    timeout: 15000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${path.basename(scriptPath)} failed: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(documentDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE smoke_test (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO smoke_test (id, value) VALUES (?, ?)").run("seed", "before-backup");
  db.close();
  writeFileSync(documentPath, originalDocument, { mode: 0o600 });

  const backupResult = JSON.parse(run(path.join(root, "scripts", "secure-backup.mjs")));
  assert.equal(backupResult.success, true);
  assert.ok(existsSync(backupResult.file), "encrypted backup file should exist");

  const changedDb = new DatabaseSync(dbPath);
  changedDb.prepare("UPDATE smoke_test SET value = ? WHERE id = ?").run("after-backup", "seed");
  changedDb.close();
  writeFileSync(documentPath, JSON.stringify({ version: 1, test: "mutated" }));

  const restoreResult = JSON.parse(run(path.join(root, "scripts", "secure-restore.mjs"), [backupResult.file]));
  assert.equal(restoreResult.success, true);
  assert.equal(restoreResult.restoredDocuments, 1);

  const restoredDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(restoredDb.prepare("SELECT value FROM smoke_test WHERE id = ?").get("seed").value, "before-backup");
    assert.equal(restoredDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    restoredDb.close();
  }
  assert.equal(readFileSync(documentPath, "utf8"), originalDocument);
  console.log("PASS: encrypted backup/restore round-trip, SQLite integrity, and dummy document restore");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
