import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");
const start = source.indexOf('app.delete("/api/account"');
const end = source.indexOf('app.get("/api/security/activity"', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const route = source.slice(start, end);

test("account deletion erases all user-linked identity and institution records", () => {
  for (const table of [
    "identity_profiles",
    "identity_document_checks",
    "college_pilot_requests",
    "institution_review_submissions",
    "institution_admission_requests",
    "institution_admission_audit",
    "institution_review_audit",
    "institution_membership_audit",
    "institution_memberships",
    "secure_documents",
    "secure_document_shares",
    "secure_shares",
    "security_events",
    "security_notifications",
    "privacy_settings",
    "mfa_recovery_codes",
    "otp_challenges",
    "password_reset_tokens",
    "email_verification_tokens",
    "email_verification_state",
    "sessions",
    "users"
  ]) {
    assert.match(route, new RegExp("DELETE FROM " + table + " WHERE"));
  }
  assert.match(route, /database\.exec\("BEGIN"\)/);
  assert.match(route, /database\.exec\("COMMIT"\)/);
  assert.match(route, /database\.exec\("ROLLBACK"\)/);
});


test("account deletion anonymizes monetization actors without deleting financial history", () => {
  assert.match(route, /UPDATE secureid_financial_entries SET created_by=NULL WHERE created_by=\?/);
  assert.match(route, /UPDATE secureid_monetization_audit SET actor_user_id=NULL WHERE actor_user_id=\?/);
});
