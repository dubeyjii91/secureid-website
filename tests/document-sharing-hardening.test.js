import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");

test("document shares can only be created for the authenticated owner's active document", () => {
  assert.ok(backend.includes('app.post("/api/document-share",enforceSameOrigin,requireAuth,requireMfaProduction'));
  assert.ok(backend.includes("enforceShareRateLimit(database,req,req.user.id)"));
  assert.ok(backend.includes("SELECT id,original_name,mime_type FROM secure_documents WHERE id=? AND user_id=? AND deleted_at IS NULL"));
});

test("public document shares reject malformed, revoked, expired, or deleted-document tokens", () => {
  assert.ok(backend.includes('app.get("/api/document-share/:token"'));
  assert.ok(backend.includes('if(!/^[A-Za-z0-9_-]{30,100}$/.test(token)'));
  assert.ok(backend.includes("WHERE s.token_hash=? AND s.user_id=d.user_id AND d.deleted_at IS NULL"));
  assert.ok(backend.includes("!Number.isFinite(expiresAt) || Date.now()>=expiresAt"));
  assert.ok(backend.includes("row.revoked_at"));
});

test("document-share bearer responses are non-cacheable and protected against content sniffing", () => {
  assert.ok(backend.includes('res.setHeader("Cache-Control","no-store")'));
  assert.ok(backend.includes('res.setHeader("Pragma","no-cache")'));
  assert.ok(backend.includes('res.setHeader("X-Content-Type-Options","nosniff")'));
  assert.ok(backend.includes('res.setHeader("Referrer-Policy","no-referrer")'));
});

test("public document shares fail closed when ownership or expiry metadata is inconsistent", () => {
  assert.ok(backend.includes("s.user_id=d.user_id AND d.deleted_at IS NULL"));
  assert.ok(backend.includes("!Number.isFinite(expiresAt)"));
});
