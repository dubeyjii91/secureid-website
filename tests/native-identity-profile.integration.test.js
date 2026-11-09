import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { registerProductionFeatures } from "../server/production-features.js";

test("identity profile is encrypted, authenticated, and MFA protected", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-profile-"));
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
  const profile = {
    name: "Sample User",
    age: "",
    dateOfBirth: "2000-01-01",
    address: "Example address",
    email: "owner@example.test",
    phone: "9000000000",
    identityId: "",
    college: "Example College",
    studentId: "STU-01",
    governmentId: "MASKED-01"
  };

  const save = await fetch(base + "/api/identity/profile", {
    method: "PUT",
    headers: headers("owner"),
    body: JSON.stringify(profile)
  });
  assert.equal(save.status, 200, await save.clone().text());
  assert.deepEqual((await save.json()).profile, profile);

  const stored = database.prepare("SELECT encrypted_data FROM identity_profiles WHERE user_id='owner'").get();
  assert.equal(stored.encrypted_data.includes("Sample User"), false);
  assert.equal(stored.encrypted_data.includes("9000000000"), false);

  const read = await fetch(base + "/api/identity/profile", { headers: headers("owner") });
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).profile, profile);

  const otherRead = await fetch(base + "/api/identity/profile", { headers: headers("other") });
  assert.equal(otherRead.status, 200);
  assert.deepEqual((await otherRead.json()).profile, {});

  const mfaBlocked = await fetch(base + "/api/identity/profile", {
    method: "PUT",
    headers: headers("owner", false),
    body: JSON.stringify({ name: "Changed" })
  });
  assert.equal(mfaBlocked.status, 403);
});
