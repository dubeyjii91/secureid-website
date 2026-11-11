import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspace, backend] = await Promise.all([
  readFile(new URL("../src/CollegeWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../server/production-features.js", import.meta.url), "utf8"),
]);

test("Institution Admin receives a dedicated, institution-scoped dashboard", () => {
  assert.match(workspace, /isInstitutionAdminWorkspace/);
  assert.match(workspace, /Institution Admin Dashboard/);
  assert.match(workspace, /Student review queue/);
  assert.match(workspace, /Hostel Management and Scholarship Management/);
  assert.match(workspace, /Platform-wide account provisioning, role grants, subscription changes and owner security controls remain restricted to the SecureID Owner/);
});

test("Warden remains isolated from Institution Admin and scholarship workspace", () => {
  assert.match(workspace, /const isInstitutionAdminWorkspace = activeInstitutionAdmins\.length > 0 && !hasActiveWarden/);
  assert.match(workspace, /hasActiveWarden \? \[\] : activeInstitutionRoles/);
  assert.match(workspace, /!hasActiveWarden && activeInstitutionRoles/);
  assert.match(workspace, /WARDEN · HOSTEL OPERATIONS/);
});

test("institution modules remain gated by active membership and subscription entitlements", () => {
  assert.match(backend, /function hasInstitutionFeature\(institutionId, feature\)/);
  assert.match(backend, /\["pilot","active"\]\.includes\(row\.status\)/);
  assert.match(backend, /hasInstitutionFeature\(institutionId,"scholarship"\)/);
  assert.match(backend, /hasInstitutionFeature\(institutionId,"hostel"\)/);
  assert.match(backend, /\["student","reviewer","institution_admin","read_only"\]\.includes\(membership\.role\)/);
});
