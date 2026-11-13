import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const TARGETS = [
  "RVS College of Engineering and Technology",
  "SecureID Test College"
];
function normalizeInstitutionName(value) {\n  return String(value || "").normalize("NFKD").replace(/[&]/g, " and ").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase().replace(/\\s+/g, " ");\n}\nconst TARGET_KEYS = new Set(TARGETS.map(normalizeInstitutionName));
const PROTECTED_TABLES = new Set([
  "users", "admin_audit_log", "sqlite_sequence", "subscription_plans",
  "plan_catalog", "pricing_plans", "monetization_plans", "feature_catalog",
  "role_catalog", "permission_catalog", "schema_migrations"
]);
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CHUNK_SIZE = 400;

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error("Unsafe database identifier.");
  return '"' + value + '"';
}

function chunks(values, size = CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function verifyEncryptedBackup(filePath) {
  const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) throw new Error("Backup encryption key is not configured.");
  const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (envelope?.version !== 2 || typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" || typeof envelope.data !== "string" ||
      typeof envelope.sha256 !== "string") {
    throw new Error("A complete version-2 encrypted database and document backup is required.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]);
  const digest = createHash("sha256").update(plaintext).digest("hex");
  if (digest !== envelope.sha256) throw new Error("Encrypted backup integrity hash did not match.");
  const snapshot = JSON.parse(plaintext.toString("utf8"));
  if (snapshot?.version !== 2 || typeof snapshot.database !== "string" || !Array.isArray(snapshot.documents)) {
    throw new Error("Encrypted backup is missing the database or document inventory.");
  }
  const databaseBytes = Buffer.from(snapshot.database, "base64");
  if (!databaseBytes.length || databaseBytes.toString("base64") !== snapshot.database) {
    throw new Error("Encrypted backup database payload is invalid.");
  }
  const seenDocuments = new Set();
  for (const item of snapshot.documents) {
    if (!item || typeof item.name !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i.test(item.name) ||
        typeof item.data !== "string" || seenDocuments.has(item.name)) {
      throw new Error("Encrypted backup document inventory is invalid.");
    }
    const bytes = Buffer.from(item.data, "base64");
    if (bytes.toString("base64") !== item.data) throw new Error("Encrypted backup contains an invalid document blob.");
    seenDocuments.add(item.name);
  }

  // Perform an isolated restore validation: decrypt into a private temporary
  // SQLite file, open it read-only, and run both integrity and FK checks.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "secureid-restore-check-"));
  const tempDbPath = path.join(tempDir, "restore-check.sqlite");
  try {
    fs.writeFileSync(tempDbPath, databaseBytes, { mode: 0o600, flag: "wx" });
    const restored = new DatabaseSync(tempDbPath, { readOnly: true });
    try {
      const integrity = restored.prepare("PRAGMA integrity_check").all();
      if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
        throw new Error("Isolated backup restore failed SQLite integrity_check.");
      }
      const foreignKeyErrors = restored.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyErrors.length) throw new Error("Isolated backup restore found unresolved foreign-key references.");
      const tableCount = Number(restored.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().total || 0);
      if (!tableCount) throw new Error("Isolated backup restore did not contain the SecureID schema.");
    } finally {
      restored.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return { sha256: digest, documentBlobsVerified: seenDocuments.size };
}

export function buildInstitutionInventory(database) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const metadata = new Map();
  for (const table of tables) {
    const identifier = quoteIdentifier(table);
    const columns = database.prepare("PRAGMA table_info(" + identifier + ")").all();
    const primaryKey = columns.filter((column) => Number(column.pk) > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    metadata.set(table, {
      columns: new Set(columns.map((column) => column.name)),
      primaryKey,
      foreignKeys: database.prepare("PRAGMA foreign_key_list(" + identifier + ")").all()
    });
  }

  const institutions = database.prepare(
    "SELECT id,name FROM institutions WHERE lower(trim(name)) IN (?,?) ORDER BY name COLLATE NOCASE"
  ).all(...[...TARGET_KEYS]);
  const foundKeys = new Set(institutions.map((row) => String(row.name).trim().toLowerCase()));
  const missingTargets = TARGETS.filter((name) => !foundKeys.has(name.toLowerCase()));
  const selected = new Map();
  const queue = [];
  const unsupported = new Set();

  function addRows(table, rows, ownerInstitutionId) {
    if (!rows.length) return;
    if (!selected.has(table)) selected.set(table, { rowids: new Set(), primaryValues: new Set(), ownerByRowid: new Map() });
    const entry = selected.get(table);
    for (const row of rows) {
      const rowid = Number(row.__rowid);
      if (!Number.isSafeInteger(rowid)) continue;
      const existingOwner = entry.ownerByRowid.get(rowid);
      if (existingOwner && existingOwner !== ownerInstitutionId) {
        unsupported.add(table + " (row is shared across approved institutions)");
        continue;
      }
      if (entry.rowids.has(rowid)) continue;
      entry.rowids.add(rowid);
      if (row.__primary !== undefined) entry.primaryValues.add(row.__primary);
      entry.ownerByRowid.set(rowid, ownerInstitutionId);
      queue.push({ table, rowids: [rowid], ownerInstitutionId });
    }
  }

  const institutionsById = new Map(institutions.map((row) => [row.id, row.name]));
  const institutionMeta = metadata.get("institutions");
  if (!institutionMeta?.primaryKey.includes("id")) {
    throw new Error("Institution table primary key could not be safely resolved.");
  }
  for (const institution of institutions) {
    const root = database.prepare("SELECT rowid FROM institutions WHERE id=?").get(institution.id);
    addRows("institutions", [{ __rowid: root.rowid, __primary: institution.id }], institution.id);
  }

  for (const table of tables) {
    if (PROTECTED_TABLES.has(table) || table === "institutions") continue;
    const meta = metadata.get(table);
    if (!meta.columns.has("institution_id")) continue;
    for (const institutionId of institutionsById.keys()) {
      const rows = database.prepare(
        "SELECT rowid AS __rowid FROM " + quoteIdentifier(table) + " WHERE institution_id=?"
      ).all(institutionId);
      addRows(table, rows, institutionId);
    }
  }

  // The manual monetization ledger keeps its audit target polymorphically
  // (entity_type/entity_id), so SQLite FK traversal cannot discover these rows.
  // Scope only financial-entry audit rows whose ledger entry belongs to a target.
  if (selected.has("secureid_financial_entries") && metadata.has("secureid_monetization_audit")) {
    const financialRows = selected.get("secureid_financial_entries");
    for (const batch of chunks([...financialRows.rowids])) {
      const placeholders = batch.map(() => "?").join(",");
      const entries = database.prepare(
        "SELECT rowid,id FROM secureid_financial_entries WHERE rowid IN (" + placeholders + ")"
      ).all(...batch);
      for (const entry of entries) {
        const ownerInstitutionId = financialRows.ownerByRowid.get(Number(entry.rowid));
        const auditRows = database.prepare(
          "SELECT rowid AS __rowid FROM secureid_monetization_audit WHERE entity_type='financial_entry' AND entity_id=?"
        ).all(entry.id);
        addRows("secureid_monetization_audit", auditRows, ownerInstitutionId);
      }
    }
  }

  while (queue.length) {
    const event = queue.shift();
    const parentMeta = metadata.get(event.table);
    const children = [];
    for (const childTable of tables) {
      if (PROTECTED_TABLES.has(childTable)) continue;
      const childMeta = metadata.get(childTable);
      const groups = new Map();
      for (const fk of childMeta.foreignKeys) {
        if (fk.table !== event.table) continue;
        if (!groups.has(fk.id)) groups.set(fk.id, []);
        groups.get(fk.id).push(fk);
      }
      for (const group of groups.values()) {
        children.push({ table: childTable, fks: group.sort((a, b) => a.seq - b.seq) });
      }
    }
    for (const child of children) {
      const childMeta = metadata.get(child.table);
      const parentColumns = child.fks.map((fk, index) => {
        const referenced = fk.to || parentMeta.primaryKey[index];
        if (!referenced || !parentMeta.columns.has(referenced)) {
          unsupported.add(child.table + " (unresolved referenced key in " + event.table + ")");
          return null;
        }
        return referenced;
      });
      if (parentColumns.some((column) => !column)) continue;
      const parentRows = [];
      for (const rowidBatch of chunks(event.rowids)) {
        const selectColumns = parentColumns.map((column, index) => quoteIdentifier(column) + " AS __fk" + index).join(",");
        const placeholders = rowidBatch.map(() => "?").join(",");
        parentRows.push(...database.prepare(
          "SELECT rowid AS __rowid," + selectColumns + " FROM " + quoteIdentifier(event.table) +
          " WHERE rowid IN (" + placeholders + ")"
        ).all(...rowidBatch));
      }
      const childRows = [];
      const whereClause = child.fks.map((fk) => quoteIdentifier(fk.from) + "=?").join(" AND ");
      for (const parentRow of parentRows) {
        const values = parentColumns.map((_, index) => parentRow["__fk" + index]);
        if (values.some((value) => value === null || value === undefined)) continue;
        const institutionColumn = childMeta.columns.has("institution_id") ? ", institution_id AS __institution_id" : "";
        childRows.push(...database.prepare(
          "SELECT rowid AS __rowid" + institutionColumn + " FROM " + quoteIdentifier(child.table) +
          " WHERE " + whereClause
        ).all(...values));
      }
      const eligibleRows = childRows.filter((row) => {
        if (!childMeta.columns.has("institution_id") || row.__institution_id === event.ownerInstitutionId) return true;
        unsupported.add(child.table + " (indirect row belongs to a different institution)");
        return false;
      });
      addRows(child.table, eligibleRows, event.ownerInstitutionId);
    }
  }

  const categoryRules = [
    ["Audit and security history", /audit|security_event|security_notification|history/],
    ["Memberships and subscriptions", /membership|subscription|institution_staff|role_grant/],
    ["Admissions and student records", /admission|student_profile|student|attendance|assessment|course|academic/],
    ["Hostel operations", /hostel|bed_alloc|room|building/],
    ["Fees and payments", /fee|payment|invoice|monetization/],
    ["Scholarships", /scholarship/],
    ["Documents and reviews", /document|review|identity/],
    ["Notifications and sessions", /notification|session|verification|otp|trusted_device|share/]
  ];
  const tableCounts = [...selected.entries()]
    .map(([table, entry]) => ({ table, count: entry.rowids.size }))
    .filter((item) => item.count > 0)
    .sort((a, b) => a.table.localeCompare(b.table));
  const categoryTotals = new Map();
  for (const item of tableCounts) {
    const category = categoryRules.find(([, pattern]) => pattern.test(item.table))?.[0] || "Other institution records";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + item.count);
  }

  // Reverse FK dependency order: all discovered child rows are removed before
  // their selected parents. Deferred FK checking protects multi-table cycles.
  const childTablesByParent = new Map();
  for (const table of tables) {
    if (PROTECTED_TABLES.has(table)) continue;
    for (const fk of metadata.get(table).foreignKeys) {
      if (!selected.has(table) || !selected.has(fk.table)) continue;
      if (!childTablesByParent.has(fk.table)) childTablesByParent.set(fk.table, new Set());
      childTablesByParent.get(fk.table).add(table);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const deleteOrder = [];
  function visit(table) {
    if (visited.has(table) || visiting.has(table)) return;
    visiting.add(table);
    for (const child of childTablesByParent.get(table) || []) visit(child);
    visiting.delete(table);
    visited.add(table);
    deleteOrder.push(table);
  }
  for (const table of selected.keys()) visit(table);

  const categoriesForRows = (counts) => {
    const totals = new Map();
    for (const item of counts) {
      const category = categoryRules.find(([, pattern]) => pattern.test(item.table))?.[0] || "Other institution records";
      totals.set(category, (totals.get(category) || 0) + item.count);
    }
    return [...totals.entries()].map(([category, count]) => ({ category, count }));
  };
  const institutionBreakdown = institutions.map((institution) => {
    const tablesForInstitution = [...selected.entries()]
      .map(([table, entry]) => ({
        table,
        count: [...entry.ownerByRowid.entries()].filter(([, ownerId]) => ownerId === institution.id).length
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => a.table.localeCompare(b.table));
    return {
      id: institution.id,
      name: institution.name,
      tables: tablesForInstitution,
      categories: categoriesForRows(tablesForInstitution),
      totalRecords: tablesForInstitution.reduce((sum, item) => sum + item.count, 0)
    };
  });
  const previewData = {
    targets: institutions.map((row) => ({ id: row.id, name: row.name })),
    rows: [...selected.entries()].map(([table, entry]) => [table, [...entry.rowids].sort((a, b) => a - b), [...entry.ownerByRowid.entries()].sort((a, b) => a[0] - b[0])]).sort((a, b) => a[0].localeCompare(b[0]))
  };
  return {
    institutions: institutionBreakdown,
    missingTargets,
    unsupported: [...unsupported].sort(),
    tableCounts,
    categories: categoriesForRows(tableCounts),
    totalRecords: tableCounts.reduce((sum, item) => sum + item.count, 0),
    previewHash: stableHash(previewData),
    selected,
    deleteOrder
  };
}

export function registerTestInstitutionCleanup({ app, database, requireAuth, requireMfa, requireOwner, enforceSameOrigin, runEncryptedBackup }) {
  const ownerEmail = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const requireConfiguredOwner = (req, res, next) => {
    if (!ownerEmail || req.user?.email?.toLowerCase() !== ownerEmail || req.user?.role !== "owner") {
      return res.status(403).json({ success: false, message: "Configured Owner identity is required." });
    }
    next();
  };

  app.get("/api/admin/test-institution-cleanup/preview", requireAuth, requireMfa, requireOwner, requireConfiguredOwner, (_req, res) => {
    try {
      const inventory = buildInstitutionInventory(database);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        success: true,
        protectedOwnerEmail: ownerEmail,
        protectedTables: [...PROTECTED_TABLES],
        institutions: inventory.institutions,
        missingTargets: inventory.missingTargets,
        unsupportedRelationships: inventory.unsupported,
        tableCounts: inventory.tableCounts,
        categories: inventory.categories,
        totalRecords: inventory.totalRecords,
        previewHash: inventory.previewHash,
        note: "Read-only recursive inventory. Includes indirect FK children such as test payments and audit rows. User accounts, Owner data, shared plan catalogs, and unrelated institutions are excluded. No records have been changed."
      });
    } catch {
      return res.status(500).json({ success: false, message: "The recursive cleanup inventory could not be completed. No records were changed." });
    }
  });

  app.post("/api/admin/test-institution-cleanup/execute", enforceSameOrigin, requireAuth, requireMfa, requireOwner, requireConfiguredOwner, (req, res) => {
    const confirmationEmail = String(req.body?.confirmationEmail || "").trim().toLowerCase();
    const confirmationPhrase = String(req.body?.confirmationPhrase || "").trim();
    const previewHash = String(req.body?.previewHash || "");
    if (confirmationEmail !== ownerEmail || confirmationPhrase !== "DELETE TEST DATA FOR RVS AND SECUREID TEST COLLEGE" || req.body?.testDataConfirmed !== true) {
      return res.status(400).json({ success: false, message: "Enter the configured Owner email and exact test-data cleanup phrase." });
    }

    let inventory;
    try {
      inventory = buildInstitutionInventory(database);
    } catch {
      return res.status(500).json({ success: false, message: "The live cleanup inventory could not be rechecked. No records were changed." });
    }
    if (inventory.missingTargets.length || inventory.unsupported.length || !previewHash || previewHash !== inventory.previewHash) {
      return res.status(409).json({
        success: false,
        code: "CLEANUP_PREVIEW_STALE_OR_INCOMPLETE",
        message: "Cleanup stopped because the preview changed or an unsupported database relationship was found. Refresh the preview; no records were deleted.",
        missingTargets: inventory.missingTargets,
        unsupportedRelationships: inventory.unsupported
      });
    }
    if (inventory.institutions.length !== TARGETS.length) {
      return res.status(409).json({ success: false, message: "Both explicitly approved test institutions must be present. No records were changed." });
    }
    if (typeof runEncryptedBackup !== "function") {
      return res.status(503).json({ success: false, message: "Fresh encrypted backup creation is unavailable. No records were changed." });
    }

    let backup;
    let backupVerification;
    try {
      backup = runEncryptedBackup();
      backupVerification = verifyEncryptedBackup(backup.file);
    } catch {
      return res.status(503).json({ success: false, code: "BACKUP_RESTORE_VERIFICATION_FAILED", message: "Cleanup was blocked because a fresh encrypted backup could not be created and verified in an isolated restore. No records were changed." });
    }

    const documentPaths = [];
    const secureDocuments = inventory.selected.get("secure_documents");
    if (secureDocuments && secureDocuments.rowids.size) {
      const ids = [...secureDocuments.rowids];
      for (const batch of chunks(ids)) {
        const placeholders = batch.map(() => "?").join(",");
        try {
          documentPaths.push(...database.prepare(
            "SELECT encrypted_path FROM secure_documents WHERE rowid IN (" + placeholders + ")"
          ).all(...batch).map((row) => row.encrypted_path).filter(Boolean));
        } catch {
          // Database rows still remain protected by the transaction; file cleanup is best-effort only.
        }
      }
    }

    let removedRows = 0;
    try {
      database.exec("BEGIN IMMEDIATE");
      database.exec("PRAGMA defer_foreign_keys=ON");
      for (const table of inventory.deleteOrder) {
        const rowids = [...inventory.selected.get(table).rowids];
        for (const batch of chunks(rowids)) {
          const placeholders = batch.map(() => "?").join(",");
          const result = database.prepare(
            "DELETE FROM " + quoteIdentifier(table) + " WHERE rowid IN (" + placeholders + ")"
          ).run(...batch);
          removedRows += Number(result.changes || 0);
        }
      }
      const fkErrors = database.prepare("PRAGMA foreign_key_check").all();
      if (fkErrors.length) throw new Error("Foreign-key validation failed after test institution cleanup.");
      if (database.prepare("SELECT id,name FROM institutions").all().some((row) => TARGET_KEYS.has(normalizeInstitutionName(row.name)))) {
        throw new Error("One or more target institutions still exist after cleanup.");
      }
      database.prepare(
        "INSERT INTO admin_audit_log (id,actor_user_id,actor_email,action,target_user_id,target_email,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).run(
        randomUUID(), req.user.id, req.user.email, "TEST_INSTITUTION_DATA_CLEANUP",
        null, null,
        JSON.stringify({
          institutions: inventory.institutions.map((item) => item.name),
          removedRows,
          tableCounts: inventory.tableCounts,
          backupFile: path.basename(backup.file),
          backupSha256: backupVerification.sha256,
          isolatedRestoreVerified: true,
          ownerAccountPreserved: true,
          userAccountsPreserved: true,
          sharedPlansPreserved: true
        }),
        Date.now()
      );
      database.exec("COMMIT");
    } catch {
      try { database.exec("ROLLBACK"); } catch {}
      return res.status(409).json({ success: false, code: "TEST_INSTITUTION_CLEANUP_ROLLED_BACK", message: "The cleanup transaction was rolled back completely because a dependency or integrity check failed. The verified encrypted backup was retained." });
    }

    const documentRoot = path.resolve(process.env.DOCUMENT_STORAGE_PATH || (process.env.NODE_ENV === "production" ? "/data/secureid-documents" : path.join(process.cwd(), "data", "secureid-documents")));
    let encryptedFilesRemoved = 0;
    for (const rawPath of documentPaths) {
      const raw = String(rawPath);
      const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(documentRoot, raw);
      if (!candidate.startsWith(documentRoot + path.sep) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      const stillReferenced = database.prepare("SELECT 1 FROM secure_documents WHERE encrypted_path=? LIMIT 1").get(rawPath);
      if (stillReferenced) continue;
      try { fs.unlinkSync(candidate); encryptedFilesRemoved += 1; } catch {}
    }

    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      success: true,
      deletedInstitutions: inventory.institutions.map((item) => item.name),
      deletedRows: removedRows,
      tableCounts: inventory.tableCounts,
      encryptedFilesRemoved,
      backupFile: path.basename(backup.file),
      backupSha256: backupVerification.sha256,
      isolatedRestoreVerified: true,
      ownerAccountPreserved: true,
      userAccountsPreserved: true,
      sharedPlansPreserved: true,
      message: "Approved test institution records were removed. Owner and user accounts, shared plan catalogs, and unrelated institutions were preserved."
    });
  });
}
