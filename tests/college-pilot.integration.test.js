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
    INSERT INTO users(id,email) VALUES ('user-a','a@example.test'),('user-b','b@example.test'),('user-c','c@example.test'),('user-d','d@example.test');
    INSERT INTO wallet_settings(user_id) VALUES ('user-a'),('user-b'),('user-c'),('user-d');
    CREATE TABLE secure_documents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, encrypted_path TEXT NOT NULL, document_category TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL, deleted_at INTEGER
    );
  `);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ success: false });
    req.user = { id, role: req.get("x-test-role") || "user", mfaVerified: req.get("x-test-mfa") !== "false" };
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

  // Provision a test institution membership as a trusted operator would.
  // There is deliberately no public API for users to grant themselves roles.
  database.prepare("INSERT INTO institutions (id, name, created_at) VALUES (?, ?, ?)").run("college-a", "Example College", new Date().toISOString());
  database.prepare("INSERT INTO institution_memberships (id, institution_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "membership-a", "college-a", "user-a", "reviewer", "active", new Date().toISOString(), new Date().toISOString()
  );
  database.prepare("INSERT INTO institution_memberships (id, institution_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "membership-c", "college-a", "user-c", "student", "active", new Date().toISOString(), new Date().toISOString()
  );
  database.prepare("INSERT INTO institution_memberships (id, institution_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "membership-readonly", "college-a", "user-b", "read_only", "active", new Date().toISOString(), new Date().toISOString()
  );
  database.prepare("INSERT INTO secure_documents (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)")
    .run("doc-c", "user-c", "student-card.pdf", "application/pdf", 2048, "encrypted/test-path", "student_id", Date.now());
  database.prepare("INSERT INTO secure_documents (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)")
    .run("doc-c2", "user-c", "old-student-card.pdf", "application/pdf", 1024, "encrypted/test-path-2", "student_id", Date.now());

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
  const headers = (user, mfa = true, role = "user") => ({
    "x-test-user": user,
    "x-test-mfa": String(mfa),
    "x-test-role": role,
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

  const membershipResponse = await fetch(base + "/api/institutions/memberships", { headers: headers("user-a") });
  assert.equal(membershipResponse.status, 200);
  const memberships = await membershipResponse.json();
  assert.equal(memberships.memberships.length, 1);
  assert.equal(memberships.memberships[0].institutionId, "college-a");
  assert.equal(memberships.memberships[0].role, "reviewer");

  const otherMembershipResponse = await fetch(base + "/api/institutions/memberships", { headers: headers("user-b") });
  assert.equal(otherMembershipResponse.status, 200);
  assert.deepEqual((await otherMembershipResponse.json()).memberships, []);

  const noMfaMembershipResponse = await fetch(base + "/api/institutions/memberships", { headers: headers("user-a", false) });
  assert.equal(noMfaMembershipResponse.status, 403);

  const noSelfGrantRoute = await fetch(base + "/api/institutions/memberships", {
    method: "POST", headers: headers("user-b"), body: JSON.stringify({ institutionId: "college-a", role: "institution_admin" })
  });
  assert.equal(noSelfGrantRoute.status, 404);

  const nonOwnerProvision = await fetch(base + "/api/admin/institutions", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ name: "Unauthorized College" })
  });
  assert.equal(nonOwnerProvision.status, 403);

  const ownerWithoutMfa = await fetch(base + "/api/admin/institutions", {
    method: "POST", headers: headers("user-a", false, "owner"), body: JSON.stringify({ name: "MFA Missing College" })
  });
  assert.equal(ownerWithoutMfa.status, 403);

  const createdInstitutionResponse = await fetch(base + "/api/admin/institutions", {
    method: "POST", headers: headers("user-a", true, "owner"), body: JSON.stringify({ name: "Second Example College" })
  });
  assert.equal(createdInstitutionResponse.status, 201);
  const createdInstitution = (await createdInstitutionResponse.json()).institution;

  const provisionedMembershipResponse = await fetch(base + `/api/admin/institutions/${createdInstitution.id}/memberships`, {
    method: "POST", headers: headers("user-a", true, "owner"), body: JSON.stringify({ userId: "user-d", role: "reviewer" })
  });
  assert.equal(provisionedMembershipResponse.status, 201);
  const provisionedMembership = (await provisionedMembershipResponse.json()).membership;

  const adminDirectory = await fetch(base + "/api/admin/institutions", { headers: headers("user-a", true, "owner") });
  assert.equal(adminDirectory.status, 200);
  assert.ok((await adminDirectory.json()).institutions.some(item => item.id === createdInstitution.id));

  const suspendMembership = await fetch(base + `/api/admin/institutions/${createdInstitution.id}/memberships/${provisionedMembership.id}`, {
    method: "PATCH", headers: headers("user-a", true, "owner"), body: JSON.stringify({ status: "suspended" })
  });
  assert.equal(suspendMembership.status, 200);
  assert.equal((await suspendMembership.json()).membership.status, "suspended");

  const suspendedReviewerQueue = await fetch(base + "/api/institutions/review-queue", { headers: headers("user-d") });
  assert.equal(suspendedReviewerQueue.status, 403, "a suspended-only reviewer must lose queue access immediately");

  const membershipAudit = await fetch(base + `/api/admin/institutions/${createdInstitution.id}/audit`, { headers: headers("user-a", true, "owner") });
  assert.equal(membershipAudit.status, 200);
  assert.deepEqual((await membershipAudit.json()).audit.map(item => item.action).sort(), ["membership_provisioned", "membership_updated"].sort());

  const missingConsent = await fetch(base + "/api/institutions/review-submissions", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ institutionId: "college-a", documentId: "doc-c", purpose: "College enrollment", consent: false })
  });
  assert.equal(missingConsent.status, 400);

  const studentSubmission = await fetch(base + "/api/institutions/review-submissions", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ institutionId: "college-a", documentId: "doc-c", purpose: "College enrollment review", consent: true })
  });
  assert.equal(studentSubmission.status, 201, await studentSubmission.clone().text());
  const submission = (await studentSubmission.json()).submission;
  assert.equal(submission.status, "submitted");
  assert.equal(submission.documentName, "student-card.pdf");

  const secondSubmissionResponse = await fetch(base + "/api/institutions/review-submissions", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ institutionId: "college-a", documentId: "doc-c2", purpose: "Student identity record", consent: true })
  });
  assert.equal(secondSubmissionResponse.status, 201);
  const secondSubmission = (await secondSubmissionResponse.json()).submission;
  const deletedDocument = await fetch(base + "/api/documents/doc-c2", { method: "DELETE", headers: headers("user-c") });
  assert.equal(deletedDocument.status, 200);
  const afterDelete = await fetch(base + "/api/institutions/my-review-submissions", { headers: headers("user-c") });
  const afterDeleteData = await afterDelete.json();
  assert.equal(afterDeleteData.submissions.find(item => item.id === secondSubmission.id).status, "withdrawn");

  const reviewerQueue = await fetch(base + "/api/institutions/review-queue", { headers: headers("user-a") });
  assert.equal(reviewerQueue.status, 200);
  const queue = await reviewerQueue.json();
  assert.equal(queue.submissions.length, 1);
  assert.equal(queue.submissions[0].id, submission.id);
  assert.equal("encrypted_path" in queue.submissions[0], false);

  const noMfaQueue = await fetch(base + "/api/institutions/review-queue", { headers: headers("user-a", false) });
  assert.equal(noMfaQueue.status, 403);

  const readOnlyQueue = await fetch(base + "/api/institutions/review-queue", { headers: headers("user-b") });
  assert.equal(readOnlyQueue.status, 200);
  assert.equal((await readOnlyQueue.json()).submissions.length, 1);
  const readOnlyDecision = await fetch(base + `/api/institutions/review-submissions/${submission.id}`, {
    method: "PATCH", headers: headers("user-b"),
    body: JSON.stringify({ status: "rejected", reviewNote: "read-only must not change status" })
  });
  assert.equal(readOnlyDecision.status, 403);

  const unrelatedQueue = await fetch(base + "/api/institutions/review-queue", { headers: headers("user-d") });
  assert.equal(unrelatedQueue.status, 403);

  const reviewerDecision = await fetch(base + `/api/institutions/review-submissions/${submission.id}`, {
    method: "PATCH", headers: headers("user-a"),
    body: JSON.stringify({ status: "approved", reviewNote: "Enrollment document reviewed by the institution." })
  });
  assert.equal(reviewerDecision.status, 200);
  assert.equal((await reviewerDecision.json()).submission.status, "approved");

  const studentHistory = await fetch(base + "/api/institutions/my-review-submissions", { headers: headers("user-c") });
  assert.equal(studentHistory.status, 200);
  const studentRecords = await studentHistory.json();
  const reviewedRecord = studentRecords.submissions.find(item => item.id === submission.id);
  assert.equal(reviewedRecord.status, "approved");
  assert.equal(reviewedRecord.reviewNote, "Enrollment document reviewed by the institution.");

  const auditHistory = await fetch(base + `/api/institutions/review-submissions/${submission.id}/audit`, { headers: headers("user-c") });
  assert.equal(auditHistory.status, 200);
  assert.deepEqual((await auditHistory.json()).audit.map(item => item.action).sort(), ["student_submitted", "review_queue_viewed", "review_status_changed"].sort());

  const readOnlyAudit = await fetch(base + `/api/institutions/review-submissions/${submission.id}/audit`, { headers: headers("user-b") });
  assert.equal(readOnlyAudit.status, 200);
  const unrelatedAudit = await fetch(base + `/api/institutions/review-submissions/${submission.id}/audit`, { headers: headers("user-d") });
  assert.equal(unrelatedAudit.status, 403);

  const studentCannotReview = await fetch(base + `/api/institutions/review-submissions/${submission.id}`, {
    method: "PATCH", headers: headers("user-c"),
    body: JSON.stringify({ status: "rejected", reviewNote: "self-review attempt" })
  });
  assert.equal(studentCannotReview.status, 403);

  const tooLong = await fetch(base + "/api/college-pilot/requests", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ ...payload, institutionName: "x".repeat(121) })
  });
  assert.equal(tooLong.status, 400);
});
