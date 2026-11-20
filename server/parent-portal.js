import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const textValue = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

export function registerParentPortal({ app, database, requireAuth, requireMfaProduction, enforceSameOrigin, getInstitutionMembership, hasInstitutionFeature }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_parent_links (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      parent_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL DEFAULT 'guardian',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
      consent_confirmed INTEGER NOT NULL CHECK(consent_confirmed IN (0,1)),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      UNIQUE(institution_id,parent_user_id,student_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON institution_parent_links(parent_user_id,status,institution_id);
    CREATE INDEX IF NOT EXISTS idx_parent_links_student ON institution_parent_links(institution_id,student_user_id,status);
    CREATE TABLE IF NOT EXISTS institution_parent_portal_audit (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      parent_user_id TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  function parentLink(req, institutionId, studentUserId) {
    return database.prepare(`SELECT l.id,l.institution_id AS institutionId,l.student_user_id AS studentUserId,
      u.email AS parentEmail,i.name AS institutionName,l.relationship,l.created_at AS linkedAt
      FROM institution_parent_links l JOIN users u ON u.id=l.parent_user_id
      JOIN institutions i ON i.id=l.institution_id
      WHERE l.institution_id=? AND l.parent_user_id=? AND l.student_user_id=? AND l.status='active'`)
      .get(institutionId, req.user.id, studentUserId);
  }

  app.get("/api/parent-portal/children", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      if (req.user.role === "owner") return fail(res,403,"Platform Owner accounts cannot access school operational records.");
      const rows = database.prepare(`SELECT l.institution_id AS institutionId,i.name AS institutionName,
        l.student_user_id AS studentUserId,COALESCE(p.student_number,'') AS studentNumber,
        u.email AS studentEmail,l.relationship,l.created_at AS linkedAt
        FROM institution_parent_links l JOIN institutions i ON i.id=l.institution_id
        JOIN users u ON u.id=l.student_user_id
        LEFT JOIN institution_student_profiles p ON p.institution_id=l.institution_id AND p.user_id=l.student_user_id
        WHERE l.parent_user_id=? AND l.status='active'
        AND EXISTS(SELECT 1 FROM institution_memberships m WHERE m.institution_id=l.institution_id AND m.user_id=l.student_user_id AND m.role='student' AND m.status='active')
        ORDER BY i.name,u.email`).all(req.user.id);
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,children:rows.filter(row=>hasInstitutionFeature(row.institutionId,"student_management"))});
    } catch(error) { next(error); }
  });

  app.get("/api/parent-portal/children/:studentUserId", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      if (req.user.role === "owner") return fail(res,403,"Platform Owner accounts cannot access school operational records.");
      const studentUserId=textValue(req.params.studentUserId,128);
      const institutionId=textValue(req.query.institutionId,128);
      const link=parentLink(req,institutionId,studentUserId);
      if(!link) return fail(res,404,"This child is not linked to your parent account.","PARENT_LINK_NOT_FOUND");
      const student=hasInstitutionFeature(institutionId,"student_management") ? database.prepare(`SELECT u.email,p.student_number AS studentNumber,p.program,p.academic_year AS academicYear
        FROM users u LEFT JOIN institution_student_profiles p ON p.user_id=u.id AND p.institution_id=? WHERE u.id=?`).get(institutionId,studentUserId) : null;
      const attendance=hasInstitutionFeature(institutionId,"academics") ? database.prepare(`SELECT a.attendance_date AS date,a.status,c.title AS subject
        FROM institution_attendance a JOIN institution_courses c ON c.id=a.course_id
        WHERE a.institution_id=? AND a.student_user_id=? ORDER BY a.attendance_date DESC LIMIT 90`).all(institutionId,studentUserId) : [];
      const invoices=hasInstitutionFeature(institutionId,"finance") ? database.prepare(`SELECT id,fee_head AS feeHead,description,amount_paise AS amountPaise,due_date AS dueDate,status,created_at AS createdAt
        FROM institution_fee_invoices WHERE institution_id=? AND student_user_id=? AND status<>'cancelled'
        ORDER BY COALESCE(due_date,created_at) DESC LIMIT 100`).all(institutionId,studentUserId) : [];
      const results=hasInstitutionFeature(institutionId,"academics") ? database.prepare(`SELECT a.title,a.exam_date AS examDate,c.title AS subject,
        r.marks_hundredths AS marksHundredths,a.total_marks_hundredths AS totalMarksHundredths
        FROM institution_assessment_results r JOIN institution_assessments a ON a.id=r.assessment_id
        JOIN institution_courses c ON c.id=a.course_id
        WHERE r.institution_id=? AND r.student_user_id=? ORDER BY a.exam_date DESC LIMIT 100`).all(institutionId,studentUserId) : [];
      const homework=hasInstitutionFeature(institutionId,"homework") ? database.prepare("SELECT id,title,subject,class_label AS classLabel,body,due_at AS dueAt,created_at AS createdAt FROM institution_school_posts WHERE institution_id=? AND post_type='homework' AND status='published' AND audience IN ('all','students') ORDER BY created_at DESC LIMIT 50").all(institutionId) : [];
      database.prepare("INSERT INTO institution_parent_portal_audit(id,institution_id,actor_user_id,parent_user_id,student_user_id,action,created_at) VALUES(?,?,?,?,?,'parent_child_records_viewed',?)")
        .run(id(),institutionId,req.user.id,req.user.id,studentUserId,new Date().toISOString());
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,child:{...(student||{}),institutionName:link.institutionName||"",relationship:link.relationship},
        attendance,invoices,results,homework});
    } catch(error) { next(error); }
  });

  app.get("/api/institutions/:institutionId/parent-links", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||member.role!=="institution_admin") return fail(res,403,"Only the institution administrator can view parent links.");
      if(!hasInstitutionFeature(institutionId,"student_management")) return fail(res,403,"Parent-link management requires the institution's student-management subscription feature.","FEATURE_NOT_ENTITLED");
      const rows=database.prepare(`SELECT l.parent_user_id AS parentUserId,p.email AS parentEmail,l.student_user_id AS studentUserId,s.email AS studentEmail,l.relationship,l.created_at AS linkedAt
        FROM institution_parent_links l JOIN users p ON p.id=l.parent_user_id JOIN users s ON s.id=l.student_user_id
        WHERE l.institution_id=? AND l.status='active' ORDER BY l.created_at DESC LIMIT 500`).all(institutionId);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,links:rows});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/:institutionId/parent-links", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      const member=getInstitutionMembership(req.user.id,institutionId);
      if(!member || member.status!=="active" || member.role!=="institution_admin")
        return fail(res,403,"Only the institution administrator can link a parent account.");
      if(!hasInstitutionFeature(institutionId,"student_management")) return fail(res,403,"Parent-link management requires the institution's student-management subscription feature.","FEATURE_NOT_ENTITLED");
      const parentEmail=textValue(req.body?.parentEmail,254).toLowerCase();
      const studentUserId=textValue(req.body?.studentUserId,128);
      const relationship=textValue(req.body?.relationship||"guardian",40);
      const consentConfirmed=req.body?.consentConfirmed===true;
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail) || !studentUserId || !consentConfirmed)
        return fail(res,400,"Enter a valid parent account email, student and confirm guardian authorization.");
      const student=database.prepare(`SELECT u.id FROM users u JOIN institution_memberships m ON m.user_id=u.id
        WHERE u.id=? AND m.institution_id=? AND m.role='student' AND m.status='active'`).get(studentUserId,institutionId);
      if(!student) return fail(res,404,"Active student membership was not found.");
      const parent=database.prepare("SELECT u.id FROM users u JOIN email_verification_state ev ON ev.user_id=u.id AND ev.verified_at IS NOT NULL WHERE lower(u.email)=?").get(parentEmail);
      if(!parent) return fail(res,404,"The parent must create and verify a SecureID account before the school can link it.","PARENT_ACCOUNT_NOT_FOUND");
      if(parent.id===studentUserId) return fail(res,400,"A student account cannot be linked as its own parent.");
      const timestamp=new Date().toISOString(),linkId=id();
      database.prepare(`INSERT INTO institution_parent_links(id,institution_id,parent_user_id,student_user_id,relationship,status,consent_confirmed,created_by,created_at)
        VALUES(?,?,?,?,?,'active',1,?,?) ON CONFLICT(institution_id,parent_user_id,student_user_id)
        DO UPDATE SET relationship=excluded.relationship,status='active',consent_confirmed=1,created_by=excluded.created_by,created_at=excluded.created_at,revoked_at=NULL`)
        .run(linkId,institutionId,parent.id,studentUserId,relationship,req.user.id,timestamp);
      database.prepare("INSERT INTO institution_parent_portal_audit(id,institution_id,actor_user_id,parent_user_id,student_user_id,action,created_at) VALUES(?,?,?,?,?,'parent_link_created',?)")
        .run(id(),institutionId,req.user.id,parent.id,studentUserId,timestamp);
      res.status(201).json({success:true,message:"Parent account linked. The parent can now sign in and view this child only.",parentEmail,studentUserId});
    } catch(error) { next(error); }
  });

  app.delete("/api/institutions/:institutionId/parent-links/:parentUserId/:studentUserId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128),parentUserId=textValue(req.params.parentUserId,128),studentUserId=textValue(req.params.studentUserId,128);
      const member=getInstitutionMembership(req.user.id,institutionId);
      if(!member || member.status!=="active" || member.role!=="institution_admin") return fail(res,403,"Only the institution administrator can revoke a parent link.");
      if(!hasInstitutionFeature(institutionId,"student_management")) return fail(res,403,"Parent-link management requires the institution's student-management subscription feature.","FEATURE_NOT_ENTITLED");
      const timestamp=new Date().toISOString();
      const result=database.prepare("UPDATE institution_parent_links SET status='revoked',revoked_at=? WHERE institution_id=? AND parent_user_id=? AND student_user_id=? AND status='active'").run(timestamp,institutionId,parentUserId,studentUserId);
      if(!result.changes) return fail(res,404,"Active parent link was not found.");
      database.prepare("INSERT INTO institution_parent_portal_audit(id,institution_id,actor_user_id,parent_user_id,student_user_id,action,created_at) VALUES(?,?,?,?,?,'parent_link_revoked',?)")
        .run(id(),institutionId,req.user.id,parentUserId,studentUserId,timestamp);
      res.json({success:true});
    } catch(error) { next(error); }
  });
}
