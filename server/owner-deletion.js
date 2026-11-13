import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const AUDIT_TABLES = new Set([
  "admin_audit_log",
  "admin_document_access_audit",
  "hostel_application_audit",
  "institution_audit_log"
]);
const OWNED_COLUMNS = ["user_id", "student_user_id", "owner_user_id"];
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error("Unsafe database identifier.");
  return '"' + value + '"';
}

function getUser(database, userId) {
  return database.prepare("SELECT id,email,role,created_at AS createdAt FROM users WHERE id=?").get(userId);
}

function getAccountInventory(database, userId) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const records = [];
  for (const { name } of tables) {
    if (AUDIT_TABLES.has(name) || name === "users") continue;
    const columns = database.prepare("PRAGMA table_info(" + quoteIdentifier(name) + ")").all().map((item) => item.name);
    for (const column of OWNED_COLUMNS) {
      if (!columns.includes(column)) continue;
      const count = Number(database.prepare("SELECT COUNT(*) AS total FROM " + quoteIdentifier(name) + " WHERE " + quoteIdentifier(column) + "=?").get(userId).total || 0);
      if (count) records.push({ table: name, column, count });
    }
  }
  return records;
}

function getRestrictiveReferences(database, userId) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const blockers = [];
  for (const { name } of tables) {
    if (name === "users" || AUDIT_TABLES.has(name)) continue;
    const foreignKeys = database.prepare("PRAGMA foreign_key_list(" + quoteIdentifier(name) + ")").all();
    for (const fk of foreignKeys) {
      if (fk.table !== "users") continue;
      const count = Number(database.prepare("SELECT COUNT(*) AS total FROM " + quoteIdentifier(name) + " WHERE " + quoteIdentifier(fk.from) + "=?").get(userId).total || 0);
      if (count && !OWNED_COLUMNS.includes(fk.from)) blockers.push({ table: name, column: fk.from, count, onDelete: fk.on_delete });
    }
  }
  return blockers;
}

export function registerOwnerDeletion({ app, database, requireAuth, requireMfa, requireOwner, enforceSameOrigin, logEvent }) {
  const ownerEmail = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const requireConfiguredOwner = (req, res, next) => {
    if (!ownerEmail || req.user?.email?.toLowerCase() !== ownerEmail || req.user?.role !== "owner") {
      return res.status(403).json({ success: false, message: "Configured Owner identity is required." });
    }
    next();
  };

  app.get("/api/admin/users/:userId/details", requireAuth, requireMfa, requireOwner, requireConfiguredOwner, (req, res) => {
    const user = getUser(database, String(req.params.userId || "").trim());
    if (!user) return res.status(404).json({ success: false, message: "Account not found." });
    const protectedOwner = user.role === "owner" || user.email.toLowerCase() === ownerEmail;
    const records = getAccountInventory(database, user.id);
    const blockers = getRestrictiveReferences(database, user.id);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      success: true,
      user: { ...user, protectedOwner },
      inventory: records,
      totalRelatedRecords: records.reduce((sum, item) => sum + item.count, 0),
      deletionAllowed: !protectedOwner && blockers.length === 0,
      blockers
    });
  });

  app.delete("/api/admin/users/:userId", enforceSameOrigin, requireAuth, requireMfa, requireOwner, requireConfiguredOwner, (req, res) => {
    const targetId = String(req.params.userId || "").trim();
    const confirmationEmail = String(req.body?.confirmationEmail || "").trim().toLowerCase();
    const confirmationPhrase = String(req.body?.confirmationPhrase || "").trim();
    const user = getUser(database, targetId);
    if (!user) return res.status(404).json({ success: false, message: "Account not found." });
    if (user.role === "owner" || user.email.toLowerCase() === ownerEmail || user.email.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(403).json({ success: false, code: "OWNER_PROTECTED", message: "The configured Owner account is permanently protected from deletion." });
    }
    if (confirmationEmail !== user.email.toLowerCase() || confirmationPhrase !== "DELETE " + user.email) {
      return res.status(400).json({ success: false, message: "Exact email and DELETE confirmation phrase are required." });
    }

    const blockers = getRestrictiveReferences(database, user.id);
    if (blockers.length) {
      return res.status(409).json({
        success: false,
        code: "DEPENDENCY_REVIEW_REQUIRED",
        message: "Account has dependent institution or operational records. Resolve these dependencies before deletion.",
        blockers
      });
    }

    const inventory = getAccountInventory(database, user.id);
    const documentRows = database.prepare("SELECT encrypted_path FROM secure_documents WHERE user_id=?").all(user.id);
    const now = Date.now();
    const auditId = randomUUID();
    try {
      database.exec("BEGIN IMMEDIATE");
      for (const item of inventory) {
        if (AUDIT_TABLES.has(item.table)) continue;
        database.prepare("DELETE FROM " + quoteIdentifier(item.table) + " WHERE " + quoteIdentifier(item.column) + "=?").run(user.id);
      }
      database.prepare("DELETE FROM users WHERE id=?").run(user.id);
      database.prepare("INSERT INTO admin_audit_log (id,actor_user_id,actor_email,action,target_user_id,target_email,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(auditId, req.user.id, req.user.email, "USER_PERMANENTLY_DELETED", user.id, user.email, JSON.stringify({ relatedRecordsRemoved: inventory.reduce((sum, item) => sum + item.count, 0) }), now);
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      return res.status(409).json({
        success: false,
        code: "DELETE_ROLLED_BACK",
        message: "Deletion was safely rolled back because a database dependency prevented a complete cleanup. No partial account deletion was committed."
      });
    }

    const dataRoot = path.resolve(process.env.DOCUMENT_STORAGE_PATH || (process.env.NODE_ENV === "production" ? "/data/secureid-documents" : path.join(process.cwd(), "data", "secureid-documents")));
    let filesRemoved = 0;
    for (const row of documentRows) {
      const candidate = path.resolve(String(row.encrypted_path || ""));
      if (candidate.startsWith(dataRoot + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        try { fs.unlinkSync(candidate); filesRemoved += 1; } catch {}
      }
    }
    try { logEvent(user.id, "ACCOUNT_PERMANENTLY_DELETED_BY_OWNER", req, { targetEmail: user.email, relatedRecordsRemoved: inventory.reduce((sum, item) => sum + item.count, 0), filesRemoved }); } catch {}
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      success: true,
      deletedUserId: user.id,
      deletedEmail: user.email,
      relatedRecordsRemoved: inventory.reduce((sum, item) => sum + item.count, 0),
      encryptedFilesRemoved: filesRemoved,
      auditId,
      message: "Account and eligible user-owned records deleted. Administrative audit history retained."
    });
  });
}
