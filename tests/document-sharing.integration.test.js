import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerProductionFeatures } from "../server/production-features.js";
import { randomBytes } from "node:crypto";

test("document ownership isolation, share access, revocation, and expiry", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-integration-"));
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
    INSERT INTO users(id,email) VALUES ('user-a','a@example.test'),('user-b','b@example.test');
    INSERT INTO wallet_settings(user_id) VALUES ('user-a'),('user-b');
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
  const asUser = (id) => ({ "x-test-user": id });
  const form = new FormData();
  form.append("documents", new Blob([Buffer.from("%PDF-1.7\nSecureID test document\n%%EOF")], { type: "application/pdf" }), "sample.pdf");
  const upload = await fetch(base + "/api/documents", { method: "POST", headers: asUser("user-a"), body: form });
  assert.equal(upload.status, 201, await upload.clone().text());
  const uploaded = await upload.json();
  const documentId = uploaded.documents[0].id;

  // Verify encrypted storage can be decrypted for the owner and returns the exact original bytes.
  const ownerDownload = await fetch(base + `/api/documents/${documentId}`, { headers: asUser("user-a") });
  assert.equal(ownerDownload.status, 200, await ownerDownload.clone().text());
  assert.match(ownerDownload.headers.get("content-type") || "", /application\/pdf/);
  assert.deepEqual(
    Buffer.from(await ownerDownload.arrayBuffer()),
    Buffer.from("%PDF-1.7\nSecureID test document\n%%EOF")
  );

  const proofUpload = async (label) => {
    const proofForm = new FormData();
    proofForm.append("category", "student_id");
    proofForm.append("document", new Blob([Buffer.from(`%PDF-1.7\nSecureID proof ${label}\n%%EOF`)], { type: "application/pdf" }), `${label}.pdf`);
    return fetch(base + "/api/identity/proof", { method: "POST", headers: asUser("user-a"), body: proofForm });
  };
  const firstProofResponse = await proofUpload("first");
  assert.equal(firstProofResponse.status, 201, await firstProofResponse.clone().text());
  const firstProof = (await firstProofResponse.json()).document;
  const firstPath = database.prepare("SELECT encrypted_path FROM secure_documents WHERE id=?").get(firstProof.id).encrypted_path;
  const secondProofResponse = await proofUpload("replacement");
  assert.equal(secondProofResponse.status, 201, await secondProofResponse.clone().text());
  const secondProof = (await secondProofResponse.json()).document;
  assert.equal(database.prepare("SELECT deleted_at FROM secure_documents WHERE id=?").get(firstProof.id).deleted_at > 0, true);
  assert.equal(existsSync(firstPath), false);
  const secondPath = database.prepare("SELECT encrypted_path FROM secure_documents WHERE id=?").get(secondProof.id).encrypted_path;

  database.exec("CREATE TRIGGER fail_student_proof_insert BEFORE INSERT ON secure_documents WHEN NEW.document_category='student_id' BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END");
  const failedReplacement = await proofUpload("failure");
  assert.equal(failedReplacement.status, 500, await failedReplacement.clone().text());
  assert.equal(database.prepare("SELECT deleted_at FROM secure_documents WHERE id=?").get(secondProof.id).deleted_at, null);
  assert.equal(existsSync(secondPath), true);
  assert.equal(readdirSync(process.env.DOCUMENT_STORAGE_PATH).filter((name) => name.endsWith(".json")).length, 2);
  database.exec("DROP TRIGGER fail_student_proof_insert");

  // Vault listing and upload must require both an authenticated session and MFA.
  const unauthenticatedVaultList = await fetch(base + "/api/documents");
  assert.equal(unauthenticatedVaultList.status, 401);

  const mfaPendingVaultList = await fetch(base + "/api/documents", {
    headers: { ...asUser("user-a"), "x-test-mfa": "false" }
  });
  assert.equal(mfaPendingVaultList.status, 403);

  const mfaPendingUploadForm = new FormData();
  mfaPendingUploadForm.append("documents", new Blob([Buffer.from("%PDF-1.7\\nMFA test\\n%%EOF")], { type: "application/pdf" }), "mfa-test.pdf");
  const mfaPendingUpload = await fetch(base + "/api/documents", {
    method: "POST",
    headers: { ...asUser("user-a"), "x-test-mfa": "false" },
    body: mfaPendingUploadForm
  });
  assert.equal(mfaPendingUpload.status, 403);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM secure_documents WHERE user_id='user-a' AND original_name='mfa-test.pdf'").get().count, 0);

  // A file whose bytes do not match its declared PDF MIME type must be rejected.
  const spoofedForm = new FormData();
  spoofedForm.append("documents", new Blob([Buffer.from("this is not a PDF")], { type: "application/pdf" }), "spoofed.pdf");
  const spoofedUpload = await fetch(base + "/api/documents", {
    method: "POST",
    headers: asUser("user-a"),
    body: spoofedForm
  });
  assert.equal(spoofedUpload.status, 400, await spoofedUpload.clone().text());
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM secure_documents WHERE user_id='user-a' AND original_name='spoofed.pdf'").get().count, 0);

  const ownerList = await fetch(base + "/api/documents", { headers: asUser("user-a") });
  assert.equal(ownerList.status, 200);
  assert.equal((await ownerList.json()).documents.length, 2);
  const otherList = await fetch(base + "/api/documents", { headers: asUser("user-b") });
  assert.equal(otherList.status, 200);
  assert.equal((await otherList.json()).documents.length, 0);
  const crossAccountDownload = await fetch(base + `/api/documents/${documentId}`, { headers: asUser("user-b") });
  assert.equal(crossAccountDownload.status, 404);

  const createShare = async () => fetch(base + "/api/document-share", {
    method: "POST",
    headers: { ...asUser("user-a"), "content-type": "application/json" },
    body: JSON.stringify({ documentId, share_reason: "integration test" })
  });
  const created = await createShare();
  assert.equal(created.status, 200, await created.clone().text());
  const share = await created.json();
  const accessible = await fetch(base + `/api/document-share/${share.shareToken}`);
  assert.equal(accessible.status, 200);
  assert.match(accessible.headers.get("content-type") || "", /application\/pdf/);
  assert.deepEqual(
    Buffer.from(await accessible.arrayBuffer()),
    Buffer.from("%PDF-1.7\nSecureID test document\n%%EOF")
  );

  // A different account cannot revoke a document share owned by user-a.
  const documentShareRow = database.prepare("SELECT id FROM secure_document_shares WHERE token_hash=?").get(
    (await import("node:crypto")).createHash("sha256").update(share.shareToken).digest("hex")
  );
  assert.ok(documentShareRow?.id);
  const crossAccountDocumentRevoke = await fetch(base + "/api/security/shares/revoke", {
    method: "POST",
    headers: { ...asUser("user-b"), "content-type": "application/json" },
    body: JSON.stringify({ type: "document", id: String(documentShareRow.id) })
  });
  assert.equal(crossAccountDocumentRevoke.status, 404, await crossAccountDocumentRevoke.clone().text());
  const stillAccessibleAfterCrossAccountAttempt = await fetch(base + `/api/document-share/${share.shareToken}`);
  assert.equal(stillAccessibleAfterCrossAccountAttempt.status, 200, "failed cross-account revoke must leave owner's document share valid");

  const revoked = await fetch(base + "/api/document-share/revoke", {
    method: "POST",
    headers: { ...asUser("user-a"), "content-type": "application/json" },
    body: JSON.stringify({ shareToken: share.shareToken })
  });
  assert.equal(revoked.status, 200, await revoked.clone().text());
  const afterRevoke = await fetch(base + `/api/document-share/${share.shareToken}`);
  assert.equal(afterRevoke.status, 404);

  const expiring = await createShare();
  assert.equal(expiring.status, 200, await expiring.clone().text());
  const expiringShare = await expiring.json();
  const tokenHash = (await import("node:crypto")).createHash("sha256").update(expiringShare.shareToken).digest("hex");
  database.prepare("UPDATE secure_document_shares SET expires_at=? WHERE token_hash=?").run(new Date(Date.now() - 1000).toISOString(), tokenHash);
  const afterExpiry = await fetch(base + `/api/document-share/${expiringShare.shareToken}`);
  assert.equal(afterExpiry.status, 404);

  const profileUpdate = await fetch(base + "/api/identity/profile", {
    method: "PUT",
    headers: { ...asUser("user-a"), "content-type": "application/json" },
    body: JSON.stringify({ name: "Test User", age: "20", college: "Example College" })
  });
  assert.equal(profileUpdate.status, 200, await profileUpdate.clone().text());

  const createIdentityShare = async () => fetch(base + "/api/wallet/share", {
    method: "POST",
    headers: { ...asUser("user-a"), "content-type": "application/json" },
    body: JSON.stringify({ name: true, age: true, email: true })
  });
  const identityShareResponse = await createIdentityShare();
  assert.equal(identityShareResponse.status, 200, await identityShareResponse.clone().text());
  const identityShare = await identityShareResponse.json();

  // Share Management must enforce login + MFA and return only the current account's shares.
  const unauthenticatedShareList = await fetch(base + "/api/security/shares");
  assert.equal(unauthenticatedShareList.status, 401);

  const mfaPendingShareList = await fetch(base + "/api/security/shares", {
    headers: { ...asUser("user-a"), "x-test-mfa": "false" }
  });
  assert.equal(mfaPendingShareList.status, 403);

  const ownerShareListResponse = await fetch(base + "/api/security/shares", { headers: asUser("user-a") });
  assert.equal(ownerShareListResponse.status, 200, await ownerShareListResponse.clone().text());
  const ownerShareList = await ownerShareListResponse.json();
  assert.equal(ownerShareList.success, true);
  assert.ok(ownerShareList.shares.some((item) => item.type === "identity" && item.id));
  assert.ok(ownerShareList.shares.some((item) => item.type === "document" && item.name === "sample.pdf"));
  assert.ok(ownerShareList.shares.every((item) => ["identity", "document"].includes(item.type)));
  assert.ok(ownerShareList.shares.every((item) => item.expiresAt), "each share should expose its expiry");
  assert.ok(ownerShareList.shares.some((item) => item.type === "document" && item.revokedAt), "revoked shares should be visibly marked as revoked");

  const otherAccountShareListResponse = await fetch(base + "/api/security/shares", { headers: asUser("user-b") });
  assert.equal(otherAccountShareListResponse.status, 200, await otherAccountShareListResponse.clone().text());
  const otherAccountShareList = await otherAccountShareListResponse.json();
  assert.deepEqual(otherAccountShareList.shares, [], "one account must never see another account's shares");

  // A different authenticated account must not be able to revoke the owner's identity share.
  const identityShareRow = database.prepare("SELECT id FROM secure_shares WHERE token_hash=?").get(
    (await import("node:crypto")).createHash("sha256").update(identityShare.shareToken).digest("hex")
  );
  assert.ok(identityShareRow?.id);
  const crossAccountRevoke = await fetch(base + "/api/security/shares/revoke", {
    method: "POST",
    headers: { ...asUser("user-b"), "content-type": "application/json" },
    body: JSON.stringify({ type: "identity", id: String(identityShareRow.id) })
  });
  assert.equal(crossAccountRevoke.status, 404, await crossAccountRevoke.clone().text());

  // A request without an authenticated session must not revoke any share.
  const unauthenticatedRevoke = await fetch(base + "/api/security/shares/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "identity", id: String(identityShareRow.id) })
  });
  assert.equal(unauthenticatedRevoke.status, 401, await unauthenticatedRevoke.clone().text());

  const sharedIdentityResponse = await fetch(base + `/api/share/${identityShare.shareToken}`);
  assert.equal(sharedIdentityResponse.status, 200, "failed cross-account revoke must leave owner's share valid");
  const sharedIdentity = await sharedIdentityResponse.json();
  assert.deepEqual(Object.keys(sharedIdentity.claims).sort(), ["age", "name"]);
  assert.equal(sharedIdentity.claims.name, "Test User");
  assert.equal(sharedIdentity.claims.age, "20");
  assert.equal(sharedIdentity.claims.email, undefined);
  assert.equal(sharedIdentity.claims.college, undefined);

  const revokeIdentity = await fetch(base + "/api/wallet/share/revoke", {
    method: "POST",
    headers: asUser("user-a")
  });
  assert.equal(revokeIdentity.status, 200, await revokeIdentity.clone().text());
  assert.equal((await fetch(base + `/api/share/${identityShare.shareToken}`)).status, 404);

  const expiringIdentityResponse = await createIdentityShare();
  assert.equal(expiringIdentityResponse.status, 200, await expiringIdentityResponse.clone().text());
  const expiringIdentity = await expiringIdentityResponse.json();
  const identityTokenHash = (await import("node:crypto")).createHash("sha256").update(expiringIdentity.shareToken).digest("hex");
  database.prepare("UPDATE secure_shares SET expires_at=? WHERE token_hash=?").run(new Date(Date.now() - 1000).toISOString(), identityTokenHash);
  assert.equal((await fetch(base + `/api/share/${expiringIdentity.shareToken}`)).status, 404);
});
