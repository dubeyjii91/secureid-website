import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerProductionFeatures } from "../server/production-features.js";

test("admin document vault enforces owner and MFA gates, filters deleted records, decrypts downloads, and audits access", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-admin-vault-"));
  const previousStorage = process.env.DOCUMENT_STORAGE_PATH;
  const previousKey = process.env.DOCUMENT_ENCRYPTION_KEY;
  const key = randomBytes(32);
  process.env.DOCUMENT_STORAGE_PATH = path.join(root, "documents");
  process.env.DOCUMENT_ENCRYPTION_KEY = key.toString("base64");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
    INSERT INTO users(id,email) VALUES ('owner-1','owner@example.test'),('user-1','user@example.test');
  `);

  const app = express();
  app.use((req, res, next) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ success: false });
    req.user = {
      id,
      email: id === "owner-1" ? "owner@example.test" : "user@example.test",
      role: req.get("x-test-role") || "user",
      mfaVerified: req.get("x-test-mfa") !== "false"
    };
    req.get = ((original) => (name) => name.toLowerCase() === "x-request-id" ? "admin-vault-test-request" : original(name))(req.get.bind(req));
    next();
  });
  registerProductionFeatures({
    app,
    database,
    requireAuth: (req, res, next) => next(),
    enforceSameOrigin: (req, res, next) => next(),
    isProduction: false,
    logEvent: () => {},
    ensureSecurityNotification: () => {}
  });
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ success: false, message: "Request failed." }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    rmSync(root, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.DOCUMENT_STORAGE_PATH;
    else process.env.DOCUMENT_STORAGE_PATH = previousStorage;
    if (previousKey === undefined) delete process.env.DOCUMENT_ENCRYPTION_KEY;
    else process.env.DOCUMENT_ENCRYPTION_KEY = previousKey;
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (user, role = "user", mfa = true) => ({
    "x-test-user": user,
    "x-test-role": role,
    "x-test-mfa": String(mfa)
  });
  const original = Buffer.from("%PDF-1.7\nSecureID admin vault behavioral test\n%%EOF");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(original), cipher.final()]);
  const documentId = randomUUID();
  const storagePath = path.join(root, "documents", "fixture.json");
  mkdirSync(path.dirname(storagePath), { recursive: true });
  writeFileSync(storagePath, JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  }));
  const now = Date.now();
  database.prepare(`
    INSERT INTO secure_documents
      (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(documentId, "user-1", "student-proof.pdf", "application/pdf", original.length, storagePath, "student_id", now, null);
  database.prepare(`
    INSERT INTO secure_documents
      (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run("deleted-doc", "user-1", "deleted-proof.pdf", "application/pdf", 12, storagePath, "student_id", now + 1, now + 2);

  const deniedNonOwner = await fetch(base + "/api/admin/documents", { headers: headers("user-1", "user", true) });
  assert.equal(deniedNonOwner.status, 403);
  assert.equal((await deniedNonOwner.json()).code, "OWNER_REQUIRED");

  const deniedWithoutMfa = await fetch(base + "/api/admin/documents", { headers: headers("owner-1", "owner", false) });
  assert.equal(deniedWithoutMfa.status, 403);
  assert.equal((await deniedWithoutMfa.json()).code, "MFA_REQUIRED");

  const listing = await fetch(base + "/api/admin/documents?limit=10&offset=0", {
    headers: headers("owner-1", "owner", true)
  });
  assert.equal(listing.status, 200, await listing.clone().text());
  const listingBody = await listing.json();
  assert.equal(listingBody.total, 1);
  assert.equal(listingBody.documents.length, 1);
  assert.equal(listingBody.documents[0].id, documentId);
  assert.equal(listing.headers.get("cache-control"), "no-store");

  const download = await fetch(base + `/api/admin/documents/${documentId}/download`, {
    headers: headers("owner-1", "owner", true)
  });
  assert.equal(download.status, 200, await download.clone().text());
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.equal(download.headers.get("referrer-policy"), "no-referrer");

  const missing = await fetch(base + "/api/admin/documents/deleted-doc/download", {
    headers: headers("owner-1", "owner", true)
  });
  assert.equal(missing.status, 404);

  const audit = database.prepare("SELECT action,outcome,document_id FROM admin_document_access_audit ORDER BY created_at ASC").all();
  assert.ok(audit.some((row) => row.action === "document_list" && row.outcome === "denied"));
  assert.ok(audit.some((row) => row.action === "document_list" && row.outcome === "success"));
  assert.ok(audit.some((row) => row.action === "document_download" && row.outcome === "success" && row.document_id === documentId));
  assert.ok(audit.some((row) => row.action === "document_download" && row.outcome === "not_found" && row.document_id === "deleted-doc"));
});
