import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/production-features.js", import.meta.url), "utf8");

test("scholarship document preview disables caching before any authorization or document checks", () => {
  const route = 'app.get("/api/institutions/scholarship-applications/:id/documents/:documentId/preview"';
  const start = source.indexOf(route);
  assert.notEqual(start, -1, "scholarship document preview route must exist");
  const handlerStart = source.indexOf("=> {", start);
  assert.notEqual(handlerStart, -1, "scholarship document preview handler must exist");
  const header = source.indexOf('res.setHeader("Cache-Control","private, no-store, max-age=0")', handlerStart);
  assert.notEqual(header, -1, "scholarship document preview must set private no-store");
  const firstCheck = source.indexOf("const applicationId=", handlerStart);
  assert.ok(firstCheck > handlerStart, "preview handler must perform application checks");
  assert.ok(header < firstCheck, "no-store must be set before any application, permission, or document checks");
  const nextRoute = source.indexOf('app.get("/api/institutions/scholarship-applications/:id/audit"', handlerStart);
  assert.ok(nextRoute > header, "preview route boundary must remain intact");
  assert.ok(nextRoute - header < 1000, "cache header should be at the beginning of the preview handler");
});
