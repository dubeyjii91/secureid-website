import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");

test("identity share route passes the database and request to persistent rate limiting", () => {
  assert.match(source, /app\.post\("\/api\/wallet\/share"[\s\S]*?enforceShareRateLimit\(database,\s*req,\s*req\.user\.id\)/);
  assert.doesNotMatch(source, /enforceShareRateLimit\(req,\s*req\.user\.id\)/);
});
