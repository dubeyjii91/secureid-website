import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerSecureCloudControlPlane, runSecureCloudTransaction } from "../server/securecloud-control-plane.js";
import { readFileSync } from "node:fs";

const controlPlane = readFileSync(new URL("../server/securecloud-control-plane.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/SecureCloudPanel.jsx", import.meta.url), "utf8");
const ownerDashboard = readFileSync(new URL("../src/OwnerAdminDashboard.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const formStyles = readFileSync(new URL("../src/secureid-layout-fixes.css", import.meta.url), "utf8");

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
  assert.match(controlPlane, /!url\.username && !url\.password && !url\.port && !url\.search && !url\.hash/);
  assert.match(controlPlane, /parts\.length === 2/);
});

test("deployment requests fail closed while no isolated worker is enabled", () => {
  assert.match(controlPlane, /workerConfigured: false/);
  assert.doesNotMatch(controlPlane, /SECURECLOUD_WORKER_ENABLED/);
  assert.match(controlPlane, /return res\.status\(503\).*DEPLOYMENT_WORKER_NOT_CONFIGURED/);
  assert.match(controlPlane, /no build has been started/);
});

test("existing owner dashboard embeds SecureCloud controls", () => {
  assert.match(ownerDashboard, /import SecureCloudPanel from "\.\/SecureCloudPanel\.jsx"/);
  assert.match(ownerDashboard, /<SecureCloudPanel \/>/);
  assert.match(dashboard, /\/api\/securecloud\/projects/);
});

test("owner dashboard has a bookmarkable, access-controlled entry URL", () => {
  assert.match(app, /pathname === "\/admin" \|\| pathname === "\/owner"/);
  assert.match(app, /id === "admin" \? "\/admin" : "\/"/);
  assert.match(app, /page === "admin" && sessionRole === "owner"/);
  assert.match(server, /OWNER_EMAIL/);
  assert.match(server, /function requireOwner/);
});

test("SecureCloud dashboard keeps the project form concise without the hosting-project explainer panel", () => {
  assert.match(dashboard, /Create hosting project/);
  assert.doesNotMatch(dashboard, /What is a hosting project\?/);
  assert.doesNotMatch(dashboard, /does not create a Railway project/);
  assert.match(dashboard, /Builds and deployments remain unavailable/);
});

test("site-wide form styles separate labels, inputs, fields and submit actions", () => {
  assert.match(formStyles, /row-gap: 18px/);
  assert.match(formStyles, /gap: 9px/);
  assert.match(formStyles, /min-height: 44px/);
  assert.match(formStyles, /form > button\[type="submit"\]/);
  assert.match(formStyles, /@media \(max-width: 760px\)/);
  assert.match(formStyles, /\.collegeCheck/);
  assert.match(formStyles, /\.claimGrid \.claim/);
});

test("SecureCloud writes use native SQLite transactions and roll back partial writes", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE transaction_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    runSecureCloudTransaction(database, () => {
      database.prepare("INSERT INTO transaction_probe (id, value) VALUES (?, ?)").run("committed", "yes");
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM transaction_probe").get().count, 1);
    assert.equal(database.isTransaction, false);

    assert.throws(() => runSecureCloudTransaction(database, () => {
      database.prepare("INSERT INTO transaction_probe (id, value) VALUES (?, ?)").run("rolled-back", "no");
      throw new Error("force rollback");
    }), /force rollback/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM transaction_probe").get().count, 1);
    assert.equal(database.prepare("SELECT value FROM transaction_probe WHERE id = ?").get("committed").value, "yes");
    assert.equal(database.isTransaction, false);
  } finally {
    database.close();
  }
});

test("SecureCloud control plane does not call a nonexistent DatabaseSync transaction helper", () => {
  assert.doesNotMatch(controlPlane, /database\.transaction\(/);
  assert.match(controlPlane, /database\.exec\("BEGIN IMMEDIATE"\)/);
  assert.match(controlPlane, /database\.exec\("COMMIT"\)/);
  assert.match(controlPlane, /database\.exec\("ROLLBACK"\)/);
});

test("SecureCloud owner routes create projects and services with atomic audit records", () => {
  const database = new DatabaseSync(":memory:");
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
  };
  const pass = (_req, _res, next) => next();
  try {
    registerSecureCloudControlPlane({
      app,
      database,
      requireAuth: pass,
      requireMfa: pass,
      requireOwner: pass,
      enforceSameOrigin: pass,
    });

    const projectResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    routes.get("POST /api/securecloud/projects")(
      { body: { name: "Integration workspace", description: "Test only" }, user: { id: "owner-1" } },
      projectResponse,
      (error) => { throw error; },
    );
    assert.equal(projectResponse.statusCode, 201);
    assert.equal(projectResponse.body.success, true);
    const projectId = projectResponse.body.project.id;
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM securecloud_projects WHERE owner_user_id = ?").get("owner-1").count, 1);
    assert.equal(database.prepare("SELECT action FROM securecloud_audit_events WHERE resource_id = ?").get(projectId).action, "PROJECT_CREATED");

    const serviceResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    routes.get("POST /api/securecloud/projects/:projectId/services")(
      { params: { projectId }, body: { name: "Web", repositoryUrl: "https://github.com/example/secureid-demo", branch: "main", runtime: "node" }, user: { id: "owner-1" } },
      serviceResponse,
      (error) => { throw error; },
    );
    assert.equal(serviceResponse.statusCode, 201);
    assert.equal(serviceResponse.body.success, true);
    const serviceId = serviceResponse.body.service.id;
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM securecloud_services WHERE project_id = ?").get(projectId).count, 1);
    assert.equal(database.prepare("SELECT action FROM securecloud_audit_events WHERE resource_id = ?").get(serviceId).action, "SERVICE_CREATED");
  } finally {
    database.close();
  }
});

test("SecureCloud project creation rolls back when its audit write fails", () => {
  const database = new DatabaseSync(":memory:");
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
  };
  const pass = (_req, _res, next) => next();
  try {
    registerSecureCloudControlPlane({
      app,
      database,
      requireAuth: pass,
      requireMfa: pass,
      requireOwner: pass,
      enforceSameOrigin: pass,
    });
    database.exec("CREATE TRIGGER reject_securecloud_audit BEFORE INSERT ON securecloud_audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    assert.throws(() => routes.get("POST /api/securecloud/projects")(
      { body: { name: "Must roll back" }, user: { id: "owner-2" } },
      response,
      (error) => { throw error; },
    ), /audit unavailable/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM securecloud_projects WHERE owner_user_id = ?").get("owner-2").count, 0);
    assert.equal(database.isTransaction, false);
  } finally {
    database.close();
  }
});
