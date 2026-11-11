import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/student-admissions.js", import.meta.url), "utf8");

function routeBlock(route, nextRoute) {
  const start = source.indexOf(route);
  assert.notEqual(start, -1, `route not found: ${route}`);
  const end = source.indexOf(nextRoute, start + route.length);
  assert.notEqual(end, -1, `next route not found: ${nextRoute}`);
  return source.slice(start, end);
}

test("student admission PII and status responses are never cacheable", () => {
  const routes = [
    ['app.get("/api/admissions/institutions"', 'app.get("/api/admissions/mine"'],
    ['app.get("/api/admissions/mine"', 'app.post("/api/admissions/applications"'],
    ['app.post("/api/admissions/applications"', 'app.delete("/api/admissions/applications/:requestId"'],
    ['app.delete("/api/admissions/applications/:requestId"', 'app.get("/api/institutions/:institutionId/admission-requests"'],
    ['app.get("/api/institutions/:institutionId/admission-requests"', 'app.patch("/api/institutions/:institutionId/admission-requests/:requestId"'],
    ['app.patch("/api/institutions/:institutionId/admission-requests/:requestId"', null],
  ];

  for (const [route, nextRoute] of routes) {
    const block = nextRoute ? routeBlock(route, nextRoute) : source.slice(source.indexOf(route));
    assert.match(
      block,
      /res\.setHeader\("Cache-Control","private, no-store"\)/,
      `${route} must set private, no-store before returning admission data`,
    );
  }
});
