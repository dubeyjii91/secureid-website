import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clean = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ success: false, message });

export function registerStudentAdmissions({ app, database, requireAuth, requireMfaProduction, enforceSameOrigin, getInstitutionMembership, encrypt, decrypt }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_admission_requests (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      encrypted_application TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','needs_correction','approved','rejected','withdrawn')),
      review_note TEXT,
      reviewed_by TEXT REFERENCES users(id),
      consent_version TEXT NOT NULL DEFAULT 'student-admission-v1',
      consented_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admission_requests_institution_status ON institution_admission_requests(institution_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admission_requests_student ON institution_admission_requests(student_user_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admission_one_open_request ON institution_admission_requests(institution_id,student_user_id) WHERE status IN ('submitted','needs_correction');
    CREATE TABLE IF NOT EXISTS institution_admission_audit (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES institution_admission_requests(id) ON DELETE CASCADE,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admission_audit_request ON institution_admission_audit(request_id,created_at ASC);
  `);

  const activeInstitutionSql = `
    SELECT i.id, i.name
    FROM institutions i
    JOIN institution_subscriptions s ON s.institution_id=i.id
    WHERE s.status IN ('pilot','active')
      AND (s.starts_at IS NULL OR s.starts_at='' OR s.starts_at<=?)
      AND (s.ends_at IS NULL OR s.ends_at='' OR s.ends_at>?)
    ORDER BY i.name COLLATE NOCASE
  `;

  app.get("/api/admissions/institutions", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const timestamp = now();
      const institutions = database.prepare(activeInstitutionSql).all(timestamp,timestamp);
      res.setHeader("Cache-Control","private, no-store");
      return res.json({ success:true, institutions });
    } catch(error) { next(error); }
  });

  app.get("/api/admissions/mine", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const rows = database.prepare(`
        SELECT r.id,r.institution_id AS institutionId,i.name AS institutionName,r.status,
          r.review_note AS reviewNote,r.created_at AS createdAt,r.updated_at AS updatedAt,
          r.consented_at AS consentedAt,r.consent_version AS consentVersion,r.encrypted_application
        FROM institution_admission_requests r JOIN institutions i ON i.id=r.institution_id
        WHERE r.student_user_id=? ORDER BY r.created_at DESC LIMIT 50
      `).all(req.user.id);
      const applications = rows.map(row => {
        let application = {};
        try { application = decrypt(JSON.parse(row.encrypted_application)); } catch {}
        const { encrypted_application, ...safe } = row;
        return { ...safe, ...application };
      });
      res.setHeader("Cache-Control","private, no-store");
      return res.json({ success:true, applications });
    } catch(error) { next(error); }
  });

  app.post("/api/admissions/applications", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId = clean(req.body?.institutionId,128);
      if (!institutionId) return fail(res,400,"Choose an institution.");
      const timestamp = now();
      // Resolve the requested institution from the active, subscription-backed directory.
      const selected = database.prepare(activeInstitutionSql).all(timestamp,timestamp).find(item => item.id === institutionId);
      if (!selected) return fail(res,404,"This institution is not accepting admission requests right now.");
      const existingMembership = getInstitutionMembership(req.user.id,institutionId);
      if (existingMembership) return fail(res,409,"This account already has an institution membership here. Contact the institution administrator if you need an admission change.");
      if (req.body?.consent !== true) return fail(res,400,"Confirm the student-admission-v1 consent before submitting.");
      const name = clean(req.body?.fullName,120);
      const course = clean(req.body?.course,120);
      const department = clean(req.body?.department,120);
      const academicYear = clean(req.body?.academicYear,32);
      const admissionYear = clean(req.body?.admissionYear,16);
      const studentNumber = clean(req.body?.studentNumber,40);
      const message = clean(req.body?.message,500);
      if (!name || !course || !department || !academicYear || !admissionYear) return fail(res,400,"Name, course, department, academic year and admission year are required.");
      const duplicate = database.prepare("SELECT id FROM institution_admission_requests WHERE institution_id=? AND student_user_id=? AND status IN ('submitted','needs_correction')").get(institutionId,req.user.id);
      if (duplicate) return fail(res,409,"You already have a pending admission request for this institution.");
      const requestId=id();
      const application={fullName:name,course,department,academicYear,admissionYear,studentNumber,message};
      const encrypted=JSON.stringify(encrypt(application));
      database.prepare(`
        INSERT INTO institution_admission_requests
          (id,institution_id,student_user_id,encrypted_application,status,consent_version,consented_at,created_at,updated_at)
        VALUES(?,?,?,?,'submitted','student-admission-v1',?,?,?)
      `).run(requestId,institutionId,req.user.id,encrypted,timestamp,timestamp,timestamp);
      database.prepare("INSERT INTO institution_admission_audit(id,request_id,institution_id,actor_user_id,action,to_status,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(id(),requestId,institutionId,req.user.id,"submitted","submitted",timestamp);
      return res.status(201).json({success:true,application:{id:requestId,institutionId,institutionName:selected.name,status:"submitted",...application,createdAt:timestamp,updatedAt:timestamp}});
    } catch(error) {
      if (String(error?.message||"").includes("UNIQUE constraint failed")) return fail(res,409,"A pending admission request already exists.");
      next(error);
    }
  });

  app.delete("/api/admissions/applications/:requestId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,status FROM institution_admission_requests WHERE id=? AND student_user_id=?").get(clean(req.params.requestId,128),req.user.id);
      if(!row) return fail(res,404,"Admission request not found.");
      if(!["submitted","needs_correction"].includes(row.status)) return fail(res,409,"Only pending admission requests can be withdrawn.");
      const timestamp=now();
      database.prepare("UPDATE institution_admission_requests SET status='withdrawn',updated_at=? WHERE id=? AND student_user_id=?").run(timestamp,row.id,req.user.id);
      database.prepare("INSERT INTO institution_admission_audit(id,request_id,institution_id,actor_user_id,action,from_status,to_status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id(),row.id,row.institution_id,req.user.id,"withdrawn",row.status,"withdrawn",timestamp);
      return res.json({success:true});
    } catch(error) { next(error); }
  });

  app.get("/api/institutions/:institutionId/admission-requests", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=clean(req.params.institutionId,128);
      const member=getInstitutionMembership(req.user.id,institutionId);
      if(!member || member.status!=="active" || member.role!=="institution_admin") return fail(res,403,"Only an active Institution Admin can view admission requests.");
      const rows=database.prepare(`
        SELECT r.id,r.institution_id AS institutionId,r.student_user_id AS studentUserId,
          u.email AS studentEmail,r.status,r.review_note AS reviewNote,r.consent_version AS consentVersion,
          r.consented_at AS consentedAt,r.created_at AS createdAt,r.updated_at AS updatedAt,r.encrypted_application
        FROM institution_admission_requests r JOIN users u ON u.id=r.student_user_id
        WHERE r.institution_id=? ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'needs_correction' THEN 1 ELSE 2 END,r.created_at DESC LIMIT 200
      `).all(institutionId);
      const applications=rows.map(row=>{
        let application={};try{application=decrypt(JSON.parse(row.encrypted_application));}catch{}
        const {encrypted_application,...safe}=row;return {...safe,...application};
      });
      res.setHeader("Cache-Control","private, no-store");
      return res.json({success:true,applications});
    } catch(error) { next(error); }
  });

  app.patch("/api/institutions/:institutionId/admission-requests/:requestId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=clean(req.params.institutionId,128);
      const member=getInstitutionMembership(req.user.id,institutionId);
      if(!member || member.status!=="active" || member.role!=="institution_admin") return fail(res,403,"Only an active Institution Admin can review admission requests.");
      const requestId=clean(req.params.requestId,128);
      const row=database.prepare("SELECT id,student_user_id,status,encrypted_application FROM institution_admission_requests WHERE id=? AND institution_id=?").get(requestId,institutionId);
      if(!row) return fail(res,404,"Admission request not found in this institution.");
      if(!["submitted","needs_correction"].includes(row.status)) return fail(res,409,"This admission request has already been finalized.");
      const status=clean(req.body?.status,32);
      if(!["approved","rejected","needs_correction"].includes(status)) return fail(res,400,"Choose approve, reject or needs correction.");
      const note=clean(req.body?.reviewNote,500);
      const timestamp=now();
      const application=decrypt(JSON.parse(row.encrypted_application));
      database.exec("BEGIN IMMEDIATE");
      try {
        const changed=database.prepare("UPDATE institution_admission_requests SET status=?,review_note=?,reviewed_by=?,updated_at=? WHERE id=? AND institution_id=? AND status IN ('submitted','needs_correction')")
          .run(status,note||null,req.user.id,timestamp,requestId,institutionId);
        if(changed.changes!==1) throw new Error("This admission request has already been reviewed.");
        if(status==="approved"){
          const existing=database.prepare("SELECT id,status,role FROM institution_memberships WHERE institution_id=? AND user_id=?").get(institutionId,row.student_user_id);
          if(existing && existing.status==="active" && existing.role!=="student") throw new Error("This account already has a non-student institution membership; an Owner must resolve it before admission approval.");
          if(existing && existing.status==="suspended") throw new Error("This account has a suspended institution membership; an Owner must resolve it before admission approval.");
          if(existing && existing.role!=="student") throw new Error("This account already has a non-student institution membership.");
          if(!existing){
            database.prepare("INSERT INTO institution_memberships(id,institution_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,'student','active',?,?)")
              .run(id(),institutionId,row.student_user_id,timestamp,timestamp);
          }
          database.prepare(`
            INSERT INTO institution_student_profiles(institution_id,user_id,student_number,department,program,academic_year,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,'active',?,?)
            ON CONFLICT(institution_id,user_id) DO UPDATE SET
              student_number=excluded.student_number,department=excluded.department,program=excluded.program,
              academic_year=excluded.academic_year,status='active',updated_at=excluded.updated_at
          `).run(institutionId,row.student_user_id,application.studentNumber||null,application.department,application.course,application.academicYear,timestamp,timestamp);
        }
        database.prepare("INSERT INTO institution_admission_audit(id,request_id,institution_id,actor_user_id,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(id(),requestId,institutionId,req.user.id,status,row.status,status,note||null,timestamp);
        database.exec("COMMIT");
      } catch(transactionError) {
        try { database.exec("ROLLBACK"); } catch {}
        throw transactionError;
      }
      return res.json({success:true,status,message:status==="approved"?"Admission approved and student membership created.":"Admission review updated."});
    } catch(error) {
      if(String(error?.message||"").includes("non-student institution membership") || String(error?.message||"").includes("suspended institution membership")) return fail(res,409,error.message);
      next(error);
    }
  });
}
