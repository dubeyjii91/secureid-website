import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));

export function registerInstitutionExamServices({ app, database, requireAuth, requireMfaProduction, enforceSameOrigin, getInstitutionMembership, hasInstitutionFeature }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_exam_revaluation_requests (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES institution_exams(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL REFERENCES institution_exam_subjects(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','rejected')),
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_by TEXT REFERENCES users(id),
      review_note TEXT,
      UNIQUE(exam_id,subject_id,student_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_exam_revaluation_queue ON institution_exam_revaluation_requests(institution_id,status,requested_at);
    CREATE TABLE IF NOT EXISTS institution_exam_revaluation_audit (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES institution_exam_revaluation_requests(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  function member(req, res, institutionId, roles) {
    const membership = getInstitutionMembership(req.user.id, institutionId);
    if (!membership || membership.status !== "active" || !roles.includes(membership.role)) {
      fail(res, 403, "Your institution role does not allow this examination service action.");
      return null;
    }
    if (!hasInstitutionFeature(institutionId, "academics")) {
      fail(res, 403, "Academics entitlement is required.");
      return null;
    }
    return membership;
  }

  function audit(institutionId, requestId, actorId, action, details) {
    database.prepare("INSERT INTO institution_exam_revaluation_audit(id,institution_id,request_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id(), institutionId, requestId, actorId, action, JSON.stringify(details), now());
  }

  app.get("/api/institutions/:institutionId/exam-services", requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      const membership = member(req, res, institutionId, ["student", "institution_admin", "reviewer", "read_only"]);
      if (!membership) return;
      const requests = database.prepare(`
        SELECT r.id,r.exam_id AS examId,e.title AS examTitle,r.subject_id AS subjectId,s.subject_code AS subjectCode,
          s.title AS subjectTitle,r.student_user_id AS studentUserId,u.email AS studentEmail,r.reason,r.status,
          r.requested_at AS requestedAt,r.updated_at AS updatedAt,r.review_note AS reviewNote
        FROM institution_exam_revaluation_requests r
        JOIN institution_exams e ON e.id=r.exam_id AND e.institution_id=r.institution_id
        JOIN institution_exam_subjects s ON s.id=r.subject_id AND s.exam_id=r.exam_id
        JOIN users u ON u.id=r.student_user_id
        WHERE r.institution_id=? ${membership.role === "student" ? "AND r.student_user_id=?" : ""}
        ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.requested_at DESC LIMIT 300
      `).all(...(membership.role === "student" ? [institutionId, req.user.id] : [institutionId]));
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, requests, canRequest: membership.role === "student", canReview: ["institution_admin", "reviewer"].includes(membership.role) });
    } catch (error) { next(error); }
  });

  app.post("/api/institutions/:institutionId/examinations/:examId/subjects/:subjectId/revaluation", enforceSameOrigin, requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      if (!member(req, res, institutionId, ["student"])) return;
      const examId = clean(req.params.examId, 128);
      const subjectId = clean(req.params.subjectId, 128);
      const reason = clean(req.body?.reason, 1000);
      if (reason.length < 10) return fail(res, 400, "Explain the reason for revaluation in at least 10 characters.");
      const exam = database.prepare("SELECT status FROM institution_exams WHERE id=? AND institution_id=?").get(examId, institutionId);
      if (!exam || exam.status !== "published") return fail(res, 409, "Revaluation is available only after results are published.");
      const subject = database.prepare("SELECT id FROM institution_exam_subjects WHERE id=? AND exam_id=? AND institution_id=?").get(subjectId, examId, institutionId);
      if (!subject) return fail(res, 404, "Examination subject not found.");
      const registration = database.prepare("SELECT id FROM institution_exam_registrations WHERE exam_id=? AND institution_id=? AND student_user_id=? AND status='approved'").get(examId, institutionId, req.user.id);
      if (!registration) return fail(res, 403, "Only students with an approved examination registration may request revaluation.");
      const marks = database.prepare("SELECT id FROM institution_exam_marks WHERE exam_id=? AND subject_id=? AND institution_id=? AND student_user_id=?").get(examId, subjectId, institutionId, req.user.id);
      if (!marks) return fail(res, 409, "Published marks are not available for this subject.");
      const requestId = id();
      const timestamp = now();
      try {
        database.prepare("INSERT INTO institution_exam_revaluation_requests(id,institution_id,exam_id,subject_id,student_user_id,reason,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(requestId, institutionId, examId, subjectId, req.user.id, reason, timestamp, timestamp);
      } catch (error) {
        if (String(error.message || "").includes("UNIQUE constraint failed")) return fail(res, 409, "A revaluation request already exists for this subject and examination.");
        throw error;
      }
      audit(institutionId, requestId, req.user.id, "revaluation_requested", { examId, subjectId });
      return res.status(201).json({ success: true, request: { id: requestId, examId, subjectId, status: "pending", requestedAt: timestamp } });
    } catch (error) { next(error); }
  });

  app.patch("/api/institutions/:institutionId/examinations/:examId/revaluations/:requestId", enforceSameOrigin, requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      if (!member(req, res, institutionId, ["institution_admin", "reviewer"])) return;
      const examId = clean(req.params.examId, 128);
      const requestId = clean(req.params.requestId, 128);
      const decision = clean(req.body?.decision, 20);
      const reviewNote = clean(req.body?.reviewNote, 1000);
      if (!["complete", "reject"].includes(decision) || reviewNote.length < 4) return fail(res, 400, "Choose complete or reject and provide a review note.");
      const request = database.prepare(`
        SELECT r.id,r.subject_id AS subjectId,r.student_user_id AS studentUserId,r.status,
          m.marks_hundredths AS currentMarks,s.total_marks_hundredths AS totalMarks
        FROM institution_exam_revaluation_requests r
        JOIN institution_exam_subjects s ON s.id=r.subject_id AND s.exam_id=r.exam_id AND s.institution_id=r.institution_id
        JOIN institution_exam_marks m ON m.subject_id=s.id AND m.exam_id=r.exam_id AND m.student_user_id=r.student_user_id
        WHERE r.id=? AND r.institution_id=? AND r.exam_id=?
      `).get(requestId, institutionId, examId);
      if (!request) return fail(res, 404, "Pending revaluation request not found.");
      if (request.status !== "pending") return fail(res, 409, "This revaluation request has already been reviewed.");
      let revisedMarks = null;
      if (decision === "complete") {
        revisedMarks = Math.round(Number(req.body?.revisedMarks) * 100);
        if (!Number.isSafeInteger(revisedMarks) || revisedMarks < 0 || revisedMarks > request.totalMarks) return fail(res, 400, "Revised marks must be between zero and the subject maximum.");
      }
      const timestamp = now();
      database.exec("BEGIN IMMEDIATE");
      try {
        if (decision === "complete") {
          database.prepare("UPDATE institution_exam_marks SET marks_hundredths=?,entered_by=?,updated_at=? WHERE exam_id=? AND subject_id=? AND student_user_id=?")
            .run(revisedMarks, req.user.id, timestamp, examId, request.subjectId, request.studentUserId);
        }
        database.prepare("UPDATE institution_exam_revaluation_requests SET status=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=? AND institution_id=? AND status='pending'")
          .run(decision === "complete" ? "completed" : "rejected", req.user.id, reviewNote, timestamp, requestId, institutionId);
        audit(institutionId, requestId, req.user.id, decision === "complete" ? "revaluation_completed" : "revaluation_rejected", {
          previousMarksHundredths: request.currentMarks,
          revisedMarksHundredths: revisedMarks,
          reviewNote
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return res.json({ success: true, status: decision === "complete" ? "completed" : "rejected", revisedMarksHundredths: revisedMarks });
    } catch (error) { next(error); }
  });

  app.get("/api/institutions/:institutionId/transcript", requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const institutionId = clean(req.params.institutionId, 128);
      if (!member(req, res, institutionId, ["student"])) return;
      const institution = database.prepare("SELECT name,institution_type AS institutionType FROM institutions WHERE id=?").get(institutionId);
      if (!institution) return fail(res, 404, "Institution not found.");
      const exams = database.prepare(`
        SELECT e.id,e.title,e.academic_year AS academicYear,e.term,e.status,r.roll_number AS rollNumber
        FROM institution_exams e
        JOIN institution_exam_registrations r ON r.exam_id=e.id AND r.institution_id=e.institution_id
        WHERE e.institution_id=? AND e.status='published' AND r.student_user_id=? AND r.status='approved'
        ORDER BY e.academic_year,e.starts_at,e.title
      `).all(institutionId, req.user.id);
      const records = [];
      const incompleteExams = [];
      for (const exam of exams) {
        const subjects = database.prepare(`
          SELECT s.subject_code AS subjectCode,s.title AS subjectTitle,s.total_marks_hundredths AS totalMarksHundredths,
            s.passing_marks_hundredths AS passingMarksHundredths,m.marks_hundredths AS marksHundredths
          FROM institution_exam_subjects s
          LEFT JOIN institution_exam_marks m ON m.subject_id=s.id AND m.exam_id=s.exam_id AND m.student_user_id=?
          WHERE s.exam_id=? AND s.institution_id=? ORDER BY s.subject_code
        `).all(req.user.id, exam.id, institutionId);
        if (!subjects.length || subjects.some(subject => subject.marksHundredths === null || subject.marksHundredths === undefined)) {
          incompleteExams.push({ examId: exam.id, title: exam.title });
          continue;
        }
        const totalMarksHundredths = subjects.reduce((sum, subject) => sum + subject.totalMarksHundredths, 0);
        const obtainedMarksHundredths = subjects.reduce((sum, subject) => sum + subject.marksHundredths, 0);
        records.push({
          ...exam,
          subjects,
          totalMarksHundredths,
          obtainedMarksHundredths,
          percentage: Number((obtainedMarksHundredths / totalMarksHundredths * 100).toFixed(2)),
          result: subjects.every(subject => subject.marksHundredths >= subject.passingMarksHundredths) ? "PASS" : "NOT PASS"
        });
      }
      const payload = { institutionName: institution.name, institutionType: institution.institutionType, studentEmail: req.user.email, generatedAt: now(), records, incompleteExams };
      const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      res.setHeader("Cache-Control", "private, no-store");
      if (req.query.format === "print") {
        const rows = records.flatMap(record => record.subjects.map(subject => `<tr><td>${escapeHtml(record.academicYear)}</td><td>${escapeHtml(record.term || "")}</td><td>${escapeHtml(record.title)}</td><td>${escapeHtml(subject.subjectCode)}</td><td>${escapeHtml(subject.subjectTitle)}</td><td>${(subject.marksHundredths / 100).toFixed(2)}</td><td>${(subject.totalMarksHundredths / 100).toFixed(2)}</td><td>${subject.marksHundredths >= subject.passingMarksHundredths ? "PASS" : "NOT PASS"}</td></tr>`)).join("");
        const incomplete = incompleteExams.map(exam => `<li>${escapeHtml(exam.title)} — result incomplete, excluded</li>`).join("");
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SecureID academic transcript</title><style>body{font:14px Arial,sans-serif;color:#172033;max-width:1100px;margin:24px auto;padding:20px}header{text-align:center;border-bottom:2px solid #172033;padding-bottom:12px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #cbd2dc;padding:8px;text-align:left}th{background:#eef1f5}.note{font-size:12px;color:#526078}.digest{overflow-wrap:anywhere;font-size:10px;color:#526078}@media print{button{display:none}body{margin:0}}</style></head><body><header><h1>${escapeHtml(institution.name)}</h1><h2>Consolidated academic transcript</h2><p>${escapeHtml(req.user.email)}</p></header><table><thead><tr><th>Academic year</th><th>Term</th><th>Examination</th><th>Code</th><th>Subject</th><th>Marks</th><th>Maximum</th><th>Result</th></tr></thead><tbody>${rows || "<tr><td colspan='8'>No complete published results are available.</td></tr>"}</tbody></table>${incomplete ? `<h3>Results excluded pending completion</h3><ul>${incomplete}</ul>` : ""}<p class="note">This SecureID consolidated academic record is generated from institution-published examination results. It is not a degree certificate or a substitute for any separately authenticated official transcript required by the institution.</p><p class="digest">Record SHA-256: ${digest}</p><p class="note">Generated: ${escapeHtml(payload.generatedAt)}</p><button onclick="window.print()">Print / Save as PDF</button></body></html>`;
        res.setHeader("Content-Disposition", "inline; filename=SecureID-academic-transcript.html");
        return res.type("html").send(html);
      }
      return res.json({ success: true, transcript: payload, recordSha256: digest });
    } catch (error) { next(error); }
  });
}
