import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(new URL("../server/production-features.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/AdminDocumentVault.jsx", import.meta.url), "utf8");

test("admin document listing is owner-only, MFA-gated, paginated, and excludes deleted documents", () => {
  assert.ok(backend.includes('app.get("/api/admin/documents",requireAuth,requireOwnerDocumentAccess'));
  assert.ok(backend.includes('if(req.user?.role !== "owner")'));
  assert.ok(backend.includes('if(!req.user?.mfaVerified)'));
  assert.ok(backend.includes("d.deleted_at IS NULL"));
  assert.ok(backend.includes("LIMIT ? OFFSET ?"));
});

test("admin downloads decrypt server-side and are no-store with access auditing", () => {
  assert.ok(backend.includes('app.get("/api/admin/documents/:id/download",requireAuth,requireOwnerDocumentAccess'));
  assert.ok(backend.includes("decryptBuffer(encrypted,key)"));
  assert.ok(backend.includes('res.setHeader("Cache-Control","no-store")'));
  assert.ok(backend.includes('action:"document_download"'));
  assert.ok(backend.includes("admin_document_access_audit"));
});

test("owner-only navigation exposes the admin document vault", () => {
  assert.ok(app.includes('import AdminDocumentVault from "./AdminDocumentVault.jsx"'));
  assert.ok(app.includes('["admin-documents", "All user documents", "🗂️"]'));
  assert.ok(app.includes('page === "admin-documents" && sessionRole === "owner"'));
  assert.ok(ui.includes("/api/admin/document-access-audit"));
  assert.ok(ui.includes("/api/admin/documents/"));
});
