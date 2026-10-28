import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");
const start = source.indexOf('app.post("/api/mfa/verify"');
const end = source.indexOf('app.post("/api/mfa/cancel"', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const route = source.slice(start, end);

test("MFA recovery codes are consumed once inside a serialized transaction", () => {
  assert.match(route, /database\.exec\("BEGIN IMMEDIATE"\)/);
  assert.match(route, /UPDATE mfa_recovery_codes SET used_at = \? WHERE id = \? AND user_id = \? AND used_at IS NULL/);
  assert.match(route, /Number\(consumed\.changes\) !== 1/);
  assert.match(route, /database\.exec\("COMMIT"\)/);
  assert.match(route, /database\.exec\("ROLLBACK"\)/);
});

test("OTP challenge is atomically consumed before MFA is granted", () => {
  const consume = route.indexOf('DELETE FROM otp_challenges WHERE id = ? AND user_id = ? AND code_hash = ? AND expires_at > ? AND attempts < ?');
  const grant = route.indexOf('UPDATE sessions SET mfa_verified_until = ?, trusted_until = ?, expires_at = ? WHERE token_hash = ?');
  const commit = route.indexOf('database.exec("COMMIT")', consume);
  assert.ok(consume >= 0, "OTP challenge must be conditionally consumed");
  assert.ok(grant > consume, "MFA must not be granted before challenge consumption");
  assert.ok(commit > grant, "session update must commit with challenge consumption");
});
