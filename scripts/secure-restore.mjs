import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const backupPath = process.argv[2];
const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/secureid.sqlite");
const documentDir = path.resolve(process.env.DOCUMENT_STORAGE_PATH || "./data/secureid-documents");
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
if (!backupPath || !existsSync(backupPath)) throw new Error("Pass a valid encrypted backup file.");
if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64 32-byte key.");

let payload;
try {
  payload = JSON.parse(readFileSync(backupPath, "utf8"));
} catch {
  throw new Error("Backup file is not valid JSON.");
}
if (!payload || typeof payload.iv !== "string" || typeof payload.tag !== "string" ||
    typeof payload.data !== "string" || typeof payload.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(payload.sha256)) {
  throw new Error("Backup envelope is invalid.");
}

let decrypted;
try {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]);
} catch {
  throw new Error("Backup authentication failed: wrong key or corrupted backup.");
}
const digest = createHash("sha256").update(decrypted).digest("hex");
if (digest !== payload.sha256) throw new Error("Backup integrity check failed.");

let databaseBytes = decrypted;
let documents = null;
if (payload.version === 2) {
  let snapshot;
  try { snapshot = JSON.parse(decrypted.toString("utf8")); }
  catch { throw new Error("Backup snapshot is invalid."); }
  if (snapshot.version !== 2 || typeof snapshot.database !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(snapshot.database) ||
      !Array.isArray(snapshot.documents)) {
    throw new Error("Backup snapshot is incomplete.");
  }
  databaseBytes = Buffer.from(snapshot.database, "base64");
  documents = snapshot.documents;
  const names = new Set();
  for (const item of documents) {
    if (!item || typeof item.name !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i.test(item.name) ||
        typeof item.data !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data) ||
        names.has(item.name)) {
      throw new Error("Backup contains an invalid document entry.");
    }
    names.add(item.name);
  }
} else if (payload.version !== 1) {
  throw new Error("Unsupported backup version.");
}

const stamp = Date.now() + "-" + randomBytes(4).toString("hex");
const dbParent = path.dirname(dbPath);
const docParent = path.dirname(documentDir);
const tempDb = path.join(dbParent, ".secureid-restore-" + stamp + ".sqlite");
const previousDb = dbPath + ".pre-restore-" + stamp;
const stageDocs = documentDir + "-restore-" + stamp;
const previousDocs = documentDir + "-pre-restore-" + stamp;
mkdirSync(dbParent, { recursive: true });
mkdirSync(docParent, { recursive: true });
let dbMoved = false;
let docsMoved = false;
let newDbInstalled = false;
let newDocsInstalled = false;

try {
  writeFileSync(tempDb, databaseBytes, { mode: 0o600, flag: "wx" });
  // Reject malformed or non-SQLite payloads before touching the destination database.
  const validationDb = new DatabaseSync(tempDb, { readOnly: true });
  try {
    const integrity = validationDb.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("Restored database failed SQLite integrity_check.");
    }
  } finally {
    validationDb.close();
  }

  if (documents) {
    mkdirSync(stageDocs, { recursive: false });
    for (const item of documents) {
      writeFileSync(path.join(stageDocs, item.name), Buffer.from(item.data, "base64"), { mode: 0o600, flag: "wx" });
    }
  }

  if (existsSync(dbPath)) {
    renameSync(dbPath, previousDb);
    dbMoved = true;
  }
  renameSync(tempDb, dbPath);
  newDbInstalled = true;

  if (documents) {
    if (existsSync(documentDir)) {
      renameSync(documentDir, previousDocs);
      docsMoved = true;
    }
    renameSync(stageDocs, documentDir);
    newDocsInstalled = true;
  }

  // Keep the pre-restore database as a recovery copy; document staging is removed only after success.
  if (docsMoved) rmSync(previousDocs, { recursive: true, force: true });
  console.log(JSON.stringify({ success: true, restoredTo: dbPath, restoredDocuments: documents?.length ?? null, sha256: digest }));
} catch (error) {
  if (newDocsInstalled && existsSync(documentDir)) rmSync(documentDir, { recursive: true, force: true });
  if (docsMoved && existsSync(previousDocs) && !existsSync(documentDir)) renameSync(previousDocs, documentDir);
  if (newDbInstalled && existsSync(dbPath)) rmSync(dbPath, { force: true });
  if (dbMoved && existsSync(previousDb) && !existsSync(dbPath)) renameSync(previousDb, dbPath);
  throw error;
} finally {
  rmSync(tempDb, { force: true });
  rmSync(stageDocs, { recursive: true, force: true });
}
