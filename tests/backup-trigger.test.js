import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { registerBackupTrigger } from "../server/backup-trigger.js";

function setup({ token = "a".repeat(43), runBackup = () => ({ success: true, sha256: "b".repeat(64) }) } = {}) {
  const routes = new Map();
  const app = { post: (path, ...handlers) => routes.set(path, handlers) };
  registerBackupTrigger({ app, runBackup, env: { BACKUP_TRIGGER_TOKEN: token }, now: () => new Date("2026-11-12T00:00:00.000Z") });
  return routes.get("/api/internal/backup/run");
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("backup trigger is disabled when no sufficiently long token is configured", async () => {
  const handlers = setup({ token: "" });
  assert.equal(handlers.length, 2, "route must include rate limiting before the handler");
  const res = response();
  await handlers.at(-1)({ headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("backup trigger rejects missing and incorrect bearer tokens", async () => {
  const handler = setup().at(-1);
  for (const authorization of [undefined, "Bearer wrong"]) {
    const res = response();
    await handler({ headers: authorization ? { authorization } : {} }, res);
    assert.equal(res.statusCode, 401);
  }
});

test("backup trigger runs only after bearer-token authorization and returns integrity evidence", async () => {
  let calls = 0;
  const token = "a".repeat(43);
  const handler = setup({ token, runBackup: () => { calls += 1; return { success: true, sha256: "c".repeat(64), file: "/private/path/backup.json" }; } }).at(-1);
  const res = response();
  await handler({ headers: { authorization: `Bearer ${token}` } }, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.sha256, "c".repeat(64));
  assert.equal(res.body.completedAt, "2026-11-12T00:00:00.000Z");
  assert.equal("file" in res.body, false);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("backup trigger returns a generic failure and does not expose internal errors", async () => {
  const handler = setup({ runBackup: () => { throw new Error("private filesystem path and details"); } }).at(-1);
  const res = response();
  await handler({ headers: { authorization: `Bearer ${"a".repeat(43)}` } }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, message: "Encrypted backup failed." });
  assert.equal(JSON.stringify(res.body).includes("private filesystem"), false);
});

test("backup trigger enforces a per-process request limit", async (t) => {
  const token = "d".repeat(43);
  const app = express();
  registerBackupTrigger({
    app,
    runBackup: () => ({ success: true, sha256: "e".repeat(64) }),
    env: { BACKUP_TRIGGER_TOKEN: token },
  });
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/internal/backup/run`;
  const statuses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    statuses.push(response.status);
    await response.arrayBuffer();
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
});
