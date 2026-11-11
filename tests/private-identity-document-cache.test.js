import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/production-features.js", import.meta.url), "utf8");

function routeBlock(route, nextRoute) {
  const start = source.indexOf(route);
  assert.notEqual(start, -1, \`route not found: \${route}\`);
  const end = source.indexOf(nextRoute, start + route.length);
  assert.notEqual(end, -1, \`next route not found: \${nextRoute}\`);
  return source.slice(start, end);
}

test("private identity and document listing responses are never cacheable", () => {
  const routes = [
    ['app.get("/api/identity/verification-status"', 'app.get("/api/identity/profile"'],
    ['app.get("/api/identity/profile"', 'app.put(\n    "/api/identity/profile"'],
    ['app.get("/api/documents"', 'app.put("/api/documents/:id/metadata"'],
  ];

  for (const [route, nextRoute] of routes) {
    const block = routeBlock(route, nextRoute);
    assert.match(
      block,
      /res\.setHeader\("Cache-Control","private, no-store"\)/,
      \`\${route} must set private, no-store before returning private data\`,
    );
  }
});
