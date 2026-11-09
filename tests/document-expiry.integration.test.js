import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { registerProductionFeatures } from "../server/production-features.js";

test("document expiry metadata is optional, validated, owner-scoped, and MFA protected", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-expiry-"));
  const priorStorage = process.env.DOCUMENT_STORAGE_PATH;
  const priorKey = process.env.DOCUMENT_ENCRYPTION_KEY;
  process.env.DOCUMENT_STORAGE_PATH = path.join(root, "documents");
  process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE rate_limits (bucket_key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
    CREATE TABLE wallet_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id), risk INTEGER DEFAULT 0, locked INTEGER DEFAULT 0,
      share_name INTEGER DEFAULT 1, share_age INTEGER DEFAULT 0, share_date_of_birth INTEGER DEFAULT 0,
      share_address INTEGER DEFAULT 0, share_email INTEGER DEFAULT 0, share_phone INTEGER DEFAULT 0,
      share_identity_id INTEGER DEFAULT 0, share_college INTEGER DEFAULT 0, share_student_id INTEGER DEFAULT 0,
      share_government_id INTEGER DEFAULT 0, share_verification_status INTEGER DEFAULT 0
    );
    INSERT INTO users(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
    INSERT INTO wallet_settings(user_id) VALUES ('owner'),('other');
  `);

  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ success: false });
    req.user = { id, mfaVerified: req.get("x-test-mfa") !== "false" };
    next();
  };
  registerProductionFeatures({
    app,
    database,
    requireAuth,
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
    if (priorStorage === undefined) delete process.env.DOCUMENT_STORAGE_PATH;
    else process.env.DOCUMENT_STORAGE_PATH = priorStorage;
    if (priorKey === undefined) delete process.env.DOCUMENT_ENCRYPTION_KEY;
    else process.env.DOCUMENT_ENCRYPTION_KEY = priorKey;
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (user, mfa = true) => ({
    "x-test-user": user,
    "x-test-mfa": String(mfa),
    "content-type": "application/json"
  });

  // Existing records from before this feature have no expiry and remain listed.
  database.prepare(`
    INSERT INTO secure_documents
      (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at)
    VALUES ('doc-owner','owner','passport.pdf','application/pdf',12,'/not-used','passport',100)
  `).run();

  const listBefore = await fetch(base + "/api/documents", { headers: headers("owner") });
  assert.equal(listBefore.status, 200);
  const before = (await listBefore.json()).documents.find((doc) => doc.id === "doc-owner");
  assert.equal(before.expiryDate, null);

  const valid = await fetch(base + "/api/documents/doc-owner/metadata", {
    method: "PUT",
    headers: headers("owner"),
    body: JSON.stringify({ expiryDate: "2030-12-31" })
  });
  assert.equal(valid.status, 200, await valid.clone().text());
  assert.deepEqual(await valid.json(), { success: true, expiryDate: "2030-12-31" });

  const listAfter = await fetch(base + "/api/documents", { headers: headers("owner") });
  assert.equal((await listAfter.json()).documents.find((doc) => doc.id === "doc-owner").expiryDate, "2030-12-31");

  for (const invalidDate of ["2030-02-30", "2030-2-03", "not-a-date"]) {
    const invalid = await fetch(base + "/api/documents/doc-owner/metadata", {
      method: "PUT",
      headers: headers("owner"),
      body: JSON.stringify({ expiryDate: invalidDate })
    });
    assert.equal(invalid.status, 400, `Expected ${invalidDate} to be rejected`);
  }

  const crossAccount = await fetch(base + "/api/documents/doc-owner/metadata", {
    method: "PUT",
    headers: headers("other"),
    body: JSON.stringify({ expiryDate: "2031-01-01" })
  });
  assert.equal(crossAccount.status, 404);

  const noMfa = await fetch(base + "/api/documents/doc-owner/metadata", {
    method: "PUT",
    headers: headers("owner", false),
    body: JSON.stringify({ expiryDate: "2031-01-01" })
  });
  assert.equal(noMfa.status, 403);

  const cleared = await fetch(base + "/api/documents/doc-owner/metadata", {
    method: "PUT",
    headers: headers("owner"),
    body: JSON.stringify({ expiryDate: null })
  });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).expiryDate, null);
});
