import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../src/App.jsx");
const main = read("../src/main.jsx");
const finder = read("../src/ScholarshipFinder.jsx");
const collegeScholarships = read("../src/ScholarshipManagement.jsx");

test("Scholarship Finder is available as a first-class authenticated workspace", () => {
  assert.ok(app.includes('lazy(() => import("./ScholarshipFinder.jsx"))'));
  assert.ok(app.includes('["scholarships", "Scholarship finder", "graduation"]'));
  assert.ok(app.includes('page === "scholarships"'));
  assert.ok(main.includes('import "./secureid-global-product-ui.css"'));
});

test("government scholarship applications always open the official portal", () => {
  assert.ok(finder.includes("https://pmsonline.bihar.gov.in/2026-27/pms/pms_online/Default.aspx"));
  assert.ok(finder.includes("https://ekalyan.cgg.gov.in/"));
  assert.ok(finder.includes("https://scholarships.gov.in/All-Scholarships"));
  assert.ok(finder.includes("Applications reopened"));
  assert.ok(finder.includes("30 November 2026"));
  assert.match(finder, /Government applications are submitted on their official websites/);
  assert.match(finder, /does not submit the external form/);
  assert.match(finder, /does not guarantee scholarship eligibility or payment/);
});

test("Scholarship Finder provides local filters and a non-submitting document checklist", () => {
  assert.match(finder, /useMemo/);
  assert.match(finder, /setState/);
  assert.match(finder, /setLevel/);
  assert.match(finder, /checklistItems/);
  assert.match(finder, /stays only in this open page/);
  assert.doesNotMatch(finder, /\bfetch\s*\(|\bapi\s*\(/);
});

test("institution workspace scholarship management is explicitly limited to partner programs", () => {
  assert.match(collegeScholarships, /published by an institution/i);
  assert.match(collegeScholarships, /not e-Kalyan|not.*government/i);
});

test("the final light product stylesheet is loaded after all earlier theme layers", () => {
  assert.ok(main.includes('import "./secureid-design-system.css"'));
  assert.ok(main.includes('import "./secureid-consistent-sizing.css"'));
  assert.ok(main.includes('import "./secureid-global-product-ui.css"'));
  assert.ok(!read("../src/App.jsx").includes("secureid-global-product-ui.css"));
});
