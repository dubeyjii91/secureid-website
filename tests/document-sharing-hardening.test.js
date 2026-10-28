import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");

test("document shares can only be created for the authenticated owner's active document", () => {
  assert.match(backend, /app\\.post\\("\\/api\\/document-share",enforceSameOrigin,requireAuth,requireMfaProduction/);
  assert.match(backend, /enforceShareRateLimit\\(database,req,req\\.user\\.id\\)/);
  assert.match(backend, /SELECT id,original_name,mime_type FROM secure_documents WHERE id=\\? AND user_id=\\? AND deleted_at IS NULL/);
});

test("public document shares reject malformed, revoked, expired, or deleted-document tokens", () => {
  assert.match(backend, /app\\.get\\("\\/api\\/document-share\\/:token"/);
  assert.match(backend, /if\\(!\\/\\^\\[A-Za-z0-9_-\\]\\{30,100\\}\\$\\/\\.test\\(token\\)\\) return res\\.status\\(404\\)/);
  assert.match(backend, /WHERE s\\.token_hash=\\? AND s\\.user_id=d\\.user_id AND d\\.deleted_at IS NULL/);
  assert.match(backend, /!row \\|\\| row\\.revoked_at \\|\\| !Number\\.isFinite\\(expiresAt\\) \\|\\| Date\\.now\\(\\)>=expiresAt/);
});

test("document-share bearer responses are non-cacheable and protected against content sniffing", () => {
  assert.match(backend, /res\\.setHeader\\("Cache-Control","no-store"\\)/);
  assert.match(backend, /res\\.setHeader\\("Pragma","no-cache"\\)/);
  assert.match(backend, /res\\.setHeader\\("X-Content-Type-Options","nosniff"\\)/);
  assert.match(backend, /res\\.setHeader\\("Referrer-Policy","no-referrer"\\)/);
});

test("public document shares fail closed when ownership or expiry metadata is inconsistent", () => {
  assert.match(backend, /s\\.user_id=d\\.user_id AND d\\.deleted_at IS NULL/);
  assert.match(backend, /!Number\\.isFinite\\(expiresAt\\)/);
});
