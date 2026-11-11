import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createCipheriv } from "node:crypto";
import { writeFileSync } from "node:fs";
import { registerProductionFeatures } from "../server/production-features.js";

test("college pilot requests require MFA, are encrypted at rest, validated, and account-scoped", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "secureid-college-pilot-"));
  const previousStorage = process.env.DOCUMENT_STORAGE_PATH;
  const previousKey = process.env.DOCUMENT_ENCRYPTION_KEY;
  process.env.DOCUMENT_STORAGE_PATH = path.join(root, "documents");
  const encryptionKey = randomBytes(32);
  process.env.DOCUMENT_ENCRYPTION_KEY = encryptionKey.toString("base64");

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
    INSERT INTO users(id,email) VALUES ('user-a','a@example.test'),('user-b','b@example.test'),('user-c','c@example.test'),('user-d','d@example.test'),('user-e','e@example.test');
    INSERT INTO wallet_settings(user_id) VALUES ('user-a'),('user-b'),('user-c'),('user-d'),('user-e');
    CREATE TABLE secure_documents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, encrypted_path TEXT NOT NULL, document_category TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL, deleted_at INTEGER
    );
    -- Simulate a database created before consent-version tracking was added.
    CREATE TABLE institution_review_submissions (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL, student_user_id TEXT NOT NULL,
      document_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted',
      encrypted_review_note TEXT, consented_at TEXT NOT NULL, reviewed_by TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  const scholarshipPdf = Buffer.from("%PDF-1.4\\n1 0 obj<</Type/Catalog>>endobj\\n%%EOF", "utf8");
  const scholarshipIv = randomBytes(12);
  const scholarshipCipher = createCipheriv("aes-256-gcm", encryptionKey, scholarshipIv);
  const scholarshipEncrypted = Buffer.concat([scholarshipCipher.update(scholarshipPdf), scholarshipCipher.final()]);
  const scholarshipPayload = { iv: scholarshipIv.toString("base64"), tag: scholarshipCipher.getAuthTag().toString("base64"), data: scholarshipEncrypted.toString("base64") };
  const scholarshipDocumentPath = path.join(root, "documents", "scholarship-doc.json");
  writeFileSync(scholarshipDocumentPath, JSON.stringify(scholarshipPayload));
  database.prepare("UPDATE secure_documents SET size_bytes=?,encrypted_path=? WHERE id='doc-c'").run(scholarshipPdf.length, scholarshipDocumentPath);

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
  const otherMemberships = await otherMembershipResponse.json();
  assert.equal(otherMemberships.memberships.length, 1);
  assert.equal(otherMemberships.memberships[0].role, "read_only");
  assert.equal(otherMemberships.memberships[0].institutionId, "college-a");

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

  const suspendedReviewerQueue = await fetch(base + "/api/institutions/review-queue", { headers: headers("unrelated-user") });
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
  assert.equal(submission.consentVersion, "college-review-v1");
  const consentEvidence = database.prepare("SELECT consented_at, consent_version FROM institution_review_submissions WHERE id=?").get(submission.id);
  assert.ok(consentEvidence.consented_at);
  assert.equal(consentEvidence.consent_version, "college-review-v1");

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
  assert.deepEqual((await auditHistory.json()).audit.map(item => item.action).sort(), ["student_submitted", "review_queue_viewed", "review_queue_viewed", "review_status_changed"].sort());

  const readOnlyAudit = await fetch(base + `/api/institutions/review-submissions/${submission.id}/audit`, { headers: headers("user-b") });
  assert.equal(readOnlyAudit.status, 200);
  const unrelatedAudit = await fetch(base + `/api/institutions/review-submissions/${submission.id}/audit`, { headers: headers("user-d") });
  assert.equal(unrelatedAudit.status, 403);

  const studentCannotReview = await fetch(base + `/api/institutions/review-submissions/${submission.id}`, {
    method: "PATCH", headers: headers("user-c"),
    body: JSON.stringify({ status: "rejected", reviewNote: "self-review attempt" })
  });
  assert.equal(studentCannotReview.status, 403);


  // Hostel inventory: only institution admins manage rooms; reviewers may allot beds.
  const hostelApplicationResponse = await fetch(base + "/api/institutions/hostel-applications", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ institutionId: "college-a", academicYear: "2026-2027", stayType: "new_admission", roomPreference: "shared", consent: true })
  });
  assert.equal(hostelApplicationResponse.status, 201, await hostelApplicationResponse.clone().text());
  const hostelApplication = (await hostelApplicationResponse.json()).application;
  const createBuildingDenied = await fetch(base + "/api/institutions/hostel-buildings", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ institutionId: "college-a", name: "North Hostel" })
  });
  assert.equal(createBuildingDenied.status, 403);
  const buildingResponse = await fetch(base + "/api/institutions/hostel-buildings", {
    method: "POST", headers: headers("user-a", true, "owner"),
    body: JSON.stringify({ institutionId: "college-a", name: "North Hostel" })
  });
  assert.equal(buildingResponse.status, 403, "global owner role must not bypass institution-admin membership for inventory writes");
  // Provision institution-admin membership as a trusted operator.
  database.prepare("INSERT INTO institution_memberships(id,institution_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("membership-admin", "college-a", "user-d", "institution_admin", "active", new Date().toISOString(), new Date().toISOString());
  const adminBuildingResponse = await fetch(base + "/api/institutions/hostel-buildings", {
    method: "POST", headers: headers("user-d"),
    body: JSON.stringify({ institutionId: "college-a", name: "North Hostel" })
  });
  assert.equal(adminBuildingResponse.status, 201, await adminBuildingResponse.clone().text());
  const building = (await adminBuildingResponse.json()).building;
  const roomResponse = await fetch(base + "/api/institutions/hostel-rooms", {
    method: "POST", headers: headers("user-d"),
    body: JSON.stringify({ institutionId: "college-a", buildingId: building.id, roomNumber: "101", roomType: "shared", capacity: 1 })
  });
  assert.equal(roomResponse.status, 201, await roomResponse.clone().text());
  const room = (await roomResponse.json()).room;
  const reviewerOccupancyDenied = await fetch(base + `/api/institutions/hostel-rooms/${room.id}/occupancy`, {
    method: "PATCH", headers: headers("user-a"),
    body: JSON.stringify({ manualOccupiedBeds: 1, academicYear: "2026-2027" })
  });
  assert.equal(reviewerOccupancyDenied.status, 403, "reviewers cannot change warden-managed occupancy");
  const approveHostel = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}`, {
    method: "PATCH", headers: headers("user-a"),
    body: JSON.stringify({ status: "approved", reviewNote: "Hostel admission approved." })
  });
  assert.equal(approveHostel.status, 200);
  const allocationResponse = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}/allocation`, {
    method: "POST", headers: headers("user-a"),
    body: JSON.stringify({ roomId: room.id })
  });
  assert.equal(allocationResponse.status, 201, await allocationResponse.clone().text());
  const allocation = (await allocationResponse.json()).allocation;
  assert.equal(allocation.bedLabel, "1");
  const fullInventory = await fetch(base + "/api/institutions/hostel-inventory?institutionId=college-a&academicYear=2026-2027", { headers: headers("user-c") });
  assert.equal(fullInventory.status, 200);
  assert.equal((await fullInventory.json()).rooms[0].availableBeds, 0);
  const overCapacityManualOccupancy = await fetch(base + `/api/institutions/hostel-rooms/${room.id}/occupancy`, {
    method: "PATCH", headers: headers("user-d"),
    body: JSON.stringify({ manualOccupiedBeds: 1, academicYear: "2026-2027" })
  });
  assert.equal(overCapacityManualOccupancy.status, 409, "manual occupants plus active allocations cannot exceed capacity");

  const studentHostelHistory = await fetch(base + "/api/institutions/my-hostel-applications", { headers: headers("user-c") });
  const studentHostelItem = (await studentHostelHistory.json()).applications.find(item => item.id === hostelApplication.id);
  assert.equal(studentHostelItem.roomNumber, "101");
  assert.equal(studentHostelItem.bedLabel, "1");
  const readOnlyAllotment = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}/allocation`, {
    method: "POST", headers: headers("user-b"), body: JSON.stringify({ roomId: room.id })
  });
  assert.equal(readOnlyAllotment.status, 403);
  const releaseBed = await fetch(base + `/api/institutions/hostel-allocations/${allocation.id}`, { method: "DELETE", headers: headers("user-a") });
  assert.equal(releaseBed.status, 200);
  const availableAfterRelease = await fetch(base + "/api/institutions/hostel-inventory?institutionId=college-a&academicYear=2026-2027", { headers: headers("user-c") });
  assert.equal((await availableAfterRelease.json()).rooms[0].availableBeds, 1);
  const setExistingOccupants = await fetch(base + `/api/institutions/hostel-rooms/${room.id}/occupancy`, {
    method: "PATCH", headers: headers("user-d"),
    body: JSON.stringify({ manualOccupiedBeds: 1, academicYear: "2026-2027" })
  });
  assert.equal(setExistingOccupants.status, 200, await setExistingOccupants.clone().text());
  const inventoryWithExistingOccupant = await fetch(base + "/api/institutions/hostel-inventory?institutionId=college-a&academicYear=2026-2027", { headers: headers("user-c") });
  const roomWithExistingOccupant = (await inventoryWithExistingOccupant.json()).rooms[0];
  assert.equal(roomWithExistingOccupant.occupiedBeds, 1);
  assert.equal(roomWithExistingOccupant.manualOccupiedBeds, 1);
  assert.equal(roomWithExistingOccupant.availableBeds, 0);



  // Hostel operations: check-in/out lifecycle, institution-admin fee creation,
  // reviewer payment receipt recording, student fee visibility and reporting.
  const allocationBlockedByManualOccupancy = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}/allocation`, {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ roomId: room.id })
  });
  assert.equal(allocationBlockedByManualOccupancy.status, 409, "warden-entered occupied beds must reduce allotment capacity");
  const clearManualOccupancy = await fetch(base + `/api/institutions/hostel-rooms/${room.id}/occupancy`, {
    method: "PATCH", headers: headers("user-d"),
    body: JSON.stringify({ manualOccupiedBeds: 0, academicYear: "2026-2027" })
  });
  assert.equal(clearManualOccupancy.status, 200);
  const secondAllocationResponse = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}/allocation`, {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ roomId: room.id })
  });
  assert.equal(secondAllocationResponse.status, 201);
  const secondAllocation = (await secondAllocationResponse.json()).allocation;
  const checkoutBeforeCheckin = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}/check-out`, { method: "POST", headers: headers("user-a") });
  assert.equal(checkoutBeforeCheckin.status, 409);
  const checkin = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}/check-in`, { method: "POST", headers: headers("user-a") });
  assert.equal(checkin.status, 200);
  const duplicateCheckin = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}/check-in`, { method: "POST", headers: headers("user-a") });
  assert.equal(duplicateCheckin.status, 409);
  const releaseWhileCheckedIn = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}`, { method: "DELETE", headers: headers("user-a") });
  assert.equal(releaseWhileCheckedIn.status, 409);
  const checkout = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}/check-out`, { method: "POST", headers: headers("user-a") });
  assert.equal(checkout.status, 200);
  const reviewerCannotCreateFee = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}/fees`, {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ description: "Hostel fee", amount: 1500 })
  });
  assert.equal(reviewerCannotCreateFee.status, 403);
  const feeResponse = await fetch(base + `/api/institutions/hostel-applications/${hostelApplication.id}/fees`, {
    method: "POST", headers: headers("user-d"), body: JSON.stringify({ description: "Hostel accommodation", amount: 1500.5, dueDate: "2026-12-01" })
  });
  assert.equal(feeResponse.status, 201, await feeResponse.clone().text());
  const fee = (await feeResponse.json()).fee;
  assert.equal(fee.amountPaise, 150050);

  const studentFees = await fetch(base + "/api/institutions/my-hostel-fees", { headers: headers("user-c") });
  assert.equal(studentFees.status, 200);
  assert.equal((await studentFees.json()).fees[0].amountPaise, 150050);

  const partialPayment = await fetch(base + `/api/institutions/hostel-fees/${fee.id}/payments`, {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ amount: 500, paymentMethod: "upi", reference: "UPI-TEST-001" })
  });
  assert.equal(partialPayment.status, 201);
  assert.equal((await partialPayment.json()).status, "partial");
  const excessPayment = await fetch(base + `/api/institutions/hostel-fees/${fee.id}/payments`, {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ amount: 1001, paymentMethod: "cash" })
  });
  assert.equal(excessPayment.status, 409);
  const finalPayment = await fetch(base + `/api/institutions/hostel-fees/${fee.id}/payments`, {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ amount: 1000.5, paymentMethod: "bank_transfer", reference: "BANK-TEST-002" })
  });
  assert.equal(finalPayment.status, 201);
  assert.equal((await finalPayment.json()).status, "paid");

  const releaseAfterCheckout = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}`, { method: "DELETE", headers: headers("user-a") });
  assert.equal(releaseAfterCheckout.status, 200);
  const studentHistoryAfterRelease = await fetch(base + "/api/institutions/my-hostel-applications", { headers: headers("user-c") });
  const releasedStudentRecord = (await studentHistoryAfterRelease.json()).applications.find(item => item.id === hostelApplication.id);
  assert.equal(releasedStudentRecord.allocationId, secondAllocation.id);
  assert.equal(releasedStudentRecord.allocationStatus, "released");
  assert.ok(releasedStudentRecord.checkedInAt);
  assert.ok(releasedStudentRecord.checkedOutAt);
  assert.ok(releasedStudentRecord.releasedAt);

  const hostelOperations = await fetch(base + "/api/institutions/hostel-operations?institutionId=college-a", { headers: headers("user-a") });
  assert.equal(hostelOperations.status, 200);
  const operationsData = await hostelOperations.json();
  assert.equal(operationsData.fees.find(item => item.id === fee.id).status, "paid");
  const releasedAllocationRecord = operationsData.allocations.find(item => item.allocationId === secondAllocation.id);
  assert.ok(releasedAllocationRecord, "released allocations remain available in institutional history");
  assert.equal(releasedAllocationRecord.allocationStatus, "released");
  assert.equal(releasedAllocationRecord.checkedOutAt !== null, true);
  assert.ok(releasedAllocationRecord.updatedAt);
  assert.equal(operationsData.summary.currentlyCheckedIn, 0);
  assert.equal(operationsData.summary.allocatedBeds, 0);
  const readOnlyOperations = await fetch(base + "/api/institutions/hostel-operations?institutionId=college-a", { headers: headers("user-b") });
  assert.equal(readOnlyOperations.status, 200);
  const readOnlyCheckin = await fetch(base + `/api/institutions/hostel-allocations/${secondAllocation.id}/check-in`, { method: "POST", headers: headers("user-b") });
  assert.equal(readOnlyCheckin.status, 403, "read-only members are denied before allocation lifecycle details are disclosed");
  const unrelatedOperations = await fetch(base + "/api/institutions/hostel-operations?institutionId=unknown-college", { headers: headers("user-a") });
  assert.equal(unrelatedOperations.status, 403);

  // Scholarship programs: institution-admin publishing, student consent and reviewer decisions.
  const scholarshipDeadline = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
  const reviewerCannotPublishScholarship = await fetch(base + "/api/institutions/scholarship-programs", {
    method: "POST", headers: headers("user-a"),
    body: JSON.stringify({ institutionId: "college-a", title: "Merit Scholarship", description: "Annual support for eligible enrolled students.", eligibility: "Students must meet the college merit and attendance criteria.", awardAmount: 12000, deadline: scholarshipDeadline })
  });
  assert.equal(reviewerCannotPublishScholarship.status, 403);
  const createScholarship = await fetch(base + "/api/institutions/scholarship-programs", {
    method: "POST", headers: headers("user-d"),
    body: JSON.stringify({ institutionId: "college-a", title: "Merit Scholarship", description: "Annual support for eligible enrolled students.", eligibility: "Students must meet the college merit and attendance criteria.", awardAmount: 12000, deadline: scholarshipDeadline })
  });
  assert.equal(createScholarship.status, 201, await createScholarship.clone().text());
  const scholarship = (await createScholarship.json()).program;
  assert.equal(scholarship.awardAmountPaise, 1200000);
  assert.equal(scholarship.status, "active");
  const scholarshipNoConsent = await fetch(base + "/api/institutions/scholarship-programs/" + scholarship.id + "/applications", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ academicYear: "2026-2027", studentNote: "Merit applicant.", documentIds: ["doc-c"], consent: false })
  });
  assert.equal(scholarshipNoConsent.status, 400);
  const scholarshipApply = await fetch(base + "/api/institutions/scholarship-programs/" + scholarship.id + "/applications", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ academicYear: "2026-2027", studentNote: "Merit applicant.", documentIds: ["doc-c"], consent: true })
  });
  assert.equal(scholarshipApply.status, 201, await scholarshipApply.clone().text());
  const scholarshipApplication = (await scholarshipApply.json()).application;
  assert.equal(scholarshipApplication.status, "submitted");
  assert.equal(scholarshipApplication.documentCount, 1);
  const duplicateScholarshipApply = await fetch(base + "/api/institutions/scholarship-programs/" + scholarship.id + "/applications", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ academicYear: "2026-2027", studentNote: "Duplicate attempt.", documentIds: [], consent: true })
  });
  assert.equal(duplicateScholarshipApply.status, 409);
  const studentScholarshipWorkspace = await fetch(base + "/api/institutions/scholarship-workspace?institutionId=college-a", { headers: headers("user-c") });
  assert.equal(studentScholarshipWorkspace.status, 200);
  const studentScholarshipData = await studentScholarshipWorkspace.json();
  assert.equal(studentScholarshipData.programs[0].id, scholarship.id);
  assert.equal(studentScholarshipData.applications[0].id, scholarshipApplication.id);
  assert.equal(studentScholarshipData.applications[0].studentNote, "Merit applicant.");
  assert.deepEqual(studentScholarshipData.applications[0].documentIds, ["doc-c"]);
  const scholarshipPreview = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id + "/documents/doc-c/preview", { headers: headers("user-a") });
  assert.equal(scholarshipPreview.status, 200, await scholarshipPreview.clone().text());
  assert.match(scholarshipPreview.headers.get("content-type") || "", /application.*pdf/);
  assert.match(scholarshipPreview.headers.get("content-disposition") || "", /^inline;/);
  assert.match(scholarshipPreview.headers.get("cache-control") || "", /no-store/);
  assert.equal(Buffer.from(await scholarshipPreview.arrayBuffer()).toString("utf8"), scholarshipPdf.toString("utf8"));
  database.prepare("UPDATE secure_documents SET size_bytes=size_bytes+1 WHERE id='doc-c'").run();
  const invalidIntegrityPreview = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id + "/documents/doc-c/preview", { headers: headers("user-a") });
  assert.equal(invalidIntegrityPreview.status, 422);
  database.prepare("UPDATE secure_documents SET size_bytes=? WHERE id='doc-c'").run(scholarshipPdf.length);
  const readonlyScholarshipPreview = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id + "/documents/doc-c/preview", { headers: headers("user-b") });
  assert.equal(readonlyScholarshipPreview.status, 403);
  const unrelatedScholarshipPreview = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id + "/documents/doc-c/preview", { headers: headers("user-e") });
  assert.equal(unrelatedScholarshipPreview.status, 403);
  const unselectedScholarshipPreview = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id + "/documents/doc-c2/preview", { headers: headers("user-a") });
  assert.equal(unselectedScholarshipPreview.status, 403);
  const previewAudit = database.prepare("SELECT outcome FROM scholarship_document_access_audit WHERE application_id=? ORDER BY created_at ASC").all(scholarshipApplication.id);
  assert.deepEqual(previewAudit.map(item => item.outcome), ["success", "error", "denied", "denied", "denied"]);

  const readonlyScholarshipDecision = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id, {
    method: "PATCH", headers: headers("user-b"),
    body: JSON.stringify({ status: "approved", reviewNote: "Read-only cannot approve." })
  });
  assert.equal(readonlyScholarshipDecision.status, 403);
  const scholarshipCorrection = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id, {
    method: "PATCH", headers: headers("user-a"),
    body: JSON.stringify({ status: "needs_correction", reviewNote: "Please provide an updated supporting note." })
  });
  assert.equal(scholarshipCorrection.status, 200);
  assert.equal((await scholarshipCorrection.json()).application.status, "needs_correction");
  const scholarshipResubmit = await fetch(base + "/api/institutions/scholarship-programs/" + scholarship.id + "/applications", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ academicYear: "2026-2027", studentNote: "Updated merit application details.", documentIds: ["doc-c"], consent: true })
  });
  assert.equal(scholarshipResubmit.status, 200, await scholarshipResubmit.clone().text());
  assert.equal((await scholarshipResubmit.json()).application.id, scholarshipApplication.id);
  const scholarshipDecision = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id, {
    method: "PATCH", headers: headers("user-a"),
    body: JSON.stringify({ status: "approved", reviewNote: "Updated eligibility reviewed by the institution." })
  });
  assert.equal(scholarshipDecision.status, 200);
  assert.equal((await scholarshipDecision.json()).application.status, "approved");
  const reviewerScholarshipWorkspace = await fetch(base + "/api/institutions/scholarship-workspace?institutionId=college-a", { headers: headers("user-a") });
  assert.equal(reviewerScholarshipWorkspace.status, 200);
  const reviewerScholarshipData = await reviewerScholarshipWorkspace.json();
  assert.equal(reviewerScholarshipData.applications[0].status, "approved");
  assert.equal(reviewerScholarshipData.applications[0].reviewNote, "Updated eligibility reviewed by the institution.");
  const scholarshipAudit = await fetch(base + "/api/institutions/scholarship-applications/" + scholarshipApplication.id + "/audit", { headers: headers("user-c") });
  assert.equal(scholarshipAudit.status, 200);
  assert.deepEqual((await scholarshipAudit.json()).audit.map(item => item.action), ["student_submitted", "review_status_changed", "student_resubmitted", "review_status_changed"]);
  const closeScholarship = await fetch(base + "/api/institutions/scholarship-programs/" + scholarship.id, {
    method: "PATCH", headers: headers("user-d"), body: JSON.stringify({ status: "closed" })
  });
  assert.equal(closeScholarship.status, 200);
  const closedScholarshipApply = await fetch(base + "/api/institutions/scholarship-programs/" + scholarship.id + "/applications", {
    method: "POST", headers: headers("user-c"),
    body: JSON.stringify({ academicYear: "2027-2028", studentNote: "", documentIds: [], consent: true })
  });
  assert.equal(closedScholarshipApply.status, 409);

  const tooLong = await fetch(base + "/api/college-pilot/requests", {
    method: "POST", headers: headers("user-a"), body: JSON.stringify({ ...payload, institutionName: "x".repeat(121) })
  });
  assert.equal(tooLong.status, 400);
});
// Regression: unrelated users must exist in the fixture so denial auditing satisfies user foreign keys.
