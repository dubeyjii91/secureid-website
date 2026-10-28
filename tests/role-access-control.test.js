import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [server, database, app] = await Promise.all([
  readFile(new URL("../server/server.js", import.meta.url), "utf8"),
  readFile(new URL("../server/database.js", import.meta.url), "utf8"),
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
]);

test("owner role is derived only from trusted OWNER_EMAIL configuration", () => {
  assert.match(server, /process\.env\.OWNER_EMAIL/);
  assert.match(server, /row\.email\.toLowerCase\(\) === configuredOwnerEmail/);
  assert.match(server, /configuredOwnerEmail && row\.email\.toLowerCase\(\) === configuredOwnerEmail \? "owner" : "user"/);
  assert.match(database, /role TEXT NOT NULL DEFAULT 'user'/);
  assert.match(server, /app\.post\("\/api\/auth\/register"[\s\S]*?INSERT INTO users/);
});

test("operational health details require authentication, MFA, and owner role", () => {
  assert.match(server, /function requireOwner\(req, res, next\)/);
  assert.match(server, /app\.get\("\/api\/admin\/health", requireAuth, requireMfa, requireOwner,/);
  assert.match(server, /app\.get\("\/api\/health", \(req, res\) =>/);
});

test("session API returns server-computed role and frontend displays that role", () => {
  assert.match(server, /app\.get\("\/api\/auth\/session", requireAuth, \(req, res\) => res\.json\(\{ success: true, user: req\.user/);
  assert.match(server, /req\.user = \{ id: row\.id, email: row\.email, role: effectiveRole/);
  assert.match(app, /setSessionRole\(result\.user\.role === "owner" \? "owner" : "user"\)/);
  assert.match(app, /sessionRole === "owner" \? "Owner" : "User"/);
});
