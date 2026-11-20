import crypto from "node:crypto";
import { rateLimit } from "express-rate-limit";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clean = (value, max = 5000) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

const POST_TYPES = new Set(["homework", "notice"]);
const AUDIENCES = new Set(["all", "students", "staff"]);

export function registerInstitutionSchoolPosts({ app, database, requireAuth, requireMfaProduction, enforceSameOrigin, getInstitutionMembership, hasInstitutionFeature }) {
  const schoolPostsReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many school feed requests. Please try again later." }
  });
  const schoolPostsWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many school updates. Please try again later." }
  });
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_school_posts (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      post_type TEXT NOT NULL CHECK(post_type IN ('homework','notice')),
      title TEXT NOT NULL,
      subject TEXT,
      class_label TEXT,
      body TEXT NOT NULL,
      due_at TEXT,
      audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','students','staff')),
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','archived')),
      created_by TEXT NOT NULL REFERENCES users(id),
      updated_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_school_posts_feed
      ON institution_school_posts(institution_id,post_type,status,created_at DESC);
    CREATE TABLE IF NOT EXISTS institution_school_posts_audit (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_school_posts_audit
      ON institution_school_posts_audit(institution_id,created_at DESC);
  `);

  function authorize(req, res, institutionId, type, write = false) {
    if (!POST_TYPES.has(type)) {
      fail(res, 400, "Choose Homework or Notice.");
      return null;
    }
    const membership = getInstitutionMembership(req.user.id, institutionId);
    const allowedRoles = write ? ["institution_admin"] : ["institution_admin", "reviewer", "read_only", "student"];
    if (!membership || membership.status !== "active" || !allowedRoles.includes(membership.role)) {
      fail(res, 403, "An active institution role is required for this school workspace.");
      return null;
    }
    const feature = type === "homework" ? "homework" : "notices";
    if (!hasInstitutionFeature(institutionId, feature)) {
      fail(res, 403, `${type === "homework" ? "Homework" : "Notices"} is not enabled for this institution.`, "FEATURE_NOT_ENTITLED");
      return null;
    }
    return membership;
  }

  function parse(body, type) {
    const title = clean(body?.title, 180);
    const subject = clean(body?.subject, 100);
    const classLabel = clean(body?.classLabel, 60);
    const content = clean(body?.body, 5000);
    const dueAt = clean(body?.dueAt, 40);
    const audience = clean(body?.audience || "all", 16);
    if (title.length < 3 || content.length < 5 || !AUDIENCES.has(audience)) return null;
    if (type === "homework" && (!dueAt || !Number.isFinite(Date.parse(dueAt)))) return null;
    if (dueAt && !Number.isFinite(Date.parse(dueAt))) return null;
    return { title, subject, classLabel, body: content, dueAt: dueAt || null, audience };
  }

  function audit(institutionId, postId, actorUserId, action) {
    database.prepare("INSERT INTO institution_school_posts_audit(id,institution_id,post_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?,?)")
      .run(id(), institutionId, postId, actorUserId, action, now());
  }

  app.get("/api/institutions/:institutionId/school-posts", schoolPostsReadLimiter, requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      const type = clean(req.query?.type, 20);
      const membership = authorize(req, res, institutionId, type, false);
      if (!membership) return;
      const rows = database.prepare(`
        SELECT id,post_type AS type,title,subject,class_label AS classLabel,body,due_at AS dueAt,
          audience,status,created_at AS createdAt,updated_at AS updatedAt
        FROM institution_school_posts
        WHERE institution_id=? AND post_type=? AND status='published'
          AND (?='institution_admin' OR (?='student' AND audience IN ('all','students')) OR (?<>'student' AND ?<>'institution_admin' AND audience IN ('all','staff')))
        ORDER BY created_at DESC LIMIT 200
      `).all(institutionId, type, membership.role, membership.role, membership.role, membership.role);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, posts: rows, canManage: membership.role === "institution_admin" });
    } catch (error) { next(error); }
  });

  app.post("/api/institutions/:institutionId/school-posts", schoolPostsWriteLimiter, enforceSameOrigin, requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      const type = clean(req.body?.type, 20);
      if (!authorize(req, res, institutionId, type, true)) return;
      const post = parse(req.body, type);
      if (!post) return fail(res, 400, type === "homework"
        ? "Enter a title, instructions and a valid homework due date."
        : "Enter a notice title and message.");
      const postId = id(), timestamp = now();
      database.prepare(`INSERT INTO institution_school_posts
        (id,institution_id,post_type,title,subject,class_label,body,due_at,audience,status,created_by,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'published',?,?,?,?)`)
        .run(postId,institutionId,type,post.title,post.subject||null,post.classLabel||null,post.body,post.dueAt,post.audience,req.user.id,req.user.id,timestamp,timestamp);
      audit(institutionId, postId, req.user.id, type + "_created");
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(201).json({ success: true, post: { id: postId, type, ...post, status: "published", createdAt: timestamp } });
    } catch (error) { next(error); }
  });

  app.patch("/api/institutions/:institutionId/school-posts/:postId", schoolPostsWriteLimiter, enforceSameOrigin, requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      const postId = clean(req.params.postId, 128);
      const current = database.prepare("SELECT id,post_type AS type FROM institution_school_posts WHERE id=? AND institution_id=? AND status='published'").get(postId, institutionId);
      if (!current) return fail(res, 404, "School post was not found.");
      if (!authorize(req, res, institutionId, current.type, true)) return;
      const status = clean(req.body?.status, 20);
      if (status !== "archived") return fail(res, 400, "Only archive is supported for an existing school post.");
      const timestamp = now();
      database.prepare("UPDATE institution_school_posts SET status='archived',updated_by=?,updated_at=? WHERE id=? AND institution_id=?")
        .run(req.user.id, timestamp, postId, institutionId);
      audit(institutionId, postId, req.user.id, current.type + "_archived");
      return res.json({ success: true, status: "archived" });
    } catch (error) { next(error); }
  });
}
