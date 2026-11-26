import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerSmartFill } from "../server/smartfill.js";

test("SmartFill enforces consent, stable keys, ambiguity, MFA and value-free audit", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE identity_profiles (
      user_id TEXT PRIMARY KEY,
      encrypted_data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE wallet_settings (
      user_id TEXT PRIMARY KEY,
      locked INTEGER DEFAULT 0
    );
    CREATE TABLE secure_documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      deleted_at INTEGER
    );
  `);
  db.prepare("INSERT INTO identity_profiles VALUES (?, ?, ?)").run(
    "u1",
    JSON.stringify({
      name: "Private Test",
      email: "test@example.test",
      identityId: "SID-12345",
      governmentId: "ABCD1234",
      studentId: "STU-2026-01",
    }),
    1,
  );

  db.prepare("INSERT INTO secure_documents VALUES(?,?,?,NULL)").run("doc-image-1", "u1", "image/jpeg");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: req.get("x-user") || "",
      mfaVerified: req.get("x-mfa") !== "false",
    };
    next();
  });
  const auth = (req, res, next) => req.user.id ? next() : res.sendStatus(401);
  registerSmartFill({
    app,
    database: db,
    requireAuth: auth,
    enforceSameOrigin: (_req, _res, next) => next(),
    encryptValue: (value) => value,
    decryptValue: (value) => value,
    assertWalletUnlocked: () => {},
  });
  app.post("/api/test-submit", auth, (_req, res) => res.json({ success: true }));
  app.post("/api/test-submit-fail", auth, (_req, res) => res.status(400).json({ success: false }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  const base = "http://127.0.0.1:" + server.address().port;
  const headers = { "x-user": "u1", "content-type": "application/json" };
  assert.equal(
    (await fetch(base + "/api/smartfill/suggestions?formId=admission", { headers })).status,
    403,
  );

  const grant = await fetch(base + "/api/smartfill/consent", {
    method: "POST",
    headers,
    body: JSON.stringify({
      formId: "admission",
      fields: ["personal.full_name", "identity.identity_id", "identity.government_id", "identity.student_id", "education.course"],
      sources: ["identity", "manual", "vault_ocr"],
      consent: true,
    }),
  });
  assert.equal(grant.status, 200);

  const initial = await (await fetch(base + "/api/smartfill/suggestions?formId=admission", { headers })).json();
  assert.deepEqual(
    initial.suggestions.map((item) => item.fieldKey),
    ["personal.full_name", "identity.identity_id", "identity.government_id", "identity.student_id"],
  );
  assert.equal(initial.suggestions[0].status, "unverified");

  const save = await fetch(base + "/api/smartfill/data", {
    method: "PUT",
    headers,
    body: JSON.stringify({ fields: { "personal.full_name": "Different Person" } }),
  });
  assert.equal(save.status, 200);
  const invalid = await fetch(base + "/api/smartfill/data", {
    method: "PUT",
    headers,
    body: JSON.stringify({ fields: { "contact.email": "not-an-email" } }),
  });
  assert.equal(invalid.status, 400);

  const prototypeInjection = await fetch(base + "/api/smartfill/data", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      fields: {
        "custom.__proto__": "polluted",
        "custom.constructor": "polluted",
        "custom.nested.prototype": "polluted",
      },
    }),
  });
  assert.equal(prototypeInjection.status, 400);
  assert.equal(Object.prototype.polluted, undefined);

  // Upgrade a legacy object-shaped record without losing its existing values.
  db.prepare("INSERT OR REPLACE INTO smartfill_private_data(user_id,encrypted_data,updated_at) VALUES(?,?,?)")
    .run("u1", JSON.stringify({ "personal.full_name": "Different Person", "custom.legacy_note": "Preserved legacy value" }), Date.now());
  const customSave = await fetch(base + "/api/smartfill/data", {
    method: "PUT",
    headers,
    body: JSON.stringify({ fields: { "custom.emergency_contact": "9876543210" } }),
  });
  assert.equal(customSave.status, 200);
  const storedPrivateData = JSON.parse(
    db.prepare("SELECT encrypted_data FROM smartfill_private_data WHERE user_id=?").get("u1").encrypted_data,
  );
  assert.ok(Array.isArray(storedPrivateData));
  const storedPrivateMap = new Map(storedPrivateData);
  assert.equal(storedPrivateMap.get("custom.legacy_note"), "Preserved legacy value");
  assert.equal(storedPrivateMap.get("custom.emergency_contact"), "9876543210");

  let conflict = await (await fetch(base + "/api/smartfill/suggestions?formId=admission", { headers })).json();
  assert.equal(conflict.suggestions[0].status, "ambiguous");
  assert.equal(conflict.suggestions[0].value, "");
  assert.ok(conflict.suggestions.some((item) => item.fieldKey === "identity.identity_id"));
  assert.ok(conflict.suggestions.some((item) => item.fieldKey === "identity.government_id"));

  const saveOcrFields = await fetch(base + "/api/smartfill/document-data", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      documentId: "doc-image-1",
      fields: { "education.course": "B.Tech AIML" },
    }),
  });
  assert.equal(saveOcrFields.status, 200);
  assert.deepEqual((await saveOcrFields.json()).fieldKeys, ["education.course"]);

  const unownedOcrDocument = await fetch(base + "/api/smartfill/document-data", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      documentId: "another-users-document",
      fields: { "education.course": "B.Tech AIML" },
    }),
  });
  assert.equal(unownedOcrDocument.status, 404);

  const unsupportedOcrDocument = await fetch(base + "/api/smartfill/document-data", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      documentId: "doc-image-1",
      fields: { "custom.__proto__": "unsafe" },
    }),
  });
  assert.equal(unsupportedOcrDocument.status, 400);

  conflict = await (await fetch(base + "/api/smartfill/suggestions?formId=admission", { headers })).json();
  const ocrSuggestion = conflict.suggestions.find((item) => item.fieldKey === "education.course");
  assert.equal(ocrSuggestion.value, "B.Tech AIML");
  assert.equal(ocrSuggestion.source, "vault_ocr");
  assert.equal(ocrSuggestion.status, "user_confirmed");
  assert.match(ocrSuggestion.note, /OCR can be wrong/);

  const deniedWithoutToken = await fetch(base + "/api/test-submit", {
    method: "POST",
    headers: { ...headers, "x-secureid-smartfill-form": "admission" },
    body: JSON.stringify({}),
  });
  assert.equal(deniedWithoutToken.status, 409);
  assert.equal((await deniedWithoutToken.json()).code, "SMARTFILL_REVIEW_REQUIRED");

  const deniedWithWrongToken = await fetch(base + "/api/test-submit", {
    method: "POST",
    headers: {
      ...headers,
      "x-secureid-smartfill-form": "admission",
      "x-secureid-smartfill-review": "not-a-valid-review-token",
    },
    body: JSON.stringify({}),
  });
  assert.equal(deniedWithWrongToken.status, 409);

  const partialReview = await fetch(base + "/api/smartfill/review", {
    method: "POST",
    headers,
    body: JSON.stringify({
      formId: "admission",
      fieldKeys: [conflict.suggestions[0].fieldKey],
    }),
  });
  assert.equal(partialReview.status, 400);

  const reviewResponse = await fetch(base + "/api/smartfill/review", {
    method: "POST",
    headers,
    body: JSON.stringify({
      formId: "admission",
      fieldKeys: conflict.suggestions.map((item) => item.fieldKey),
    }),
  });
  assert.equal(reviewResponse.status, 200);
  const review = await reviewResponse.json();
  assert.equal(typeof review.reviewToken, "string");
  assert.ok(review.reviewToken.length >= 40);
  assert.ok(review.expiresAt > Date.now());

  const allowedAfterReview = await fetch(base + "/api/test-submit", {
    method: "POST",
    headers: {
      ...headers,
      "x-secureid-smartfill-form": "admission",
      "x-secureid-smartfill-review": review.reviewToken,
    },
    body: JSON.stringify({}),
  });
  assert.equal(allowedAfterReview.status, 200);

  const rejectedAfterReview = await fetch(base + "/api/test-submit-fail", {
    method: "POST",
    headers: {
      ...headers,
      "x-secureid-smartfill-form": "admission",
      "x-secureid-smartfill-review": review.reviewToken,
    },
    body: JSON.stringify({}),
  });
  assert.equal(rejectedAfterReview.status, 400);

  const auditRows = db.prepare("SELECT * FROM smartfill_audit").all();
  const audit = JSON.stringify(auditRows);
  assert.equal(audit.includes("Private Test"), false);
  assert.equal(audit.includes("Different Person"), false);
  assert.equal(auditRows.filter((row) => row.action === "submitted").length, 1);

  const removedOcrFields = await fetch(base + "/api/smartfill/document-data/doc-image-1", {
    method: "DELETE",
    headers,
  });
  assert.equal(removedOcrFields.status, 200);
  assert.equal((await removedOcrFields.json()).removed, 1);

  await fetch(base + "/api/smartfill/consent/admission", { method: "DELETE", headers });
  assert.equal((await fetch(base + "/api/smartfill/suggestions?formId=admission", { headers })).status, 403);
  assert.equal(
    (await fetch(base + "/api/smartfill/schema", { headers: { "x-user": "u1", "x-mfa": "false" } })).status,
    403,
  );

  let throttledStatus = 0;
  for (let request = 0; request < 80 && throttledStatus !== 429; request += 1) {
    throttledStatus = (
      await fetch(base + "/api/smartfill/schema", { headers })
    ).status;
  }
  assert.equal(throttledStatus, 429, "SmartFill routes must be rate limited per client IP");
});

test("SmartFill review acknowledgement guards active-page form submission", () => {
  const ui = readFileSync(new URL("../src/SmartFill.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /data-smartfill-page=\{page\}/);
  assert.match(ui, /addEventListener\("submit", guard, true\)/);
  assert.match(ui, /stopImmediatePropagation\(\)/);
  assert.match(ui, /dataset\.smartfillReviewToken = result\.reviewToken/);
  assert.match(ui, /delete form\.dataset\.smartfillReviewToken/);
  assert.match(ui, /setReviewAcknowledged\(false\)/);
  assert.match(api, /X-SecureID-SmartFill-Form/);
  assert.match(api, /X-SecureID-SmartFill-Review/);
  assert.match(ui, /function closePanel\(\)[\s\S]*?clearOcrReview\(\)[\s\S]*?setOcrConsent\(false\)/);
  assert.match(ui, /onClick=\{\(\) => open \? closePanel\(\) : setOpen\(true\)\}/);
  assert.match(ui, /setOcrDocumentId\(event\.target\.value\); setOcrConsent\(false\); clearOcrReview\(\);/);
  assert.match(ui, /OCR supports Vault PDFs, JPEG, PNG and WebP/);
  assert.match(ui, /Temporary previews clear when you close SmartFill or change documents/);
});
