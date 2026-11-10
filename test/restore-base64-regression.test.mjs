import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const restoreScript = path.resolve("scripts/secure-restore.mjs");

function makeEncryptedBackup(snapshot, key) {
  const plaintext = Buffer.from(JSON.stringify(snapshot));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    version: 2,
    createdAt: new Date().toISOString(),
    sha256: createHash("sha256").update(plaintext).digest("hex"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  });
}

function makeDatabase(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE restore_fixture (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO restore_fixture(value) VALUES ('restored');");
  } finally {
    db.close();
  }
  return readFileSync(file);
}

test("restore accepts large canonical base64 document blobs", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "secureid-restore-large-"));
  try {
    const key = randomBytes(32);
    const databasePath = path.join(root, "restored.sqlite");
    const documentDir = path.join(root, "documents");
    const sourceDb = path.join(root, "source.sqlite");
    const database = makeDatabase(sourceDb);
    const documentBytes = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const documentName = "12345678-1234-4234-8234-123456789abc.json";
    const backupPath = path.join(root, "large.backup.json");
    const backup = makeEncryptedBackup({
      version: 2,
      database: database.toString("base64"),
      documents: [{ name: documentName, data: documentBytes.toString("base64") }]
    }, key);
    writeFileSync(backupPath, backup);

    const result = spawnSync(process.execPath, [restoreScript, backupPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_ENCRYPTION_KEY: key.toString("base64"),
        DATABASE_PATH: databasePath,
        DOCUMENT_STORAGE_PATH: documentDir
      },
      timeout: 15000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).success, true);
    assert.deepEqual(readFileSync(path.join(documentDir, documentName)), documentBytes);
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(restored.prepare("SELECT value FROM restore_fixture").get().value, "restored");
    } finally {
      restored.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restore rejects malformed document base64 before touching destination data", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "secureid-restore-invalid-"));
  try {
    const key = randomBytes(32);
    const databasePath = path.join(root, "existing.sqlite");
    const documentDir = path.join(root, "documents");
    mkdirSync(documentDir);
    const originalDb = Buffer.from("preserve-existing-database");
    const originalDoc = Buffer.from("preserve-existing-document");
    writeFileSync(databasePath, originalDb);
    writeFileSync(path.join(documentDir, "keep.txt"), originalDoc);
    const backupPath = path.join(root, "invalid.backup.json");
    const sourceDb = path.join(root, "source.sqlite");
    const database = makeDatabase(sourceDb);
    writeFileSync(backupPath, makeEncryptedBackup({
      version: 2,
      database: database.toString("base64"),
      documents: [{ name: "12345678-1234-4234-8234-123456789abc.json", data: "not-base64!" }]
    }, key));

    const result = spawnSync(process.execPath, [restoreScript, backupPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BACKUP_ENCRYPTION_KEY: key.toString("base64"),
        DATABASE_PATH: databasePath,
        DOCUMENT_STORAGE_PATH: documentDir
      },
      timeout: 15000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Backup contains an invalid document entry/);
    assert.deepEqual(readFileSync(databasePath), originalDb);
    assert.deepEqual(readFileSync(path.join(documentDir, "keep.txt")), originalDoc);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
