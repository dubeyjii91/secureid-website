import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");

test("account deletion blocks safely when institution-owned records still reference the account", () => {
  const start = source.indexOf('app.delete("/api/account"');
  assert.notEqual(start, -1, "account deletion route must exist");
  const end = source.indexOf('app.get("/api/security/activity"', start);
  assert.ok(end > start, "account deletion route boundary must exist");
  const route = source.slice(start, end);

  const transaction = route.indexOf('database.exec("BEGIN")');
  const preflight = route.indexOf("const deletionBlockers = [");
  const rollback = route.indexOf('database.exec("ROLLBACK")', preflight);
  const firstMutation = route.indexOf('DELETE FROM secure_document_shares');
  assert.ok(transaction >= 0 && preflight > transaction, "blocker checks must run inside the deletion transaction");
  assert.ok(rollback > preflight && rollback < firstMutation, "blocked deletion must roll back before any destructive cleanup");

  const required = [
    "FROM scholarship_programs WHERE created_by=?",
    "FROM hostel_buildings WHERE created_by=?",
    "FROM hostel_bed_allocations WHERE allocated_by=?",
    "FROM hostel_fee_records WHERE created_by=?",
    "FROM hostel_fee_payments WHERE received_by=?",
    "FROM institution_membership_role_grants WHERE granted_by=?",
    "FROM hostel_room_occupancy_audit WHERE actor_user_id=?",
    "UPDATE institution_subscriptions SET updated_by=NULL WHERE updated_by=?",
    "FROM institution_staff WHERE created_by=?",
    "FROM institution_courses WHERE created_by=?",
    "FROM institution_attendance WHERE student_user_id=? OR marked_by=?",
    "FROM institution_fee_invoices WHERE student_user_id=? OR created_by=?",
    "FROM institution_fee_payments WHERE student_user_id=? OR received_by=?",
    "FROM institution_assessments WHERE created_by=?",
    "FROM institution_assessment_results WHERE student_user_id=? OR recorded_by=?",
    "FROM institution_operations_audit WHERE actor_user_id=?",
    'code: "INSTITUTION_RECORDS_REQUIRE_RETENTION"',
    "status(409)",
  ];
  for (const item of required) assert.ok(route.includes(item), "missing account deletion safeguard: " + item);
  assert.ok(route.includes("blockers: deletionBlockers.map"), "response must identify the retained record categories");
});

