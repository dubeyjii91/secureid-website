import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { enforceShareRateLimit, SHARE_RATE_IP_MAX, SHARE_RATE_USER_MAX, SHARE_RATE_WINDOW_MS } from "../server/share-rate-limit.js";

function db() {
  const value = new DatabaseSync(":memory:");
  value.exec("CREATE TABLE rate_limits (bucket_key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL)");
  return value;
}

test("stores hashed IP and user counters with a fixed expiry", () => {
  const database = db();
  enforceShareRateLimit(database, { ip: "192.0.2.1" }, "user-a", 1000);
  const rows = database.prepare("SELECT bucket_key, hits, reset_at FROM rate_limits").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.hits === 1 && row.reset_at === 1000 + SHARE_RATE_WINDOW_MS));
  assert.ok(rows.every((row) => !row.bucket_key.includes("192.0.2.1")));
  database.close();
});

test("rejects a user over the limit without incrementing counters", () => {
  const database = db();
  for (let i = 0; i < SHARE_RATE_USER_MAX; i++) enforceShareRateLimit(database, { ip: "192.0.2.2" }, "user-b", 2000 + i);
  assert.throws(() => enforceShareRateLimit(database, { ip: "192.0.2.2" }, "user-b", 3000), (error) => error.statusCode === 429);
  const rows = database.prepare("SELECT hits FROM rate_limits").all().map((row) => row.hits);
  assert.deepEqual(rows.sort((a, b) => a - b), [1, SHARE_RATE_USER_MAX]);
  database.close();
});

test("enforces the IP limit across distinct users", () => {
  const database = db();
  for (let i = 0; i < SHARE_RATE_IP_MAX; i++) enforceShareRateLimit(database, { ip: "198.51.100.7" }, `user-${i}`, 5000 + i);
  assert.throws(() => enforceShareRateLimit(database, { ip: "198.51.100.7" }, "other-user", 6000), (error) => error.statusCode === 429);
  database.close();
});

test("resets expired counters", () => {
  const database = db();
  for (let i = 0; i < SHARE_RATE_USER_MAX; i++) enforceShareRateLimit(database, { ip: "203.0.113.4" }, "user-c", 10000 + i);
  assert.doesNotThrow(() => enforceShareRateLimit(database, { ip: "203.0.113.4" }, "user-c", 10000 + SHARE_RATE_WINDOW_MS + 1));
  database.close();
});
