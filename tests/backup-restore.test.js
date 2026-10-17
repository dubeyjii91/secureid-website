import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes, createCipheriv, createHash } from "node:crypto";

test("encrypted backup restores a consistent SQLite snapshot and verifies integrity", () => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-restore-test-"));
  const dbPath = path.join(root, "secureid.sqlite");
  const backupDir = path.join(root, "backups");
  const documentDir = path.join(root, "documents");
  const restoredDocumentDir = path.join(root, "restored-documents");
  const restorePath = path.join(root, "restored.sqlite");
  const key = randomBytes(32).toString("base64");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE probe (value TEXT NOT NULL); INSERT INTO probe(value) VALUES ('before-backup')");
  db.close();

  mkdirSync(documentDir, { recursive: true });
  writeFileSync(path.join(documentDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json"), "encrypted-vault-file-fixture", { mode: 0o600 });
  writeFileSync(path.join(documentDir, "unexpected.json"), "not-a-vault-blob", { mode: 0o600 });
  const env = { ...process.env, DATABASE_PATH: dbPath, BACKUP_DIR: backupDir, DOCUMENT_STORAGE_PATH: documentDir, BACKUP_ENCRYPTION_KEY: key };
  try {
    const backup = spawnSync(process.execPath, ["scripts/secure-backup.mjs"], { cwd: process.cwd(), env, encoding: "utf8" });
    assert.equal(backup.status, 0, backup.stderr || backup.stdout);
    const backupResult = JSON.parse(backup.stdout.trim().split("\n").at(-1));
    assert.equal(backupResult.success, true);
    assert.equal(statSync(backupResult.file).mode & 0o777, 0o600, "encrypted backup files must be owner-readable/writable only");

    const mutate = new DatabaseSync(dbPath);
    mutate.prepare("INSERT INTO probe(value) VALUES (?)").run("after-backup");
    mutate.close();

    writeFileSync(path.join(documentDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json"), "changed-after-backup", { mode: 0o600 });
    const restoreEnv = { ...env, DATABASE_PATH: restorePath, DOCUMENT_STORAGE_PATH: restoredDocumentDir };
    const restore = spawnSync(process.execPath, ["scripts/secure-restore.mjs", backupResult.file], { cwd: process.cwd(), env: restoreEnv, encoding: "utf8" });
    assert.equal(restore.status, 0, restore.stderr || restore.stdout);
    assert.equal(JSON.parse(restore.stdout.trim().split("\n").at(-1)).success, true);

    const restored = new DatabaseSync(restorePath);
    assert.deepEqual(restored.prepare("SELECT value FROM probe ORDER BY rowid").all().map((row) => row.value), ["before-backup"]);
    restored.close();
    assert.equal(readFileSync(path.join(restoredDocumentDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json"), "utf8"), "encrypted-vault-file-fixture", "restore must recover encrypted vault blobs alongside the database");
    assert.equal(existsSync(path.join(restoredDocumentDir, "unexpected.json")), false, "backup must exclude files that do not match vault blob naming");

    const payload = JSON.parse(readFileSync(backupResult.file, "utf8"));
    payload.data = Buffer.from(payload.data, "base64").map((byte, index) => index === 0 ? byte ^ 1 : byte).toString("base64");
    const tampered = path.join(backupDir, "tampered.backup.json");
    writeFileSync(tampered, JSON.stringify(payload));
    const tamperedRestore = spawnSync(process.execPath, ["scripts/secure-restore.mjs", tampered], { cwd: process.cwd(), env: restoreEnv, encoding: "utf8" });
    assert.notEqual(tamperedRestore.status, 0, "tampered backup must not restore");

    // Even a correctly encrypted and authenticated snapshot must reject unsafe vault filenames
    // before changing the destination database or writing any vault file.
    const invalidSnapshot = Buffer.from(JSON.stringify({
      version: 2,
      database: readFileSync(dbPath).toString("base64"),
      documents: [{ name: "../../escape.json", data: Buffer.from("unsafe").toString("base64") }]
    }), "utf8");
    const invalidIv = randomBytes(12);
    const invalidCipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), invalidIv);
    const invalidCiphertext = Buffer.concat([invalidCipher.update(invalidSnapshot), invalidCipher.final()]);
    const invalidPayload = {
      version: 2,
      iv: invalidIv.toString("base64"),
      tag: invalidCipher.getAuthTag().toString("base64"),
      data: invalidCiphertext.toString("base64"),
      sha256: createHash("sha256").update(invalidSnapshot).digest("hex")
    };
    const invalidBackup = path.join(backupDir, "invalid-document-entry.backup.json");
    writeFileSync(invalidBackup, JSON.stringify(invalidPayload));
    const protectedDbPath = path.join(root, "must-remain-unchanged.sqlite");
    writeFileSync(protectedDbPath, "destination-sentinel");
    const invalidRestore = spawnSync(process.execPath, ["scripts/secure-restore.mjs", invalidBackup], {
      cwd: process.cwd(),
      env: { ...restoreEnv, DATABASE_PATH: protectedDbPath },
      encoding: "utf8"
    });
    assert.notEqual(invalidRestore.status, 0, "unsafe vault filenames must be rejected");
    assert.equal(readFileSync(protectedDbPath, "utf8"), "destination-sentinel",
      "invalid snapshot must be rejected before replacing the destination database");
    assert.equal(existsSync(path.join(root, "escape.json")), false, "restore must not write outside the vault directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

