import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runEncryptedBackup } from "../server/backup-manager.js";

test("invalid backup retention setting preserves existing encrypted backups", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "secureid-retention-test-"));
  const dbPath = path.join(root, "db", "secureid.sqlite");
  const backupDir = path.join(root, "backups");
  const documentDir = path.join(root, "documents");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(documentDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO smoke(value) VALUES ('ok')");
  db.close();

  const keys = ["DATABASE_PATH", "BACKUP_DIR", "DOCUMENT_STORAGE_PATH", "BACKUP_ENCRYPTION_KEY", "BACKUP_RETENTION_COUNT"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.DATABASE_PATH = dbPath;
    process.env.BACKUP_DIR = backupDir;
    process.env.DOCUMENT_STORAGE_PATH = documentDir;
    process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.BACKUP_RETENTION_COUNT = "7";
    assert.equal(runEncryptedBackup().success, true);
    assert.equal(readdirSync(backupDir).filter((name) => name.endsWith(".backup.json")).length, 1);

    process.env.BACKUP_RETENTION_COUNT = "not-a-number";
    assert.equal(runEncryptedBackup().success, true);
    assert.equal(readdirSync(backupDir).filter((name) => name.endsWith(".backup.json")).length, 2);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
