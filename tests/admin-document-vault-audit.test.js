import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");
const start = source.indexOf('app.get("/api/admin/document-access-audit"');
const end = source.indexOf("\n  /*", start);
const route = source.slice(start, end);

test("admin document audit endpoint remains owner- and MFA-gated", () => {
  assert.notEqual(start, -1, "audit endpoint must exist");
  assert.match(route, /requireAuth\s*,\s*requireOwnerDocumentAccess/);
});

test("admin document audit endpoint is read-only and disables caching", () => {
  assert.match(route, /SELECT id,actor_user_id AS actorUserId,actor_email AS actorEmail,action/);
  assert.match(route, /ORDER BY created_at DESC LIMIT \?/);
  assert.match(route, /Math\.max\(1,Math\.min\(100,/);
  assert.match(route, /setHeader\("Cache-Control","no-store"\)/);
  assert.doesNotMatch(route, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test("admin document audit endpoint returns only the documented success envelope", () => {
  assert.match(route, /res\.json\(\{success:true,events\}\)/);
  assert.doesNotMatch(route, /encrypted_path|DOCUMENT_ENCRYPTION_KEY|decryptBuffer/);
});
