import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const safeText = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

export function registerInstitutionModules({
  app, database, requireAuth, requireMfaProduction, enforceSameOrigin,
  getInstitutionMembership, hasInstitutionFeature
}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_student_profiles (
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_number TEXT, department TEXT, program TEXT, academic_year TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','graduated','suspended','withdrawn')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(institution_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS institution_staff (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL, email TEXT, employee_code TEXT, department TEXT, designation TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_staff_code
      ON institution_staff(institution_id,employee_code) WHERE employee_code IS NOT NULL AND employee_code <> '';
    CREATE TABLE IF NOT EXISTS institution_courses (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      course_code TEXT NOT NULL, title TEXT NOT NULL, department TEXT, academic_year TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(institution_id,course_code,academic_year)
    );
    CREATE TABLE IF NOT EXISTS institution_course_enrollments (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES institution_courses(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'enrolled' CHECK(status IN ('enrolled','completed','withdrawn')),
      enrolled_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL,
      UNIQUE(course_id,student_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_institution_enrollments_student
      ON institution_course_enrollments(institution_id,student_user_id,status);
    CREATE TRIGGER IF NOT EXISTS institution_enrollment_validate_membership
    BEFORE INSERT ON institution_course_enrollments
    WHEN NOT EXISTS (
      SELECT 1 FROM institution_courses c JOIN institution_memberships m
        ON m.institution_id=c.institution_id AND m.user_id=NEW.student_user_id
      WHERE c.id=NEW.course_id AND c.institution_id=NEW.institution_id
        AND m.role='student' AND m.status='active'
    )
    BEGIN SELECT RAISE(ABORT,'INVALID_INSTITUTION_STUDENT_ENROLLMENT'); END;

    CREATE TABLE IF NOT EXISTS institution_timetable_entries (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES institution_courses(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, room TEXT,
      staff_id TEXT REFERENCES institution_staff(id) ON DELETE SET NULL,
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK(starts_at < ends_at)
    );
    CREATE INDEX IF NOT EXISTS idx_institution_timetable_day ON institution_timetable_entries(institution_id,weekday,starts_at);
    CREATE TRIGGER IF NOT EXISTS institution_timetable_prevent_overlap
    BEFORE INSERT ON institution_timetable_entries
    WHEN EXISTS (
      SELECT 1 FROM institution_timetable_entries t
      WHERE t.institution_id=NEW.institution_id AND t.weekday=NEW.weekday
        AND t.starts_at<NEW.ends_at AND t.ends_at>NEW.starts_at
        AND ((NEW.room IS NOT NULL AND NEW.room<>'' AND lower(COALESCE(t.room,''))=lower(NEW.room))
          OR (NEW.staff_id IS NOT NULL AND t.staff_id=NEW.staff_id))
    )
    BEGIN SELECT RAISE(ABORT,'TIMETABLE_RESOURCE_OVERLAP'); END;

    CREATE TABLE IF NOT EXISTS institution_attendance (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES institution_courses(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id), attendance_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
      marked_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(course_id,student_user_id,attendance_date)
    );
    CREATE TABLE IF NOT EXISTS institution_fee_invoices (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id), fee_head TEXT NOT NULL, description TEXT,
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), due_date TEXT,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid','cancelled')),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS institution_fee_payments (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES institution_fee_invoices(id),
      student_user_id TEXT NOT NULL REFERENCES users(id), amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      method TEXT NOT NULL CHECK(method IN ('cash','upi','bank_transfer','card','other')),
      reference TEXT, idempotency_key TEXT NOT NULL, received_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, UNIQUE(institution_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_inst_invoice_student ON institution_fee_invoices(institution_id,student_user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inst_attendance_course_date ON institution_attendance(institution_id,course_id,attendance_date);
    CREATE TABLE IF NOT EXISTS institution_assessments (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES institution_courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL, exam_date TEXT NOT NULL, total_marks_hundredths INTEGER NOT NULL CHECK(total_marks_hundredths > 0),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS institution_assessment_results (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      assessment_id TEXT NOT NULL REFERENCES institution_assessments(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id), marks_hundredths INTEGER NOT NULL CHECK(marks_hundredths >= 0),
      recorded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(assessment_id,student_user_id)
    );
    CREATE TABLE IF NOT EXISTS institution_operations_audit (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, details_json TEXT, created_at TEXT NOT NULL
    );
  `);

  // New pilot modules are included for existing pilot institutions; this does not change paid plans or billing.
  const pilots = database.prepare("SELECT institution_id,features_json FROM institution_subscriptions WHERE status='pilot'").all();
  const added = ["student_management","staff_management","finance","academics","library"];
  for (const row of pilots) {
    let features = [];
    try { features = JSON.parse(row.features_json || "[]"); } catch {}
    if (!Array.isArray(features)) features = [];
    const next = [...new Set([...features, ...added])];
    if (next.length !== features.length) database.prepare("UPDATE institution_subscriptions SET features_json=?,updated_at=? WHERE institution_id=? AND status='pilot'")
      .run(JSON.stringify(next), iso(), row.institution_id);
  }

  function access(req, res, institutionId, feature, roles = ["institution_admin"]) {
    if (!institutionId || institutionId.length > 128) { fail(res, 400, "A valid institution is required."); return null; }
    if (!hasInstitutionFeature(institutionId, feature)) { fail(res, 403, "This module is not enabled for the institution.", "FEATURE_NOT_ENTITLED"); return null; }
    const member = getInstitutionMembership(req.user.id, institutionId);
    if (!member || member.status !== "active" || !roles.includes(member.role)) { fail(res, 403, "Your institution role does not allow this action."); return null; }
    return member;
  }
  function audit(institutionId, actor, action, type, entityId, details = {}) {
    database.prepare("INSERT INTO institution_operations_audit(id,institution_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), institutionId, actor, action, type, entityId || null, JSON.stringify(details), iso());
  }

  app.get("/api/institutions/:institutionId/operations/overview", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId = safeText(req.params.institutionId,128);
      const member = getInstitutionMembership(req.user.id,institutionId);
      if (!member || member.status !== "active" || member.role !== "institution_admin") return fail(res,403,"Institution administrator access is required.");
      const students = Number(database.prepare("SELECT COUNT(*) AS n FROM institution_memberships WHERE institution_id=? AND role='student' AND status='active'").get(institutionId).n);
      const staff = Number(database.prepare("SELECT COUNT(*) AS n FROM institution_staff WHERE institution_id=? AND status='active'").get(institutionId).n);
      const courses = Number(database.prepare("SELECT COUNT(*) AS n FROM institution_courses WHERE institution_id=?").get(institutionId).n);
      const invoices = database.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(CASE WHEN status<>'paid' AND status<>'cancelled' THEN amount_paise ELSE 0 END),0) AS billed FROM institution_fee_invoices WHERE institution_id=?").get(institutionId);
      const payments = database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS total FROM institution_fee_payments WHERE institution_id=?").get(institutionId);
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,overview:{students,staff,courses,invoices:Number(invoices.n),billedPaise:Number(invoices.billed),collectedPaise:Number(payments.total)}});
    } catch (error) { next(error); }
  });

  app.get("/api/institutions/:institutionId/students", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);
      const member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only"].includes(member.role)) return fail(res,403,"Student directory access is not allowed for this role.");
      if(!hasInstitutionFeature(institutionId,"student_management")) return fail(res,403,"Student management is not enabled.","FEATURE_NOT_ENTITLED");
      const rows=database.prepare(`
        SELECT m.user_id AS userId,u.email,p.student_number AS studentNumber,p.department,p.program,
          p.academic_year AS academicYear,COALESCE(p.status,'active') AS status,m.created_at AS joinedAt
        FROM institution_memberships m JOIN users u ON u.id=m.user_id
        LEFT JOIN institution_student_profiles p ON p.institution_id=m.institution_id AND p.user_id=m.user_id
        WHERE m.institution_id=? AND m.role='student' AND m.status='active'
        ORDER BY u.email COLLATE NOCASE LIMIT 500
      `).all(institutionId);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,students:rows});
    } catch(error){next(error);}
  });

  app.put("/api/institutions/:institutionId/students/:userId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128), userId=safeText(req.params.userId,128);
      if(!access(req,res,institutionId,"student_management")) return;
      const membership=database.prepare("SELECT id FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(institutionId,userId);
      if(!membership) return fail(res,404,"Active student membership was not found.");
      const studentNumber=safeText(req.body?.studentNumber,60),department=safeText(req.body?.department,100),program=safeText(req.body?.program,120),academicYear=safeText(req.body?.academicYear,20),status=safeText(req.body?.status||"active",20);
      if(!["active","graduated","suspended","withdrawn"].includes(status)||!/^$|^20\d{2}-20\d{2}$/.test(academicYear)) return fail(res,400,"Enter a valid student status and academic year.");
      const now=iso();
      database.prepare(`INSERT INTO institution_student_profiles(institution_id,user_id,student_number,department,program,academic_year,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(institution_id,user_id) DO UPDATE SET student_number=excluded.student_number,department=excluded.department,program=excluded.program,academic_year=excluded.academic_year,status=excluded.status,updated_at=excluded.updated_at`)
        .run(institutionId,userId,studentNumber||null,department||null,program||null,academicYear||null,status,now,now);
      audit(institutionId,req.user.id,"student_profile_updated","student",userId,{status});
      res.setHeader("Cache-Control","private, no-store");res.json({success:true});
    } catch(error){next(error);}
  });

  app.get("/api/institutions/:institutionId/staff", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only"].includes(member.role)) return fail(res,403,"Staff directory access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"staff_management")) return fail(res,403,"Staff management is not enabled.","FEATURE_NOT_ENTITLED");
      const staff=database.prepare("SELECT id,user_id AS userId,full_name AS fullName,email,employee_code AS employeeCode,department,designation,status,created_at AS createdAt FROM institution_staff WHERE institution_id=? ORDER BY full_name COLLATE NOCASE LIMIT 500").all(institutionId);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,staff});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/staff", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"staff_management"))return;
      const fullName=safeText(req.body?.fullName,120),email=safeText(req.body?.email,254).toLowerCase(),employeeCode=safeText(req.body?.employeeCode,60),department=safeText(req.body?.department,100),designation=safeText(req.body?.designation,100);
      if(fullName.length<2||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail(res,400,"Enter a valid staff name and email.");
      const staffId=id(),now=iso();
      database.prepare("INSERT INTO institution_staff(id,institution_id,full_name,email,employee_code,department,designation,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?,?)")
        .run(staffId,institutionId,fullName,email||null,employeeCode||null,department||null,designation||null,req.user.id,now,now);
      audit(institutionId,req.user.id,"staff_created","staff",staffId);
      res.status(201).json({success:true,staff:{id:staffId,fullName,email,employeeCode,department,designation,status:"active"}});
    }catch(error){if(String(error?.code||"").includes("CONSTRAINT"))return fail(res,409,"That employee code is already in use.");next(error);}
  });
  app.patch("/api/institutions/:institutionId/staff/:staffId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"staff_management"))return;
      const staffId=safeText(req.params.staffId,128),row=database.prepare("SELECT id FROM institution_staff WHERE id=? AND institution_id=?").get(staffId,institutionId);
      if(!row)return fail(res,404,"Staff record was not found.");
      const status=safeText(req.body?.status,20);if(!["active","inactive"].includes(status))return fail(res,400,"Choose active or inactive status.");
      database.prepare("UPDATE institution_staff SET status=?,updated_at=? WHERE id=? AND institution_id=?").run(status,iso(),staffId,institutionId);
      audit(institutionId,req.user.id,"staff_status_changed","staff",staffId,{status});res.json({success:true,status});
    }catch(error){next(error);}
  });

  app.get("/api/institutions/:institutionId/courses", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only","student"].includes(member.role))return fail(res,403,"Course access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"academics"))return fail(res,403,"Academics is not enabled.","FEATURE_NOT_ENTITLED");
      const courses=database.prepare("SELECT id,course_code AS courseCode,title,department,academic_year AS academicYear FROM institution_courses WHERE institution_id=? ORDER BY title LIMIT 300").all(institutionId);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,courses});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/courses", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics"))return;
      const courseCode=safeText(req.body?.courseCode,30).toUpperCase(),title=safeText(req.body?.title,120),department=safeText(req.body?.department,100),academicYear=safeText(req.body?.academicYear,20);
      if(!/^[A-Z0-9_-]{2,30}$/.test(courseCode)||title.length<2||!/^20\d{2}-20\d{2}$/.test(academicYear))return fail(res,400,"Enter a valid course code, title and academic year.");
      const courseId=id(),now=iso();
      database.prepare("INSERT INTO institution_courses(id,institution_id,course_code,title,department,academic_year,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(courseId,institutionId,courseCode,title,department||null,academicYear,req.user.id,now,now);
      audit(institutionId,req.user.id,"course_created","course",courseId);
      res.status(201).json({success:true,course:{id:courseId,courseCode,title,department,academicYear}});
    }catch(error){if(String(error?.code||"").includes("CONSTRAINT"))return fail(res,409,"That course code already exists for this academic year.");next(error);}
  });
  app.get("/api/institutions/:institutionId/enrollments", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only","student"].includes(member.role))return fail(res,403,"Course enrollment access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"academics"))return fail(res,403,"Academics is not enabled.","FEATURE_NOT_ENTITLED");
      const studentOnly=member.role==="student";
      const rows=database.prepare(`
        SELECT e.id,e.course_id AS courseId,c.course_code AS courseCode,c.title AS courseTitle,
          e.student_user_id AS studentUserId,u.email AS studentEmail,e.status,e.enrolled_at AS enrolledAt
        FROM institution_course_enrollments e
        JOIN institution_courses c ON c.id=e.course_id
        JOIN users u ON u.id=e.student_user_id
        WHERE e.institution_id=? ${studentOnly?"AND e.student_user_id=?":""}
        ORDER BY c.title,u.email COLLATE NOCASE LIMIT 1000
      `).all(...(studentOnly?[institutionId,req.user.id]:[institutionId]));
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,enrollments:rows});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/enrollments", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics"))return;
      const courseId=safeText(req.body?.courseId,128),studentUserId=safeText(req.body?.studentUserId,128);
      const course=database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(courseId,institutionId);
      const student=database.prepare("SELECT id FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(institutionId,studentUserId);
      if(!course||!student)return fail(res,400,"Choose a course and an active student from this institution.");
      const existing=database.prepare("SELECT id,status FROM institution_course_enrollments WHERE course_id=? AND student_user_id=?").get(courseId,studentUserId);
      if(existing?.status==="enrolled")return fail(res,409,"This student is already enrolled in the selected course.");
      const now=iso(),enrollmentId=existing?.id||id();
      if(existing)database.prepare("UPDATE institution_course_enrollments SET status='enrolled',enrolled_at=?,created_by=?,updated_at=? WHERE id=? AND institution_id=?")
        .run(now,req.user.id,now,enrollmentId,institutionId);
      else database.prepare("INSERT INTO institution_course_enrollments(id,institution_id,course_id,student_user_id,status,enrolled_at,created_by,updated_at) VALUES(?,?,?,?,'enrolled',?,?,?)")
        .run(enrollmentId,institutionId,courseId,studentUserId,now,req.user.id,now);
      audit(institutionId,req.user.id,existing?"course_enrollment_reactivated":"course_student_enrolled","course_enrollment",enrollmentId,{courseId,studentUserId});
      res.status(existing?200:201).json({success:true,enrollment:{id:enrollmentId,courseId,studentUserId,status:"enrolled"}});
    }catch(error){
      if(String(error?.message||"").includes("INVALID_INSTITUTION_STUDENT_ENROLLMENT"))return fail(res,400,"Only an active student in this institution can be enrolled.");
      if(String(error?.code||"").includes("CONSTRAINT"))return fail(res,409,"This course enrollment conflicts with an existing record.");
      next(error);
    }
  });
  app.delete("/api/institutions/:institutionId/enrollments/:enrollmentId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics"))return;
      const enrollmentId=safeText(req.params.enrollmentId,128),row=database.prepare("SELECT id,status FROM institution_course_enrollments WHERE id=? AND institution_id=?").get(enrollmentId,institutionId);
      if(!row)return fail(res,404,"Course enrollment was not found.");
      if(row.status!=="enrolled")return fail(res,409,"Only an active enrollment can be withdrawn.");
      database.prepare("UPDATE institution_course_enrollments SET status='withdrawn',updated_at=? WHERE id=? AND institution_id=?").run(iso(),enrollmentId,institutionId);
      audit(institutionId,req.user.id,"course_student_withdrawn","course_enrollment",enrollmentId);
      res.json({success:true,status:"withdrawn"});
    }catch(error){next(error);}
  });

  app.get("/api/institutions/:institutionId/timetable", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only","student"].includes(member.role))return fail(res,403,"Timetable access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"academics"))return fail(res,403,"Academics is not enabled.","FEATURE_NOT_ENTITLED");
      const rows=database.prepare(`SELECT t.id,t.course_id AS courseId,c.course_code AS courseCode,c.title AS courseTitle,t.weekday,t.starts_at AS startsAt,t.ends_at AS endsAt,t.room,t.staff_id AS staffId,s.full_name AS staffName
        FROM institution_timetable_entries t JOIN institution_courses c ON c.id=t.course_id LEFT JOIN institution_staff s ON s.id=t.staff_id
        WHERE t.institution_id=? ORDER BY t.weekday,t.starts_at LIMIT 500`).all(institutionId);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,entries:rows});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/timetable", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics"))return;
      const courseId=safeText(req.body?.courseId,128),weekday=Number(req.body?.weekday),startsAt=safeText(req.body?.startsAt,5),endsAt=safeText(req.body?.endsAt,5),room=safeText(req.body?.room,80),staffId=safeText(req.body?.staffId,128);
      if(!Number.isInteger(weekday)||weekday<1||weekday>7||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endsAt)||startsAt>=endsAt)return fail(res,400,"Choose a weekday and a valid start/end time.");
      if(!database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(courseId,institutionId))return fail(res,404,"Course was not found in this institution.");
      if(staffId&&!database.prepare("SELECT id FROM institution_staff WHERE id=? AND institution_id=? AND status='active'").get(staffId,institutionId))return fail(res,404,"Active staff member was not found in this institution.");
      const overlap=database.prepare("SELECT id FROM institution_timetable_entries WHERE institution_id=? AND weekday=? AND starts_at<? AND ends_at>? AND ((?<>'' AND COALESCE(room,'')=?) OR (?<>'' AND staff_id=?))").get(institutionId,weekday,endsAt,startsAt,room,room,staffId,staffId);
      if(overlap)return fail(res,409,"This time overlaps another timetable entry. Choose a different time.");
      const entryId=id(),now=iso();
      database.prepare("INSERT INTO institution_timetable_entries(id,institution_id,course_id,weekday,starts_at,ends_at,room,staff_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(entryId,institutionId,courseId,weekday,startsAt,endsAt,room||null,staffId||null,req.user.id,now,now);
      audit(institutionId,req.user.id,"timetable_entry_created","timetable",entryId,{courseId,weekday,startsAt,endsAt,room,staffId:staffId||null});
      res.status(201).json({success:true,entry:{id:entryId,courseId,weekday,startsAt,endsAt,room,staffId:staffId||null}});
    }catch(error){if(String(error?.code||"").includes("CONSTRAINT")||String(error?.message||"").includes("TIMETABLE_RESOURCE_OVERLAP"))return fail(res,409,"The selected room or faculty member already has a class during this time.");next(error);}
  });
  app.delete("/api/institutions/:institutionId/timetable/:entryId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics"))return;
      const entryId=safeText(req.params.entryId,128),row=database.prepare("SELECT id FROM institution_timetable_entries WHERE id=? AND institution_id=?").get(entryId,institutionId);
      if(!row)return fail(res,404,"Timetable entry was not found.");
      database.prepare("DELETE FROM institution_timetable_entries WHERE id=? AND institution_id=?").run(entryId,institutionId);
      audit(institutionId,req.user.id,"timetable_entry_deleted","timetable",entryId);
      res.json({success:true});
    }catch(error){next(error);}
  });

  app.get("/api/institutions/:institutionId/courses/:courseId/attendance", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),courseId=safeText(req.params.courseId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only","student"].includes(member.role))return fail(res,403,"Attendance access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"academics"))return fail(res,403,"Academics is not enabled.","FEATURE_NOT_ENTITLED");
      const course=database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(courseId,institutionId);if(!course)return fail(res,404,"Course was not found.");
      const isStudent=member.role==="student";
      const rows=database.prepare("SELECT student_user_id AS studentUserId,attendance_date AS date,status FROM institution_attendance WHERE institution_id=? AND course_id=? "+(isStudent?"AND student_user_id=? ":"")+"ORDER BY attendance_date DESC LIMIT 500").all(...(isStudent?[institutionId,courseId,req.user.id]:[institutionId,courseId]));
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,attendance:rows});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/courses/:courseId/attendance", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics",["institution_admin","reviewer"]))return;
      const courseId=safeText(req.params.courseId,128),studentUserId=safeText(req.body?.studentUserId,128),date=safeText(req.body?.date,10),status=safeText(req.body?.status,20);
      if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||!["present","absent","late","excused"].includes(status))return fail(res,400,"Enter a valid date and attendance status.");
      const course=database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(courseId,institutionId);
      const student=database.prepare("SELECT id FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(institutionId,studentUserId);
      if(!course||!student)return fail(res,404,"Course or active student membership was not found.");
      const now=iso(),attendanceId=id();
      database.prepare(`INSERT INTO institution_attendance(id,institution_id,course_id,student_user_id,attendance_date,status,marked_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(course_id,student_user_id,attendance_date) DO UPDATE SET status=excluded.status,marked_by=excluded.marked_by,updated_at=excluded.updated_at`)
        .run(attendanceId,institutionId,courseId,studentUserId,date,status,req.user.id,now,now);
      const saved=database.prepare("SELECT id FROM institution_attendance WHERE course_id=? AND student_user_id=? AND attendance_date=?").get(courseId,studentUserId,date);
      audit(institutionId,req.user.id,"attendance_recorded","attendance",saved?.id||attendanceId,{courseId,studentUserId,date,status});
      res.status(201).json({success:true});
    }catch(error){next(error);}
  });

  app.get("/api/institutions/:institutionId/finance", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","student"].includes(member.role))return fail(res,403,"Finance access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"finance"))return fail(res,403,"Finance is not enabled.","FEATURE_NOT_ENTITLED");
      const studentOnly=member.role==="student";
      const invoices=database.prepare(`
        SELECT i.id,i.student_user_id AS studentUserId,u.email AS studentEmail,i.fee_head AS feeHead,
          i.description,i.amount_paise AS amountPaise,i.due_date AS dueDate,i.status,i.created_at AS createdAt,
          COALESCE((SELECT SUM(p.amount_paise) FROM institution_fee_payments p WHERE p.invoice_id=i.id),0) AS paidPaise
        FROM institution_fee_invoices i JOIN users u ON u.id=i.student_user_id
        WHERE i.institution_id=? ${studentOnly?"AND i.student_user_id=?":""}
        ORDER BY i.created_at DESC LIMIT 500
      `).all(...(studentOnly?[institutionId,req.user.id]:[institutionId]));
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,invoices});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/finance/invoices", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"finance"))return;
      const studentUserId=safeText(req.body?.studentUserId,128),feeHead=safeText(req.body?.feeHead,80),description=safeText(req.body?.description,300),dueDate=safeText(req.body?.dueDate,10);
      const amountPaise=Number(req.body?.amountPaise);
      const student=database.prepare("SELECT id FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(institutionId,studentUserId);
      if(!student||feeHead.length<2||!Number.isSafeInteger(amountPaise)||amountPaise<1||amountPaise>100000000000||dueDate&&!/^20\d{2}-\d{2}-\d{2}$/.test(dueDate))return fail(res,400,"Enter a valid active student, fee head, amount in paise and due date.");
      const invoiceId=id(),now=iso();
      database.prepare("INSERT INTO institution_fee_invoices(id,institution_id,student_user_id,fee_head,description,amount_paise,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(invoiceId,institutionId,studentUserId,feeHead,description||null,amountPaise,dueDate||null,req.user.id,now,now);
      audit(institutionId,req.user.id,"fee_invoice_created","invoice",invoiceId,{studentUserId,amountPaise});
      res.status(201).json({success:true,invoice:{id:invoiceId,amountPaise,status:"unpaid"}});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/finance/invoices/:invoiceId/payments", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"finance"))return;
      const invoiceId=safeText(req.params.invoiceId,128),amountPaise=Number(req.body?.amountPaise),method=safeText(req.body?.method,20),reference=safeText(req.body?.reference,100),idempotencyKey=safeText(req.get("Idempotency-Key")||req.body?.idempotencyKey,100);
      if(!Number.isSafeInteger(amountPaise)||amountPaise<1||!["cash","upi","bank_transfer","card","other"].includes(method)||idempotencyKey.length<12)return fail(res,400,"Enter a valid payment amount, method and unique idempotency key.");
      const insert=()=>{
        const invoice=database.prepare("SELECT id,student_user_id,amount_paise,status FROM institution_fee_invoices WHERE id=? AND institution_id=?").get(invoiceId,institutionId);
        if(!invoice||invoice.status==="cancelled")throw Object.assign(new Error("Invoice was not found or is cancelled."),{status:404});
        const duplicate=database.prepare("SELECT id FROM institution_fee_payments WHERE institution_id=? AND idempotency_key=?").get(institutionId,idempotencyKey);
        if(duplicate)return {paymentId:duplicate.id,duplicate:true};
        const paid=Number(database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM institution_fee_payments WHERE invoice_id=?").get(invoiceId).n);
        if(paid+amountPaise>Number(invoice.amount_paise))throw Object.assign(new Error("Payment exceeds the outstanding invoice balance."),{status:409});
        const paymentId=id(),now=iso();
        database.prepare("INSERT INTO institution_fee_payments(id,institution_id,invoice_id,student_user_id,amount_paise,method,reference,idempotency_key,received_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(paymentId,institutionId,invoiceId,invoice.student_user_id,amountPaise,method,reference||null,idempotencyKey,req.user.id,now);
        const nextPaid=paid+amountPaise,status=nextPaid===Number(invoice.amount_paise)?"paid":"partial";
        database.prepare("UPDATE institution_fee_invoices SET status=?,updated_at=? WHERE id=?").run(status,now,invoiceId);
        audit(institutionId,req.user.id,"fee_payment_received","payment",paymentId,{invoiceId,amountPaise,method});
        const paymentResult={paymentId,duplicate:false,status,paidPaise:nextPaid};database.exec("COMMIT");return paymentResult;
      };
      database.exec("BEGIN IMMEDIATE");
      let result;
      try { result=insert(); } catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; }
      res.status(result.duplicate?200:201).json({success:true,...result});
    }catch(error){if(error.status)return fail(res,error.status,error.message);if(String(error?.code||"").includes("CONSTRAINT"))return fail(res,409,"This payment key has already been used.");next(error);}
  });

  app.get("/api/institutions/:institutionId/courses/:courseId/assessments", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),courseId=safeText(req.params.courseId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","reviewer","read_only","student"].includes(member.role))return fail(res,403,"Assessment access is not allowed.");
      if(!hasInstitutionFeature(institutionId,"academics"))return fail(res,403,"Academics is not enabled.","FEATURE_NOT_ENTITLED");
      const course=database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(courseId,institutionId);
      if(!course)return fail(res,404,"Course was not found.");
      const studentOnly=member.role==="student";
      const assessments=database.prepare(`
        SELECT a.id,a.title,a.exam_date AS examDate,a.total_marks_hundredths AS totalMarksHundredths,
          r.marks_hundredths AS marksHundredths
        FROM institution_assessments a
        LEFT JOIN institution_assessment_results r ON r.assessment_id=a.id ${studentOnly?"AND r.student_user_id=?":""}
        WHERE a.institution_id=? AND a.course_id=? ORDER BY a.exam_date DESC,a.created_at DESC LIMIT 300
      `).all(...(studentOnly?[req.user.id,institutionId,courseId]:[institutionId,courseId]));
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,assessments:assessments.map(a=>({...a,totalMarks:a.totalMarksHundredths/100,marksObtained:a.marksHundredths==null?null:a.marksHundredths/100}))});
    }catch(error){next(error);}
  });
  app.post("/api/institutions/:institutionId/courses/:courseId/assessments", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics",["institution_admin","reviewer"]))return;
      const courseId=safeText(req.params.courseId,128),title=safeText(req.body?.title,120),examDate=safeText(req.body?.examDate,10),totalMarks=Number(req.body?.totalMarks);
      const course=database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(courseId,institutionId);
      if(!course||title.length<2||!/^20\d{2}-\d{2}-\d{2}$/.test(examDate)||!Number.isFinite(totalMarks)||totalMarks<=0||totalMarks>100000||Math.round(totalMarks*100)!==totalMarks*100)return fail(res,400,"Enter a valid course, assessment title, date and total marks (up to two decimals).");
      const assessmentId=id(),now=iso(),totalMarksHundredths=Math.round(totalMarks*100);
      database.prepare("INSERT INTO institution_assessments(id,institution_id,course_id,title,exam_date,total_marks_hundredths,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(assessmentId,institutionId,courseId,title,examDate,totalMarksHundredths,req.user.id,now,now);
      audit(institutionId,req.user.id,"assessment_created","assessment",assessmentId,{courseId,title,examDate,totalMarksHundredths});
      res.status(201).json({success:true,assessment:{id:assessmentId,title,examDate,totalMarks}});
    }catch(error){next(error);}
  });
  app.put("/api/institutions/:institutionId/assessments/:assessmentId/results/:studentUserId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128);if(!access(req,res,institutionId,"academics",["institution_admin","reviewer"]))return;
      const assessmentId=safeText(req.params.assessmentId,128),studentUserId=safeText(req.params.studentUserId,128),marks=Number(req.body?.marksObtained);
      const assessment=database.prepare("SELECT id,total_marks_hundredths AS totalMarks FROM institution_assessments WHERE id=? AND institution_id=?").get(assessmentId,institutionId);
      const student=database.prepare("SELECT id FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(institutionId,studentUserId);
      if(!assessment||!student||!Number.isFinite(marks)||marks<0||Math.round(marks*100)!==marks*100||Math.round(marks*100)>Number(assessment.totalMarks))return fail(res,400,"Choose an active student and enter marks within the assessment maximum.");
      const now=iso(),resultId=id(),marksHundredths=Math.round(marks*100);
      database.prepare(`INSERT INTO institution_assessment_results(id,institution_id,assessment_id,student_user_id,marks_hundredths,recorded_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(assessment_id,student_user_id) DO UPDATE SET marks_hundredths=excluded.marks_hundredths,recorded_by=excluded.recorded_by,updated_at=excluded.updated_at`)
        .run(resultId,institutionId,assessmentId,studentUserId,marksHundredths,req.user.id,now,now);
      const saved=database.prepare("SELECT id FROM institution_assessment_results WHERE assessment_id=? AND student_user_id=?").get(assessmentId,studentUserId);
      audit(institutionId,req.user.id,"assessment_result_recorded","assessment_result",saved?.id||resultId,{assessmentId,studentUserId,marksHundredths});
      res.json({success:true,marksObtained:marks});
    }catch(error){next(error);}
  });

  app.get("/api/institutions/:institutionId/operations/audit", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=safeText(req.params.institutionId,128),member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||!["institution_admin","read_only"].includes(member.role))return fail(res,403,"Institution audit access is not allowed.");
      const events=database.prepare("SELECT action,entity_type AS entityType,entity_id AS entityId,details_json AS details,created_at AS createdAt FROM institution_operations_audit WHERE institution_id=? ORDER BY created_at DESC LIMIT 200").all(institutionId);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,events});
    }catch(error){next(error);}
  });
}
