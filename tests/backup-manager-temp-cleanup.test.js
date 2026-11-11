import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runEncryptedBackup } from "../server/backup-manager.js";

test("encrypted backup always removes its plaintext snapshot directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "secureid-backup-manager-cleanup-"));
  const dbPath = path.join(root, "db", "secureid.sqlite");
  const backupDir = path.join(root, "backups");
  const documentDir = path.join(root, "documents");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(documentDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO smoke(value) VALUES ('ok')");
  db.close();

  const keys = ["DATABASE_PATH", "BACKUP_DIR", "DOCUMENT_STORAGE_PATH", "BACKUP_ENCRYPTION_KEY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.DATABASE_PATH = dbPath;
    process.env.BACKUP_DIR = backupDir;
    process.env.DOCUMENT_STORAGE_PATH = documentDir;
    process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    const backup = runEncryptedBackup();
    assert.equal(backup.success, true);
    assert.equal(statSync(backup.file).mode & 0o777, 0o600);
    assert.equal(readdirSync(backupDir).some((name) => name.startsWith(".secureid-snapshot-")), false,
      "successful backup must not leave a plaintext snapshot directory");

    const invalidDocumentPath = path.join(root, "not-a-directory");
    writeFileSync(invalidDocumentPath, "not a directory");
    process.env.DOCUMENT_STORAGE_PATH = invalidDocumentPath;
    assert.throws(() => runEncryptedBackup(), /ENOTDIR|not a directory/i);
    assert.equal(readdirSync(backupDir).some((name) => name.startsWith(".secureid-snapshot-")), false,
      "failed backup must not leave a plaintext snapshot directory");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid backup retention values never delete all existing recovery points", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "secureid-backup-retention-"));
  const dbPath = path.join(root, "db", "secureid.sqlite");
  const backupDir = path.join(root, "backups");
  const documentDir = path.join(root, "documents");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(documentDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
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
    for (const invalid of ["not-a-number", "0", "-5", "1.5", "Infinity"]) {
      writeFileSync(path.join(backupDir, `existing-${invalid.replace(/[^a-z0-9]/gi, "_")}.backup.json`), "encrypted-fixture");
      process.env.BACKUP_RETENTION_COUNT = invalid;
      const result = runEncryptedBackup();
      assert.equal(result.success, true);
      const recoveryPoints = readdirSync(backupDir).filter((name) => name.endsWith(".backup.json"));
      assert.ok(recoveryPoints.length >= 2, `invalid retention value ${invalid} must not erase existing recovery points`);
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
