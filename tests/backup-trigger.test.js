import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerBackupTrigger } from "../server/backup-trigger.js";

function setup({ token = "a".repeat(43), runBackup = () => ({ success: true, sha256: "b".repeat(64) }) } = {}) {
  const routes = new Map();
  const app = { post: (path, ...handlers) => routes.set("POST "+path, handlers), get: (path, ...handlers) => routes.set("GET "+path, handlers) };
  registerBackupTrigger({ app, runBackup, getBackupFile: async () => ({ filePath: "/tmp/not-used", fileName: "secureid-test.backup.json", size: 1, sha256: "f".repeat(64), createdAt: "2026-11-12T00:00:00.000Z" }), env: { BACKUP_TRIGGER_TOKEN: token }, now: () => new Date("2026-11-12T00:00:00.000Z") });
  return routes.get("POST /api/internal/backup/run");
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


test("off-site download requires the bearer token and streams only the encrypted artifact with a raw-file digest", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "secureid-offsite-test-"));
  const filePath = path.join(directory, "secureid-2026-11-12T00-00-00-000Z.backup.json");
  const bytes = Buffer.from(JSON.stringify({ version: 2, iv: "encrypted", tag: "tag", data: "ciphertext" }));
  writeFileSync(filePath, bytes, { mode: 0o600 });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const token = "z".repeat(43);
  const app = express();
  registerBackupTrigger({
    app,
    runBackup: () => ({ success: true, sha256: "a".repeat(64) }),
    getBackupFile: async () => ({ filePath, fileName: path.basename(filePath), size: bytes.length, sha256: digest, createdAt: "2026-11-12T00:00:00.000Z" }),
    env: { BACKUP_TRIGGER_TOKEN: token },
  });
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/internal/backup/download`;
  const denied = await fetch(url);
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.equal(response.headers.get("x-backup-sha256"), digest);
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="${path.basename(filePath)}"`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("off-site download rejects artifacts above the hard transfer limit", async (t) => {
  const token = "y".repeat(43);
  const app = express();
  registerBackupTrigger({
    app,
    runBackup: () => ({ success: true, sha256: "a".repeat(64) }),
    getBackupFile: async () => ({ filePath: "/tmp/not-used", fileName: "secureid-test.backup.json", size: 400 * 1024 * 1024 + 1, sha256: "b".repeat(64), createdAt: "2026-11-12T00:00:00.000Z" }),
    env: { BACKUP_TRIGGER_TOKEN: token },
  });
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/backup/download`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).success, false);
});
