import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const categories = new Set(["institution_subscription", "admission_service_fee", "premium_storage", "sponsorship", "other"]);
const statuses = new Set(["pending", "paid", "void"]);
const clean = (value, max = 180) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ success: false, message });

const draftPlans = [
  { key: "pilot", name: "Pilot", monthlyPaise: 0, annualPaise: 0, status: "free_pilot", note: "Free pilot; no automatic renewal or charge." },
  { key: "starter", name: "Starter", monthlyPaise: 299900, annualPaise: 2999000, status: "draft", note: "Proposed price only; requires a signed institution agreement." },
  { key: "growth", name: "Growth", monthlyPaise: 599900, annualPaise: 5999000, status: "draft", note: "Proposed price only; requires a signed institution agreement." },
  { key: "enterprise", name: "Enterprise", monthlyPaise: null, annualPaise: null, status: "custom_quote", note: "Custom quote; no payment collection enabled." }
];

export function registerSecureIdMonetization({ app, database, requireAuth, requireMfaProduction, enforceSameOrigin }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS secureid_financial_entries (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('institution_subscription','admission_service_fee','premium_storage','sponsorship','other')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','void')),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
      institution_id TEXT REFERENCES institutions(id) ON DELETE SET NULL,
      student_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reference TEXT,
      description TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_secureid_financial_entries_created ON secureid_financial_entries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_secureid_financial_entries_status ON secureid_financial_entries(status,category);
    CREATE TABLE IF NOT EXISTS secureid_sponsorships (
      id TEXT PRIMARY KEY,
      sponsor_name TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      placement_label TEXT NOT NULL DEFAULT 'Sponsored',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','ended')),
      starts_at TEXT,
      ends_at TEXT,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_secureid_sponsorships_status ON secureid_sponsorships(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS secureid_monetization_audit (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  function ownerOnly(req, res, next) {
    if (req.user?.role !== "owner") return fail(res, 403, "SecureID Owner access is required.");
    if (!req.user?.mfaVerified) return fail(res, 403, "Verified MFA is required.");
    next();
  }

  function audit(actor, action, type, entityId, details = {}) {
    database.prepare("INSERT INTO secureid_monetization_audit(id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id(), actor, action, type, entityId || null, JSON.stringify(details), now());
  }

  app.get("/api/admin/monetization/overview", requireAuth, ownerOnly, (req, res, next) => {
    try {
      const totals = database.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status='paid' THEN amount_paise ELSE 0 END),0) AS paidPaise,
          COALESCE(SUM(CASE WHEN status='pending' THEN amount_paise ELSE 0 END),0) AS pendingPaise,
          COUNT(*) AS entryCount,
          SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paidCount
        FROM secureid_financial_entries
      `).get();
      const byCategory = database.prepare(`
        SELECT category,
          COALESCE(SUM(CASE WHEN status='paid' THEN amount_paise ELSE 0 END),0) AS paidPaise,
          COALESCE(SUM(CASE WHEN status='pending' THEN amount_paise ELSE 0 END),0) AS pendingPaise,
          COUNT(*) AS count
        FROM secureid_financial_entries GROUP BY category ORDER BY category
      `).all();
      const storage = database.prepare("SELECT COUNT(*) AS documents,COALESCE(SUM(size_bytes),0) AS bytes FROM secure_documents WHERE deleted_at IS NULL").get();
      const sponsorships = database.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM secureid_sponsorships").get();
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        success: true,
        billingMode: "manual_ledger_only",
        livePaymentsEnabled: false,
        plans: draftPlans,
        totals: {
          paidPaise: Number(totals.paidPaise || 0),
          pendingPaise: Number(totals.pendingPaise || 0),
          entryCount: Number(totals.entryCount || 0),
          paidCount: Number(totals.paidCount || 0)
        },
        byCategory: byCategory.map(row => ({ ...row, paidPaise: Number(row.paidPaise), pendingPaise: Number(row.pendingPaise), count: Number(row.count) })),
        storage: { documents: Number(storage.documents || 0), bytes: Number(storage.bytes || 0) },
        sponsorships: { total: Number(sponsorships.total || 0), active: Number(sponsorships.active || 0) }
      });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/monetization/entries", requireAuth, ownerOnly, (req, res, next) => {
    try {
      const rows = database.prepare(`
        SELECT e.id,e.category,e.status,e.amount_paise AS amountPaise,e.currency,
          e.institution_id AS institutionId,i.name AS institutionName,
          e.student_user_id AS studentUserId,u.email AS studentEmail,
          e.reference,e.description,e.created_at AS createdAt,e.paid_at AS paidAt
        FROM secureid_financial_entries e
        LEFT JOIN institutions i ON i.id=e.institution_id
        LEFT JOIN users u ON u.id=e.student_user_id
        ORDER BY e.created_at DESC LIMIT 250
      `).all();
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, entries: rows });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/monetization/entries", enforceSameOrigin, requireAuth, ownerOnly, (req, res, next) => {
    try {
      const category = clean(req.body?.category, 40);
      const status = clean(req.body?.status || "pending", 20);
      const amountPaise = Number(req.body?.amountPaise);
      const institutionId = clean(req.body?.institutionId, 128) || null;
      const studentUserId = clean(req.body?.studentUserId, 128) || null;
      const reference = clean(req.body?.reference, 120) || null;
      const description = clean(req.body?.description, 240);
      const idempotencyKey = clean(req.body?.idempotencyKey, 120);
      if (!categories.has(category) || !statuses.has(status) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 100000000000 || !description || !/^[A-Za-z0-9_-]{12,120}$/.test(idempotencyKey)) {
        return fail(res, 400, "Enter a valid category, status, amount in paise, description and unique idempotency key.");
      }
      if (institutionId && !database.prepare("SELECT 1 FROM institutions WHERE id=?").get(institutionId)) return fail(res, 404, "Institution was not found.");
      if (studentUserId && !database.prepare("SELECT 1 FROM users WHERE id=?").get(studentUserId)) return fail(res, 404, "Student account was not found.");
      const entryId = id(), timestamp = now();
      database.prepare(`
        INSERT INTO secureid_financial_entries
          (id,category,status,amount_paise,currency,institution_id,student_user_id,reference,description,idempotency_key,created_by,created_at,paid_at)
        VALUES(?,?,?,?, 'INR',?,?,?,?,?,?,?,?)
      `).run(entryId, category, status, amountPaise, institutionId, studentUserId, reference, description, idempotencyKey, req.user.id, timestamp, status === "paid" ? timestamp : null);
      audit(req.user.id, "financial_entry_created", "financial_entry", entryId, { category, status, amountPaise, institutionId });
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({ success: true, entry: { id: entryId, category, status, amountPaise, currency: "INR", institutionId, studentUserId, reference, description, createdAt: timestamp, paidAt: status === "paid" ? timestamp : null } });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed")) return fail(res, 409, "This ledger entry has already been recorded (duplicate idempotency key).");
      next(error);
    }
  });

  app.patch("/api/admin/monetization/entries/:entryId", enforceSameOrigin, requireAuth, ownerOnly, (req, res, next) => {
    try {
      const entryId = clean(req.params.entryId, 128);
      const status = clean(req.body?.status, 20);
      if (!["paid", "void"].includes(status)) return fail(res, 400, "A pending entry can only be marked paid or void.");
      const row = database.prepare("SELECT id,status,category,amount_paise FROM secureid_financial_entries WHERE id=?").get(entryId);
      if (!row) return fail(res, 404, "Ledger entry was not found.");
      if (row.status !== "pending") return fail(res, 409, "Only pending ledger entries can be updated.");
      const timestamp = now();
      const changed = database.prepare("UPDATE secureid_financial_entries SET status=?,paid_at=? WHERE id=? AND status='pending'")
        .run(status, status === "paid" ? timestamp : null, entryId);
      if (changed.changes !== 1) return fail(res, 409, "Ledger entry was updated by another request.");
      audit(req.user.id, "financial_entry_" + status, "financial_entry", entryId, { category: row.category, amountPaise: Number(row.amount_paise) });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, status });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/monetization/sponsorships", requireAuth, ownerOnly, (req, res, next) => {
    try {
      const sponsorships = database.prepare(`
        SELECT id,sponsor_name AS sponsorName,campaign_name AS campaignName,
          placement_label AS placementLabel,status,starts_at AS startsAt,ends_at AS endsAt,
          notes,created_at AS createdAt,updated_at AS updatedAt
        FROM secureid_sponsorships ORDER BY created_at DESC LIMIT 200
      `).all();
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, sponsorships });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/monetization/sponsorships", enforceSameOrigin, requireAuth, ownerOnly, (req, res, next) => {
    try {
      const sponsorName = clean(req.body?.sponsorName, 120);
      const campaignName = clean(req.body?.campaignName, 120);
      const placementLabel = clean(req.body?.placementLabel || "Sponsored", 40);
      const startsAt = req.body?.startsAt ? clean(req.body.startsAt, 40) : null;
      const endsAt = req.body?.endsAt ? clean(req.body.endsAt, 40) : null;
      const notes = clean(req.body?.notes, 500) || null;
      const status = clean(req.body?.status || "draft", 20);
      if (!sponsorName || !campaignName || !placementLabel || !["draft", "active", "paused", "ended"].includes(status)) return fail(res, 400, "Enter a sponsor, campaign, clear sponsored label and valid status.");
      if (startsAt && !Number.isFinite(Date.parse(startsAt)) || endsAt && !Number.isFinite(Date.parse(endsAt)) || startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return fail(res, 400, "Enter a valid sponsorship date range.");
      const sponsorshipId = id(), timestamp = now();
      database.prepare("INSERT INTO secureid_sponsorships(id,sponsor_name,campaign_name,placement_label,status,starts_at,ends_at,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(sponsorshipId, sponsorName, campaignName, placementLabel, status, startsAt, endsAt, notes, req.user.id, timestamp, timestamp);
      audit(req.user.id, "sponsorship_created", "sponsorship", sponsorshipId, { sponsorName, campaignName, status });
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({ success: true, sponsorship: { id: sponsorshipId, sponsorName, campaignName, placementLabel, status, startsAt, endsAt, notes, createdAt: timestamp, updatedAt: timestamp } });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/monetization/sponsorships/:sponsorshipId", enforceSameOrigin, requireAuth, ownerOnly, (req, res, next) => {
    try {
      const sponsorshipId = clean(req.params.sponsorshipId, 128);
      const status = clean(req.body?.status, 20);
      if (!["draft", "active", "paused", "ended"].includes(status)) return fail(res, 400, "Choose a valid sponsorship status.");
      const row = database.prepare("SELECT id,status FROM secureid_sponsorships WHERE id=?").get(sponsorshipId);
      if (!row) return fail(res, 404, "Sponsorship was not found.");
      database.prepare("UPDATE secureid_sponsorships SET status=?,updated_at=? WHERE id=?").run(status, now(), sponsorshipId);
      audit(req.user.id, "sponsorship_" + status, "sponsorship", sponsorshipId, { fromStatus: row.status, toStatus: status });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, status });
    } catch (error) { next(error); }
  });
}
