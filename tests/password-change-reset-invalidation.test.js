import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");
const start = source.indexOf('app.post("/api/security/password/change"');
const end = source.indexOf('app.post("/api/security/mfa/recovery/regenerate"', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const route = source.slice(start, end);

test("password change invalidates outstanding password-reset links atomically", () => {
  assert.match(route, /database\.exec\("BEGIN IMMEDIATE"\)/);
  assert.match(route, /DELETE FROM password_reset_tokens WHERE user_id = \?/);
  assert.match(route, /DELETE FROM sessions WHERE user_id = \? AND token_hash != \?/);
  assert.match(route, /DELETE FROM otp_challenges WHERE user_id = \?/);
  assert.match(route, /database\.exec\("COMMIT"\)/);
  assert.match(route, /database\.exec\("ROLLBACK"\)/);
});
