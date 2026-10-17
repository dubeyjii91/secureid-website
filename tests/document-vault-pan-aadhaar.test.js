import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../src/DocumentVault.jsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/document-vault.css", import.meta.url), "utf8");

test("PAN and Aadhaar have explicit upload categories and saved-state feedback", () => {
  assert.match(ui, /value="aadhaar"/);
  assert.match(ui, /value="pan"/);
  assert.match(backend, /ALLOWED_DOCUMENT_CATEGORIES = new Set\(\["general","aadhaar","pan","passport","voter_id","driving_licence"\]\)/);
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

test("official verification panel distinguishes local storage from government verification", () => {
  assert.match(ui, /OFFICIAL GOVERNMENT VERIFICATION/);
  assert.match(ui, /Government verification is not connected yet/);
  assert.match(ui, /has not yet been approved or connected to either service/);
  assert.match(ui, /incometax\.gov\.in\/iec\/foportal\/help\/all-topics\/e-filing-services\/verify-your-pan/);
  assert.match(ui, /uidai\.gov\.in\/hi\/authentication-requesting-agency/);
  assert.match(ui, /This is a submission status only, not an independent college or government verification/);
  assert.match(styles, /\.officialVerificationPanel/);
});
