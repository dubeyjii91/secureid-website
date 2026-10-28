import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const productionFeatures = await readFile(
  new URL("../server/production-features.js", import.meta.url),
  "utf8",
);

function routeBlock(source, route, nextRoute) {
  const start = source.indexOf(route);
  assert.notEqual(start, -1, `route not found: ${route}`);
  const end = nextRoute ? source.indexOf(nextRoute, start + route.length) : source.length;
  assert.notEqual(end, -1, `next route not found: ${nextRoute}`);
  return source.slice(start, end);
}

test("document reads and deletes are scoped to the authenticated owner", () => {
  const readRoute = routeBlock(
    productionFeatures,
    'app.get("/api/documents/:id"',
    'app.delete(\n    "/api/documents/:id"',
  );
  assert.match(readRoute, /WHERE id\s*=\s*\?\s+AND user_id\s*=\s*\?/);
  assert.match(readRoute, /\.get\(req\.params\.id,\s*req\.user\.id\)/);

  const deleteRoute = routeBlock(
    productionFeatures,
    'app.delete(\n    "/api/documents/:id"',
    'app.post("/api/document-share"',
  );
  assert.match(deleteRoute, /WHERE id\s*=\s*\?\s+AND user_id\s*=\s*\?/);
  assert.match(deleteRoute, /\.get\(req\.params\.id,\s*req\.user\.id\)/);
});

test("share revocation cannot revoke another user's share", () => {
  const documentRevoke = routeBlock(
    productionFeatures,
    'app.post("/api/document-share/revoke"',
    'app.get("/api/document-share/:token"',
  );
  assert.match(documentRevoke, /WHERE token_hash=\? AND user_id=\?/);
  assert.match(documentRevoke, /\.run\([^\n]*tokenHash,req\.user\.id\)/);

  const genericRevoke = routeBlock(
    productionFeatures,
    'app.post("/api/security/shares/revoke"',
    'app.get("/api/wallet"',
  );
  assert.match(genericRevoke, /WHERE id=\? AND user_id=\? AND revoked_at IS NULL/);
  assert.match(genericRevoke, /Number\(id\),req\.user\.id\)/);
});

test("institution memberships and college pilot requests are user-scoped and MFA-gated", () => {
  const memberships = routeBlock(
    productionFeatures,
    'app.get("/api/institutions/memberships"',
    'app.get("/api/college-pilot/requests"',
  );
  assert.match(memberships, /requireAuth, requireMfaProduction/);
  assert.match(memberships, /WHERE m\.user_id = \?/);
  assert.match(memberships, /\.all\(req\.user\.id\)/);

  const pilotRequests = routeBlock(
    productionFeatures,
    'app.get("/api/college-pilot/requests"',
    'app.post("/api/college-pilot/requests"',
  );
  assert.match(pilotRequests, /requireAuth, requireMfaProduction/);
  assert.match(pilotRequests, /WHERE user_id=\?/);
  assert.match(pilotRequests, /\.all\(req\.user\.id\)/);
});
