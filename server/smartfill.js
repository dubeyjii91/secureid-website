import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => Date.now();
const CONFIDENCE_THRESHOLD = 0.85;
const REVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

const FIELDS = new Set([
  "personal.full_name",
  "personal.date_of_birth",
  "personal.age",
  "contact.email",
  "contact.phone",
  "address.full",
  "address.line1",
  "address.line2",
  "address.city",
  "address.state",
  "address.postal_code",
  "address.country",
  "identity.aadhaar",
  "identity.pan",
  "identity.passport",
  "identity.student_id",
  "identity.identity_id",
  "identity.government_id",
  "education.institution",
  "education.course",
  "education.department",
  "education.roll_number",
  "education.admission_year",
  "education.graduation_year",
  "professional.job_title",
  "professional.employer",
  "professional.experience",
]);

const PROFILE = {
  "personal.full_name": "name",
  "personal.date_of_birth": "dateOfBirth",
  "personal.age": "age",
  "contact.email": "email",
  "contact.phone": "phone",
  "address.full": "address",
  "education.institution": "college",
  "identity.student_id": "studentId",
  "identity.identity_id": "identityId",
  "identity.government_id": "governmentId",
};

const clean = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const allowedField = (fieldKey) =>
  FIELDS.has(fieldKey) || /^custom\.[a-z0-9_.-]{1,70}$/i.test(String(fieldKey));

function validateValue(fieldKey, value) {
  const valueText = String(value ?? "").trim();
  if (!valueText) return "Enter a value.";
  if (valueText.length > 500) return "Value is too long.";
  if (fieldKey === "contact.email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueText)) {
    return "Enter a valid email address.";
  }
  if (fieldKey === "contact.phone" && !/^\+?[0-9\s()-]{7,20}$/.test(valueText)) {
    return "Enter a valid phone number.";
  }
  if (fieldKey === "personal.date_of_birth") {
    const date = new Date(valueText);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(valueText) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== valueText
    ) {
      return "Use a valid date in YYYY-MM-DD format.";
    }
  }
  if (fieldKey === "personal.age" && !/^\d{1,3}$/.test(valueText)) {
    return "Enter age in whole years.";
  }
  if (fieldKey === "identity.aadhaar" && !/^\d{12}$/.test(valueText)) {
    return "Aadhaar must contain exactly 12 digits.";
  }
  if (fieldKey === "identity.pan" && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(valueText)) {
    return "Enter a valid PAN format.";
  }
  if (fieldKey === "identity.passport" && !/^[A-Z0-9]{6,12}$/i.test(valueText)) {
    return "Enter a valid passport identifier.";
  }
  if (fieldKey === "address.postal_code" && !/^\d{5,10}$/.test(valueText)) {
    return "Enter a valid postal code.";
  }
  if (
    ["education.admission_year", "education.graduation_year"].includes(fieldKey) &&
    !/^\d{4}$/.test(valueText)
  ) {
    return "Enter a four-digit year.";
  }
  return null;
}

function hashReviewToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token, storedHash) {
  if (typeof token !== "string" || !token || typeof storedHash !== "string") return false;
  const actual = Buffer.from(hashReviewToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function registerSmartFill({
  app,
  database,
  requireAuth,
  enforceSameOrigin,
  encryptValue,
  decryptValue,
  assertWalletUnlocked,
}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS smartfill_consents (
      user_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      consent_version TEXT NOT NULL,
      consented_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY(user_id, form_id)
    );
    CREATE TABLE IF NOT EXISTS smartfill_private_data (
      user_id TEXT PRIMARY KEY,
      encrypted_data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS smartfill_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN (
        'consent_granted','consent_revoked','manual_data_saved',
        'suggestions_viewed','reviewed','submitted'
      )),
      field_keys_json TEXT NOT NULL,
      source_keys_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_smartfill_audit_user
      ON smartfill_audit(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS smartfill_review_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      token_hash TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_smartfill_review_user_form
      ON smartfill_review_sessions(user_id, form_id, created_at DESC);
  `);

  const mfa = (req, res, next) =>
    req.user?.mfaVerified
      ? next()
      : res.status(403).json({
          success: false,
          code: "MFA_REQUIRED",
          message: "MFA verification is required for SmartFill.",
        });

  const audit = (userId, formId, action, fields = [], sources = []) =>
    database
      .prepare("INSERT INTO smartfill_audit VALUES(?,?,?,?,?,?,?)")
      .run(
        id(),
        userId,
        formId,
        action,
        JSON.stringify(fields),
        JSON.stringify(sources),
        now(),
      );

  // When SmartFill has been applied to a native form, its subsequent API
  // mutation must carry the form-scoped review token issued by this server.
  app.use("/api", (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (req.originalUrl.split("?")[0].startsWith("/api/smartfill/")) return next();

    const formIdHeader = req.get("x-secureid-smartfill-form") || "";
    const reviewToken = req.get("x-secureid-smartfill-review") || "";
    if (!formIdHeader && !reviewToken) return next();

    return requireAuth(req, res, () => {
      const formId = clean(formIdHeader, 100);
      if (!formId || !reviewToken || reviewToken.length > 200) {
        return res.status(409).json({
          success: false,
          code: "SMARTFILL_REVIEW_REQUIRED",
          message: "Review the applied SmartFill values again before submitting this form.",
        });
      }

      const session = database
        .prepare(`
          SELECT fields_json, token_hash, reviewed_at
          FROM smartfill_review_sessions
          WHERE user_id=? AND form_id=? AND expires_at>?
          ORDER BY created_at DESC LIMIT 1
        `)
        .get(req.user.id, formId, now());

      if (
        !session ||
        !session.reviewed_at ||
        !tokenMatches(reviewToken, session.token_hash)
      ) {
        return res.status(409).json({
          success: false,
          code: "SMARTFILL_REVIEW_REQUIRED",
          message: "The SmartFill review has expired or changed. Review the current form values before submitting.",
        });
      }

      const submittedFields = JSON.parse(session.fields_json);
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.once("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          audit(req.user.id, formId, "submitted", submittedFields, ["reviewed_suggestions"]);
        }
      });
      return next();
    });
  });

  app.get("/api/smartfill/schema", requireAuth, mfa, (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      success: true,
      consentVersion: "smartfill-v1",
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      fields: [...FIELDS],
    });
  });

  app.post("/api/smartfill/consent", enforceSameOrigin, requireAuth, mfa, (req, res) => {
    const formId = clean(req.body?.formId, 100);
    const fields = Array.isArray(req.body?.fields)
      ? [...new Set(req.body.fields.filter(allowedField))]
      : [];
    const sources = Array.isArray(req.body?.sources)
      ? [...new Set(req.body.sources.filter((source) => ["identity", "manual"].includes(source)))]
      : [];

    if (!formId || !fields.length || !sources.length || req.body?.consent !== true) {
      return res.status(400).json({
        success: false,
        message: "Choose fields and sources, then grant explicit consent.",
      });
    }

    try {
      assertWalletUnlocked(req.user.id);
      const timestamp = now();
      database
        .prepare(`
          INSERT INTO smartfill_consents
            (user_id,form_id,fields_json,sources_json,consent_version,consented_at,revoked_at)
          VALUES(?,?,?,?,?,?,NULL)
          ON CONFLICT(user_id,form_id) DO UPDATE SET
            fields_json=excluded.fields_json,
            sources_json=excluded.sources_json,
            consent_version=excluded.consent_version,
            consented_at=excluded.consented_at,
            revoked_at=NULL
        `)
        .run(
          req.user.id,
          formId,
          JSON.stringify(fields),
          JSON.stringify(sources),
          "smartfill-v1",
          timestamp,
        );
      database
        .prepare("DELETE FROM smartfill_review_sessions WHERE user_id=? AND form_id=?")
        .run(req.user.id, formId);
      audit(req.user.id, formId, "consent_granted", fields, sources);
      return res.json({ success: true, consentedAt: timestamp, fields, sources });
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.statusCode ? error.message : "Could not save SmartFill consent.",
        });
    }
  });

  app.delete("/api/smartfill/consent/:formId", enforceSameOrigin, requireAuth, mfa, (req, res) => {
    const formId = clean(req.params.formId, 100);
    const row = database
      .prepare(`
        SELECT fields_json,sources_json
        FROM smartfill_consents
        WHERE user_id=? AND form_id=? AND revoked_at IS NULL
      `)
      .get(req.user.id, formId);

    if (row) {
      database
        .prepare("UPDATE smartfill_consents SET revoked_at=? WHERE user_id=? AND form_id=?")
        .run(now(), req.user.id, formId);
      database
        .prepare("DELETE FROM smartfill_review_sessions WHERE user_id=? AND form_id=?")
        .run(req.user.id, formId);
      audit(req.user.id, formId, "consent_revoked", JSON.parse(row.fields_json), JSON.parse(row.sources_json));
    }
    return res.json({ success: true, revoked: Boolean(row) });
  });

  app.put("/api/smartfill/data", enforceSameOrigin, requireAuth, mfa, (req, res) => {
    try {
      assertWalletUnlocked(req.user.id);
      const input = req.body?.fields;
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 40) {
        return res.status(400).json({ success: false, message: "Provide up to 40 manual fields." });
      }

      const existing = database
        .prepare("SELECT encrypted_data FROM smartfill_private_data WHERE user_id=?")
        .get(req.user.id);
      const data = existing ? decryptValue(JSON.parse(existing.encrypted_data)) : {};

      for (const [fieldKey, value] of Object.entries(input)) {
        if (!allowedField(fieldKey) || typeof value !== "string" || value.length > 500) {
          return res.status(400).json({ success: false, message: "A manual field is invalid or too long." });
        }
        const validationError = validateValue(fieldKey, value);
        if (validationError) {
          return res.status(400).json({ success: false, fieldKey, message: validationError });
        }
        data[fieldKey] = value.trim();
      }

      database
        .prepare(`
          INSERT INTO smartfill_private_data(user_id,encrypted_data,updated_at)
          VALUES(?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET
            encrypted_data=excluded.encrypted_data,
            updated_at=excluded.updated_at
        `)
        .run(req.user.id, JSON.stringify(encryptValue(data)), now());

      audit(req.user.id, "private-vault", "manual_data_saved", Object.keys(input), ["manual"]);
      return res.json({ success: true, fieldKeys: Object.keys(input) });
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.statusCode ? error.message : "Could not save private SmartFill data.",
        });
    }
  });

  app.get("/api/smartfill/suggestions", requireAuth, mfa, (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const formId = clean(req.query.formId, 100);
    const consent = database
      .prepare(`
        SELECT fields_json,sources_json
        FROM smartfill_consents
        WHERE user_id=? AND form_id=? AND revoked_at IS NULL
      `)
      .get(req.user.id, formId);

    if (!consent) {
      return res.status(403).json({
        success: false,
        code: "SMARTFILL_CONSENT_REQUIRED",
        message: "Grant consent for this form before using SmartFill.",
      });
    }

    try {
      assertWalletUnlocked(req.user.id);
      const keys = JSON.parse(consent.fields_json);
      const sources = JSON.parse(consent.sources_json);
      const suggestions = [];

      if (sources.includes("identity")) {
        const row = database
          .prepare("SELECT encrypted_data FROM identity_profiles WHERE user_id=?")
          .get(req.user.id);
        if (row) {
          const profile = decryptValue(JSON.parse(row.encrypted_data));
          for (const fieldKey of keys) {
            const value = PROFILE[fieldKey] ? profile[PROFILE[fieldKey]] : "";
            if (typeof value === "string" && value.trim()) {
              const validationError = validateValue(fieldKey, value);
              suggestions.push({
                fieldKey,
                value,
                source: "identity_profile",
                status: validationError ? "invalid" : "unverified",
                confidence: validationError ? 0 : 0.9,
                eligible: !validationError,
                note: validationError || "Saved in My Identity; not independently verified.",
              });
            }
          }
        }
      }

      if (sources.includes("manual")) {
        const row = database
          .prepare("SELECT encrypted_data FROM smartfill_private_data WHERE user_id=?")
          .get(req.user.id);
        if (row) {
          const data = decryptValue(JSON.parse(row.encrypted_data));
          for (const fieldKey of keys) {
            const value = data[fieldKey];
            if (typeof value === "string" && value.trim()) {
              const validationError = validateValue(fieldKey, value);
              const prior = suggestions.find((item) => item.fieldKey === fieldKey);
              if (prior && prior.value !== value) {
                prior.value = "";
                prior.source = "ambiguous";
                prior.status = "ambiguous";
                prior.confidence = 0;
                prior.eligible = false;
                prior.note = "Conflicting approved sources. Choose one source or update My Identity, then prepare suggestions again.";
              } else if (!prior) {
                suggestions.push({
                  fieldKey,
                  value,
                  source: "manual",
                  status: validationError ? "invalid" : "user_confirmed",
                  confidence: validationError ? 0 : 1,
                  eligible: !validationError,
                  note: validationError || "Entered and saved by you.",
                });
              }
            }
          }
        }
      }

      const visibleSuggestions = suggestions.filter(
        (item) =>
          ["ambiguous", "invalid"].includes(item.status) ||
          item.confidence >= CONFIDENCE_THRESHOLD,
      );

      database
        .prepare("DELETE FROM smartfill_review_sessions WHERE expires_at<=?")
        .run(now());

      if (visibleSuggestions.length) {
        const timestamp = now();
        database
          .prepare(`
            INSERT INTO smartfill_review_sessions
              (id,user_id,form_id,fields_json,token_hash,created_at,reviewed_at,expires_at)
            VALUES(?,?,?,?,NULL,?,NULL,?)
          `)
          .run(
            id(),
            req.user.id,
            formId,
            JSON.stringify(visibleSuggestions.map((item) => item.fieldKey)),
            timestamp,
            timestamp + REVIEW_TOKEN_TTL_MS,
          );
      }

      audit(
        req.user.id,
        formId,
        "suggestions_viewed",
        visibleSuggestions.map((item) => item.fieldKey),
        [...new Set(visibleSuggestions.map((item) => item.source))],
      );

      return res.json({
        success: true,
        suggestions: visibleSuggestions,
        confidenceThreshold: CONFIDENCE_THRESHOLD,
      });
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.statusCode ? error.message : "Could not prepare SmartFill suggestions.",
        });
    }
  });

  app.post("/api/smartfill/review", enforceSameOrigin, requireAuth, mfa, (req, res) => {
    try {
      assertWalletUnlocked(req.user.id);
      const formId = clean(req.body?.formId, 100);
      const fieldKeys = Array.isArray(req.body?.fieldKeys)
        ? [...new Set(req.body.fieldKeys.filter(allowedField))].slice(0, 40)
        : [];
      const consent = database
        .prepare(`
          SELECT fields_json
          FROM smartfill_consents
          WHERE user_id=? AND form_id=? AND revoked_at IS NULL
        `)
        .get(req.user.id, formId);

      if (!consent) {
        return res.status(403).json({ success: false, message: "Active consent is required." });
      }

      const allowed = new Set(JSON.parse(consent.fields_json));
      if (!formId || !fieldKeys.length || fieldKeys.some((fieldKey) => !allowed.has(fieldKey))) {
        return res.status(400).json({ success: false, message: "Review contains fields outside your consent." });
      }

      const reviewSession = database
        .prepare(`
          SELECT id,fields_json
          FROM smartfill_review_sessions
          WHERE user_id=? AND form_id=? AND expires_at>?
          ORDER BY created_at DESC LIMIT 1
        `)
        .get(req.user.id, formId, now());

      if (!reviewSession) {
        return res.status(409).json({
          success: false,
          code: "SMARTFILL_REVIEW_SESSION_EXPIRED",
          message: "Prepare the current suggestions again before acknowledging your review.",
        });
      }

      const reviewedKeys = JSON.parse(reviewSession.fields_json);
      if (
        fieldKeys.length !== reviewedKeys.length ||
        fieldKeys.some((fieldKey) => !reviewedKeys.includes(fieldKey))
      ) {
        return res.status(400).json({ success: false, message: "Review must acknowledge every current suggestion." });
      }

      const reviewToken = crypto.randomBytes(32).toString("base64url");
      const reviewedAt = now();
      database
        .prepare("UPDATE smartfill_review_sessions SET token_hash=?,reviewed_at=? WHERE id=? AND user_id=?")
        .run(hashReviewToken(reviewToken), reviewedAt, reviewSession.id, req.user.id);

      audit(req.user.id, formId, "reviewed", reviewedKeys, []);
      return res.json({
        success: true,
        recorded: true,
        reviewToken,
        expiresAt: reviewedAt + REVIEW_TOKEN_TTL_MS,
      });
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.statusCode ? error.message : "Could not record SmartFill review.",
        });
    }
  });
}
