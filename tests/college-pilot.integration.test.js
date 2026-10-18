import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { registerProductionFeatures } from "../server/production-features.js";

test("college pilot requests require MFA, are encrypted at rest, validated, and account-scoped", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-college-pilot-"));
  const previousStorage = process.env.DOCUMENT_STORAGE_PATH;
  const previousKey = process.env.DOCUMENT_ENCRYPTION_KEY;
  process.env.DOCUMENT_STORAGE_PATH = path.join(root, "documents");
  process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE rate_limits (bucket_key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
    CREATE TABLE wallet_settings (
      user_id TEXT PRIMARY KEY, risk INTEGER DEFAULT 0, locked INTEGER DEFAULT 0,
      share_name INTEGER DEFAULT 1, share_age INTEGER DEFAULT 0, share_date_of_birth INTEGER DEFAULT 0,
      share_address INTEGER DEFAULT 0, share_email INTEGER DEFAULT 0, share_phone INTEGER DEFAULT 0,
      share_identity_id INTEGER DEFAULT 0, share_college INTEGER DEFAULT 0, share_student_id INTEGER DEFAULT 0,
      share_government_id INTEGER DEFAULT 0, share_verification_status INTEGER DEFAULT 0
    );
    INSERT INTO users(id,email) VALUES ('user-a','a@example.test'),('user-b','b@example.test');
    INSERT INTO wallet_settings(user_id) VALUES ('user-a'),('user-b');
  `);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ success: false });
    req.user = { id, mfaVerified: req.get("x-test-mfa") !== "false" };
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
    await new Promise(resolve => server.close(resolve));
    database.close();
    rmSync(root, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.DOCUMENT_STORAGE_PATH;
    else process.env.DOCUMENT_STORAGE_PATH = previousStorage;
    if (previousKey === undefined) delete process.env.DOCUMENT_ENCRYPTION_KEY;
    else process.env.DOCUMENT_ENCRYPTION_KEY = previousKey;
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (user, mfa = true) => ({
    "x-test-user": user,
    "x-test-mfa": String(mfa),
    "content-type": "application/json"
  });
  const payload = {
    institutionName: "Example College Confidential",
    role: "College administrator",
    studentCount: "500–2,000",
    workflows: ["Student onboarding", "Document submission tracking"],
    notes: "Pilot discussion only"
  };

  const denied = await fetch(base + "/api/college-pilot/requests", {
    method: "POST", headers: headers("user-a", false), body: JSON.stringify(payload)
  });
  assert.equal(denied.status, 403);

  const invalid = await fetch(base + "/api/college-pilot/requests", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ ...payload, workflows: ["Unknown workflow"] })
  });
  assert.equal(invalid.status, 400);

  const createdResponse = await fetch(base + "/api/college-pilot/requests", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify(payload)
  });
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const created = await createdResponse.json();
  assert.equal(created.request.institutionName, payload.institutionName);
  assert.equal(created.request.status, "received");

  const stored = database.prepare("SELECT encrypted_data FROM college_pilot_requests WHERE id=?").get(created.request.id);
  assert.ok(stored);
  assert.equal(stored.encrypted_data.includes(payload.institutionName), false);
  assert.equal(stored.encrypted_data.includes(payload.notes), false);

  const ownerList = await fetch(base + "/api/college-pilot/requests", { headers: headers("user-a") });
  assert.equal(ownerList.status, 200);
  assert.equal((await ownerList.json()).requests.length, 1);

  const otherList = await fetch(base + "/api/college-pilot/requests", { headers: headers("user-b") });
  assert.equal(otherList.status, 200);
  assert.deepEqual((await otherList.json()).requests, []);

  const tooLong = await fetch(base + "/api/college-pilot/requests", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ ...payload, institutionName: "x".repeat(121) })
  });
  assert.equal(tooLong.status, 400);
});
