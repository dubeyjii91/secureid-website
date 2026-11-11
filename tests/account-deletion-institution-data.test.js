import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");

test("account deletion removes student hostel and scholarship data before deleting the user", () => {
  const start = source.indexOf('app.delete("/api/account"');
  assert.notEqual(start, -1, "account deletion route must exist");
  const end = source.indexOf('app.get("/api/security/activity"', start);
  assert.ok(end > start, "account deletion route boundary must exist");
  const route = source.slice(start, end);

  const required = [
    'DELETE FROM scholarship_document_access_audit WHERE actor_user_id=? OR application_id IN (SELECT id FROM scholarship_applications WHERE student_user_id=?)',
    'DELETE FROM scholarship_audit WHERE actor_user_id=? OR application_id IN (SELECT id FROM scholarship_applications WHERE student_user_id=?)',
    'UPDATE scholarship_applications SET reviewed_by=NULL WHERE reviewed_by=?',
    'DELETE FROM scholarship_applications WHERE student_user_id=?',
    'DELETE FROM hostel_application_audit WHERE actor_user_id=? OR application_id IN (SELECT id FROM hostel_applications WHERE student_user_id=?)',
    'DELETE FROM hostel_operations_audit WHERE actor_user_id=? OR application_id IN (SELECT id FROM hostel_applications WHERE student_user_id=?)',
    'DELETE FROM hostel_fee_payments WHERE fee_record_id IN (SELECT id FROM hostel_fee_records WHERE application_id IN (SELECT id FROM hostel_applications WHERE student_user_id=?))',
    'DELETE FROM hostel_fee_records WHERE application_id IN (SELECT id FROM hostel_applications WHERE student_user_id=?)',
    'DELETE FROM hostel_bed_allocations WHERE application_id IN (SELECT id FROM hostel_applications WHERE student_user_id=?)',
    'UPDATE hostel_applications SET reviewed_by=NULL WHERE reviewed_by=?',
    'DELETE FROM hostel_applications WHERE student_user_id=?',
  ];
  for (const sql of required) assert.ok(route.includes(sql), "missing account deletion cleanup: " + sql);

  const deleteUser = route.indexOf('DELETE FROM users WHERE id=?');
  assert.ok(deleteUser > 0, "account deletion must still delete the user");
  for (const sql of required) assert.ok(route.indexOf(sql) < deleteUser, "cleanup must run before user deletion: " + sql);
});
