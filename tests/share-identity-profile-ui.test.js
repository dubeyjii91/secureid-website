import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/ShareManagement.jsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");

test("share management lets the authenticated owner load and save the encrypted identity profile", () => {
  assert.match(app, /fetch\("\/api\/identity\/profile"/);
  assert.match(app, /method:"PUT"/);
  assert.match(app, /Save identity profile/);
  assert.match(backend, /app\.get\("\/api\/identity\/profile",requireAuth,requireMfaProduction/);
  assert.match(backend, /app\.put\([\s\S]*?"\/api\/identity\/profile",[\s\S]*?requireAuth,[\s\S]*?requireMfaProduction/);
  assert.match(backend, /jsonEncrypt\(profile,key\)/);
});

test("identity profile editor covers the claims supported by secure identity shares", () => {
  for (const field of ["name","age","dateOfBirth","address","email","phone","identityId","college","studentId","governmentId"]) {
    assert.match(app, new RegExp('\\["' + field + '"'));
    assert.match(backend, new RegExp('"' + field + '"'));
  }
});

test("public share rendering uses readable claim labels and an explicit empty state", () => {
  const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /shareClaimLabels/);
  assert.match(source, /No identity details were included in this share/);
});
