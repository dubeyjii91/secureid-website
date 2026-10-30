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
  assert.ok(backend.includes('res.setHeader("X-Content-Type-Options","nosniff")'));
  assert.ok(backend.includes('action:"document_download"'));
  assert.ok(backend.includes("admin_document_access_audit"));
});

test("denied owner/MFA checks are audited without granting access", () => {
  assert.ok(backend.includes('outcome:"denied"'));
  assert.ok(backend.includes('return res.status(403).json({success:false,code:"OWNER_REQUIRED"'));
  assert.ok(backend.includes('return res.status(403).json({success:false,code:"MFA_REQUIRED"'));
});

test("missing and deleted documents return not-found and are audited", () => {
  assert.ok(backend.includes('FROM secure_documents WHERE id=? AND deleted_at IS NULL LIMIT 1'));
  assert.ok(backend.includes('outcome:"not_found"'));
  assert.ok(backend.includes('return res.status(404).json({success:false,message:"Document not found."})'));
});

test("listing and download failures create error audit events", () => {
  assert.ok(backend.includes('action:"document_list",outcome:"error"'));
  assert.ok(backend.includes('action:"document_download",documentId:String(req.params.id||"").slice(0,100),outcome:"error"'));
  assert.ok(backend.includes('app.get("/api/admin/document-access-audit",requireAuth,requireOwnerDocumentAccess'));
});

test("owner-only navigation exposes the admin document vault", () => {
  assert.ok(app.includes('import AdminDocumentVault from "./AdminDocumentVault.jsx"'));
  assert.ok(app.includes('["admin-documents", "All user documents", "🗂️"]'));
  assert.ok(app.includes('page === "admin-documents" && sessionRole === "owner"'));
  assert.ok(ui.includes("/api/admin/document-access-audit"));
  assert.ok(ui.includes("/api/admin/documents/"));
});


test("admin document pagination has clear spacing and responsive layout", () => {
  const styles = readFileSync(new URL("../src/secureid-layout-fixes.css", import.meta.url), "utf8");
  assert.match(ui, /className="formActions documentPagination"/);
  assert.match(ui, /aria-label="Document pages"/);
  assert.match(styles, /\.documentPagination\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /#root \.formGrid\s*\{[^}]*gap:\s*14px/s);
  assert.match(styles, /#root \.tableWrap\s*\{[^}]*overflow-x:\s*auto/s);
});
