import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");
const start = source.indexOf('app.post("/api/auth/reset-password"');
const end = source.indexOf('app.get("/api/health/ready"', start);
assert.notEqual(start, -1, "password reset route must exist");
assert.notEqual(end, -1, "password reset route boundary must exist");
const route = source.slice(start, end);

test("password reset consumes its token and rotates credentials atomically", () => {
  assert.match(route, /database\.exec\("BEGIN IMMEDIATE"\)/);
  assert.match(route, /UPDATE password_reset_tokens SET used_at = \? WHERE id = \? AND user_id = \? AND used_at IS NULL AND expires_at > \?/);
  assert.match(route, /Number\(consumed\.changes\) !== 1/);
  assert.match(route, /UPDATE users SET password_hash = \?, password_changed_at = \? WHERE id = \?/);
  assert.match(route, /DELETE FROM sessions WHERE user_id = \?/);
  assert.match(route, /DELETE FROM otp_challenges WHERE user_id = \?/);
  assert.match(route, /database\.exec\("COMMIT"\)/);
  assert.match(route, /database\.exec\("ROLLBACK"\)/);
});

test("password reset does not report success until the transaction commits", () => {
  const commit = route.indexOf('database.exec("COMMIT")');
  const successLog = route.indexOf('logEvent(record.user_id, "PASSWORD_RESET_COMPLETED", req)');
  assert.notEqual(commit, -1);
  assert.ok(successLog > commit, "success event must occur only after commit");
});
