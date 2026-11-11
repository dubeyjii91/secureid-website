import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/server.js", import.meta.url), "utf8");

test("all owner administration API responses are private and non-cacheable", () => {
  const middleware = source.indexOf('app.use("/api/admin", (req, res, next) => {');
  const firstAdminRoute = source.indexOf('app.get("/api/admin/users"');
  assert.notEqual(middleware, -1, "admin no-store middleware must exist");
  assert.ok(firstAdminRoute > middleware, "admin no-store middleware must precede admin routes");
  const block = source.slice(middleware, firstAdminRoute);
  assert.match(block, /Cache-Control", "private, no-store, max-age=0"/);
  assert.match(block, /Pragma", "no-cache"/);
});

for (const [label, route] of [
  ["account export", 'app.get("/api/account/export"'],
  ["account deletion", 'app.delete("/api/account"']
]) {
  test(`${label} responses are private and non-cacheable before processing`, () => {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `${label} route must exist`);
    const handler = source.indexOf("=>{", start);
    assert.notEqual(handler, -1, `${label} handler must exist`);
    const firstTry = source.indexOf("try{", handler);
    const cacheHeader = source.indexOf('res.setHeader("Cache-Control", "private, no-store, max-age=0")', handler);
    const pragmaHeader = source.indexOf('res.setHeader("Pragma", "no-cache")', handler);
    assert.ok(firstTry > handler, `${label} processing block must exist`);
    assert.ok(cacheHeader > handler && cacheHeader < firstTry, `${label} must disable caching before processing`);
    assert.ok(pragmaHeader > handler && pragmaHeader < firstTry, `${label} must set legacy no-cache header before processing`);
  });
}
