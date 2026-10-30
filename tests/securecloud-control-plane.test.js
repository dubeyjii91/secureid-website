import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controlPlane = readFileSync(new URL("../server/securecloud-control-plane.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/SecureCloudPanel.jsx", import.meta.url), "utf8");
const ownerDashboard = readFileSync(new URL("../src/OwnerAdminDashboard.jsx", import.meta.url), "utf8");

test("SecureCloud control plane is registered in the existing SecureID API", () => {
  assert.match(server, /registerSecureCloudControlPlane\(\{ app, database, requireAuth, requireMfa, requireOwner, enforceSameOrigin \}\)/);
  assert.match(server, /import \{ registerSecureCloudControlPlane \} from "\.\/securecloud-control-plane\.js"/);
});

test("all SecureCloud management routes require authenticated owner MFA", () => {
  const routeLines = controlPlane.split("\n").filter((line) => /app\.(get|post)\(/.test(line));
  assert.ok(routeLines.length >= 6);
  for (const line of routeLines) { assert.match(line, /requireAuth/); assert.match(line, /requireMfa/); assert.match(line, /requireOwner/); }
});

test("mutating SecureCloud routes enforce same-origin CSRF protection", () => {
  const routeLines = controlPlane.split("\n").filter((line) => /app\.post\(/.test(line));
  assert.ok(routeLines.length >= 3);
  for (const line of routeLines) assert.match(line, /enforceSameOrigin/);
});

test("repository connections accept HTTPS GitHub URLs only", () => {
  assert.match(controlPlane, /url\.protocol === "https:"/);
  assert.match(controlPlane, /url\.hostname === "github\.com"/);
  assert.match(controlPlane, /!url\.username && !url\.password/);
});

test("deployment requests fail closed while no isolated worker is enabled", () => {
  assert.match(controlPlane, /SECURECLOUD_WORKER_ENABLED !== "true"/);
  assert.match(controlPlane, /DEPLOYMENT_WORKER_NOT_CONFIGURED/);
  assert.match(controlPlane, /no build has been started/);
});

test("existing owner dashboard embeds SecureCloud controls", () => {
  assert.match(ownerDashboard, /import SecureCloudPanel from "\.\/SecureCloudPanel\.jsx"/);
  assert.match(ownerDashboard, /<SecureCloudPanel \/>/);
  assert.match(dashboard, /\/api\/securecloud\/projects/);
});
