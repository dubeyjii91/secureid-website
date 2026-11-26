import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../src/DocumentVault.jsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/document-vault.css", import.meta.url), "utf8");

test("PAN and Aadhaar have explicit upload categories and saved-state feedback", () => {
  assert.match(ui, /value="aadhaar"/);
  assert.match(ui, /value="pan"/);
  assert.match(backend, /ALLOWED_DOCUMENT_CATEGORIES = new Set\(\["general","aadhaar","pan","passport","voter_id","driving_licence","student_id","institution_proof"\]\)/);
  assert.match(ui, /Saved in vault/);
  assert.match(ui, /No Aadhaar file saved yet/);
  assert.match(ui, /No PAN file saved yet/);
  assert.match(ui, /Securely save Aadhaar/);
  assert.match(ui, /Securely save PAN/);
  assert.match(styles, /\.identityDocumentStatus\.stored/);
});

test("PAN/Aadhaar upload guidance does not falsely claim government verification", () => {
  assert.match(ui, /This does not verify the document with UIDAI or the Income Tax Department/);
  assert.match(ui, /masked Aadhaar recommended/);
});

test("government verification is disabled until an authorized provider is connected", () => {
  assert.match(ui, /OFFICIAL GOVERNMENT VERIFICATION/);
  assert.match(ui, /Government verification is not connected yet/);
  assert.match(ui, /PAN verification unavailable/);
  assert.match(ui, /Aadhaar verification unavailable/);
  assert.match(ui, /No government verification request can be submitted from this deployment/);
  assert.match(ui, /disabled title="Requires an authorized provider integration"/);
  assert.match(ui, /disabled title="Requires a UIDAI-authorized or approved partner integration"/);
  assert.doesNotMatch(ui, /href="https:\/\/www\.incometax\.gov\.in/);
  assert.doesNotMatch(ui, /href="https:\/\/uidai\.gov\.in/);
  assert.match(ui, /This is a submission status only, not an independent college or government verification/);
  assert.match(styles, /\.officialVerificationPanel/);
});

test("government integration readiness endpoint is authenticated and never reports live verification", () => {
  assert.match(backend, /\/api\/identity\/government-verification\/readiness/);
  assert.match(backend, /requireAuth,requireMfaProduction/);
  assert.match(backend, /PAN_VERIFICATION_APPROVED === "true"/);
  assert.match(backend, /AADHAAR_AUTH_APPROVED === "true"/);
  assert.match(backend, /panConfigured && process\.env\.PAN_VERIFICATION_APPROVED === "true"/);
  assert.match(backend, /aadhaarConfigured && process\.env\.AADHAAR_AUTH_APPROVED === "true"/);
  assert.match(backend, /officialVerificationConnected:false/);
  assert.match(backend, /live:false/);
  assert.match(backend, /No government verification request has been performed/);
  assert.match(ui, /governmentReadiness\?\.pan\?\.configured/);
  assert.match(ui, /governmentReadiness\?\.aadhaar\?\.configured/);
  assert.match(styles, /\.governmentReadinessList/);
});

 
test("document integrity verification awaits file-type detection before responding", () => {
  const routeStart = backend.indexOf('app.post("/api/documents/:id/verify"');
  assert.notEqual(routeStart, -1);
  const routeEnd = backend.indexOf("/*", routeStart);
  const route = backend.slice(routeStart, routeEnd === -1 ? undefined : routeEnd);
  assert.match(route, /async \(req,res,next\)=>/);
  assert.match(route, /await fileTypeFromBuffer\(buffer\)/);
  assert.doesNotMatch(route, /fileTypeFromBuffer\(buffer\)\.then\(/);
  assert.match(route, /authenticityStatus:"not_verified"/);
  assert.match(route, /Document authenticity is NOT verified/);
});

test("PAN/Aadhaar file-check action is transparent and its results are persisted", () => {
  assert.match(ui, /Run file checks/);
  assert.match(ui, /Authenticity: NOT VERIFIED/);
  assert.match(backend, /Document authenticity is NOT verified/);
  assert.ok(backend.includes('app.post("/api/documents/:id/verify",enforceSameOrigin,requireAuth,requireMfaProduction'));
  assert.match(backend, /WHERE id=\? AND user_id=\? AND deleted_at IS NULL/);
  assert.match(backend, /authenticityStatus:"not_verified"/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS identity_document_checks/);
  assert.match(backend, /verificationCheck: document\.verificationCheck \? JSON\.parse/);
});


test("Vault OCR is private, rate-limited, temporary and limited to supported stored images", () => {
  const ocrHelper = readFileSync(new URL("../server/document-ocr.js", import.meta.url), "utf8");
  const smartFill = readFileSync(new URL("../server/smartfill.js", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const routeStart = backend.indexOf('"/api/documents/:id/ocr"');
  assert.notEqual(routeStart, -1);
  const routeEnd = backend.indexOf("/*", routeStart);
  const route = backend.slice(routeStart, routeEnd === -1 ? undefined : routeEnd);
  assert.match(route, /documentOcrRateLimit/);
  assert.match(route, /enforceSameOrigin/);
  assert.match(route, /requireAuth/);
  assert.match(route, /requireMfaProduction/);
  assert.match(route, /assertWalletUnlocked\(req\.user\.id\)/);
  assert.match(route, /WHERE id=\? AND user_id=\? AND deleted_at IS NULL/);
  assert.match(route, /await fileTypeFromBuffer\(plaintext\)/);
  assert.match(route, /persisted:false/);
  assert.match(backend, /const DOCUMENT_OCR_MIME = new Set\(\["application\/pdf","image\/jpeg","image\/png","image\/webp"\]\)/);
  assert.match(ocrHelper, /mkdtemp/);
  assert.match(ocrHelper, /await fs\.rm\(workingDirectory, \{ recursive: true, force: true \}\)/);
  assert.match(ocrHelper, /maxBuffer: 128 \* 1024/);
  assert.match(smartFill, /CREATE TABLE IF NOT EXISTS smartfill_document_data/);
  assert.match(smartFill, /sources\.includes\("vault_ocr"\)/);
  assert.match(smartFill, /encryptValue\(\{ value: value\.trim\(\) \}\)/);
  assert.match(dockerfile, /poppler-utils/);
  assert.match(dockerfile, /tesseract-ocr-data-eng/);
  assert.match(dockerfile, /tesseract-ocr-data-hin/);
  assert.match(backend, /DELETE FROM smartfill_document_data WHERE user_id=\? AND document_id=\?/);
});
