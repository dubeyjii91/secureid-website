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

test("government scholarship applications use only the exact official portal URLs", () => {
  const portalUrls = Array.from(finder.matchAll(/^\\s*(?:url|secondaryUrl):\\s*"([^"]+)"/gm), match => match[1]);
  assert.deepEqual(portalUrls, [
    "https://pmsonline.bihar.gov.in/2026-27/pms/pms_online/Default.aspx",
    "https://pmsonline.bihar.gov.in/",
    "https://ekalyan.cgg.gov.in/",
    "https://www.cgg.gov.in/it_project/e-kalyan-government-of-jharkhand/",
    "https://scholarships.gov.in/All-Scholarships",
    "https://scholarships.gov.in/Students"
  ]);
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
  assert.ok(finder.includes('new CustomEvent("secureid:navigate", { detail: "documents" })'));
  assert.doesNotMatch(finder, /\bfetch\s*\(|\bapi\s*\(/);
});

test("institution workspace scholarship management is explicitly limited to partner programs", () => {
  assert.match(collegeScholarships, /published by an institution/i);
  assert.match(collegeScholarships, /not e-Kalyan|not.*government/i);
});

test("global layout fixes load before the final premium-neutral theme and shared sizing layer", () => {
  assert.ok(main.includes('import "./secureid-design-system.css"'));
  assert.ok(main.includes('import "./secureid-dashboard-workspaces.css"'));
  assert.ok(main.includes('import "./secureid-consistent-sizing.css"'));
  assert.ok(main.includes('import "./scholarship-finder.css"'));
  assert.ok(main.includes('import "./secureid-final-polish.css"'));
  assert.ok(!read("../src/App.jsx").includes("secureid-global-product-ui.css"));

  const appModule = main.indexOf("import App from './App.jsx'");
  const layoutLayer = main.indexOf('import "./secureid-global-product-ui.css"');
  const premiumTheme = main.indexOf('import "./secureid-premium-neutral.css"');
  const sizingLayer = main.indexOf('import "./secureid-consistent-sizing.css"');
  const finderLayer = main.indexOf('import "./scholarship-finder.css"');
  const finalPolishLayer = main.indexOf('import "./secureid-final-polish.css"');
  assert.ok(appModule >= 0 && appModule < layoutLayer);
  assert.ok(layoutLayer < premiumTheme);
  assert.ok(premiumTheme < sizingLayer);
  assert.ok(sizingLayer < finderLayer);
  assert.ok(finderLayer < finalPolishLayer);
});
