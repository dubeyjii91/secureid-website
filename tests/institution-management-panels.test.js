import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspace, panels] = await Promise.all([
  readFile(new URL("../src/InstitutionModules.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/institution/InstitutionModulePanels.jsx", import.meta.url), "utf8"),
]);

test("institution operations render four independent feature panels", () => {
  for (const name of ["StudentsModule", "StaffModule", "FinanceModule", "AcademicsModule"]) {
    assert.match(panels, new RegExp(`export function ${name}\\(props\\)`));
    assert.match(workspace, new RegExp(`<${name} \\{\\.\\.\\.moduleProps\\} />`));
  }
});

test("institution overview remains a summary rather than merging operational workflows", () => {
  assert.match(workspace, /institutionAdminOverview/);
  assert.match(workspace, /overview\.collectedPaise/);
  assert.match(workspace, /role="tablist"/);
  assert.match(panels, /Student directory/);
  assert.match(panels, /Staff directory/);
  assert.match(panels, /Create fee invoice/);
  assert.match(panels, /Courses & subjects/);
});

test("finance and staff UI communicate integration boundaries", () => {
  assert.match(workspace, /Finance records are manual entries; no payment gateway is connected/);
  assert.match(workspace, /Staff directory entries do not create SecureID accounts or grant permissions/);
});
