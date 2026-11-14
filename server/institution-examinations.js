import crypto from "node:crypto";
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),clean=(v,n=160)=>String(v??"").trim().slice(0,n);
const fail=(res,s,m)=>res.status(s).json({success:false,message:m});
const htmlEscape=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
const institutionTypeLabel=v=>({school:"School",college:"College",university:"University",institution:"Institution"}[v]||"Institution");
export function registerInstitutionExaminations({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 database.exec(`
  CREATE TABLE IF NOT EXISTS institution_exams(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   title TEXT NOT NULL,academic_year TEXT NOT NULL,term TEXT,registration_open_at TEXT,registration_close_at TEXT,
   starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,fee_clearance_required INTEGER NOT NULL DEFAULT 1 CHECK(fee_clearance_required IN (0,1)),
   status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','registration_open','scheduled','marks_entry','published','cancelled')),
   created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS institution_exam_subjects(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   exam_id TEXT NOT NULL REFERENCES institution_exams(id) ON DELETE CASCADE,
   course_id TEXT REFERENCES institution_courses(id) ON DELETE SET NULL,
   subject_code TEXT NOT NULL,title TEXT NOT NULL,exam_date TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,
   venue TEXT,total_marks_hundredths INTEGER NOT NULL CHECK(total_marks_hundredths>0),passing_marks_hundredths INTEGER NOT NULL CHECK(passing_marks_hundredths>=0),
   created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(exam_id,subject_code)
  );
  CREATE TABLE IF NOT EXISTS institution_exam_registrations(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   exam_id TEXT NOT NULL REFERENCES institution_exams(id) ON DELETE CASCADE,
   student_user_id TEXT NOT NULL REFERENCES users(id),roll_number TEXT,status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','approved','rejected','withdrawn')),
   registered_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(exam_id,student_user_id),UNIQUE(exam_id,roll_number)
  );
  CREATE TABLE IF NOT EXISTS institution_exam_marks(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   exam_id TEXT NOT NULL REFERENCES institution_exams(id) ON DELETE CASCADE,
   subject_id TEXT NOT NULL REFERENCES institution_exam_subjects(id) ON DELETE CASCADE,
   student_user_id TEXT NOT NULL REFERENCES users(id),marks_hundredths INTEGER NOT NULL CHECK(marks_hundredths>=0),
   entered_by TEXT NOT NULL REFERENCES users(id),entered_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   UNIQUE(subject_id,student_user_id)
  );
  CREATE TABLE IF NOT EXISTS institution_exam_audit(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   actor_user_id TEXT NOT NULL REFERENCES users(id),exam_id TEXT,action TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_exam_registrations_student ON institution_exam_registrations(institution_id,student_user_id,status);
  CREATE TABLE IF NOT EXISTS institution_exam_seating(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,exam_id TEXT NOT NULL REFERENCES institution_exams(id) ON DELETE CASCADE,registration_id TEXT NOT NULL UNIQUE REFERENCES institution_exam_registrations(id) ON DELETE CASCADE,venue TEXT NOT NULL,room TEXT NOT NULL,seat_number TEXT NOT NULL,assigned_by TEXT NOT NULL REFERENCES users(id),assigned_at TEXT NOT NULL,UNIQUE(exam_id,venue,room,seat_number));
 `);
 try{database.exec("ALTER TABLE institutions ADD COLUMN institution_type TEXT NOT NULL DEFAULT 'college' CHECK(institution_type IN ('school','college','university','institution'))");}catch(e){if(!String(e.message||"").includes("duplicate column name"))throw e;}
 function member(req,res,i,roles){const m=getInstitutionMembership(req.user.id,i);if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this examination action.");return null;}if(!hasInstitutionFeature(i,"academics")){fail(res,403,"Academics entitlement is required.");return null;}return m;}
 function audit(i,u,e,a,d={}){database.prepare("INSERT INTO institution_exam_audit(id,institution_id,actor_user_id,exam_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(id(),i,u,e||null,a,JSON.stringify(d),now());}
 app.patch("/api/institutions/:institutionId/examinations/settings",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{const i=clean(req.params.institutionId,128);if(!member(req,res,i,["institution_admin"]))return;const type=clean(req.body?.institutionType,24);if(!["school","college","university","institution"].includes(type))return fail(res,400,"Choose School, College, University or Other institution.");const result=database.prepare("UPDATE institutions SET institution_type=? WHERE id=?").run(type,i);if(!result.changes)return fail(res,404,"Institution not found.");audit(i,req.user.id,null,"institution_type_updated",{institutionType:type});return res.json({success:true,institutionType:type});}catch(e){next(e);}});
 app.get("/api/institutions/:institutionId/examinations",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),m=member(req,res,i,["institution_admin","reviewer","read_only","student"]);if(!m)return;
  const institution=database.prepare("SELECT name,institution_type AS institutionType FROM institutions WHERE id=?").get(i);const exams=database.prepare("SELECT id,title,academic_year AS academicYear,term,registration_open_at AS registrationOpenAt,registration_close_at AS registrationCloseAt,starts_at AS startsAt,ends_at AS endsAt,fee_clearance_required AS feeClearanceRequired,status FROM institution_exams WHERE institution_id=? ORDER BY starts_at DESC LIMIT 200").all(i);
  const registrations=database.prepare(`SELECT r.id,r.exam_id AS examId,e.title AS examTitle,r.roll_number AS rollNumber,r.status,r.registered_at AS registeredAt FROM institution_exam_registrations r JOIN institution_exams e ON e.id=r.exam_id WHERE r.institution_id=? ${m.role==="student"?"AND r.student_user_id=?":""} ORDER BY r.registered_at DESC`).all(...(m.role==="student"?[i,req.user.id]:[i]));
  const subjects=database.prepare("SELECT s.id,s.exam_id AS examId,s.subject_code AS subjectCode,s.title,s.exam_date AS examDate,s.starts_at AS startsAt,s.ends_at AS endsAt,s.venue,s.total_marks_hundredths AS totalMarksHundredths,s.passing_marks_hundredths AS passingMarksHundredths FROM institution_exam_subjects s WHERE s.institution_id=? ORDER BY s.exam_date,s.starts_at").all(i);
  const marks=m.role==="student"?database.prepare("SELECT m.exam_id AS examId,m.subject_id AS subjectId,s.title AS subjectTitle,m.marks_hundredths AS marksHundredths,s.total_marks_hundredths AS totalMarksHundredths,s.passing_marks_hundredths AS passingMarksHundredths FROM institution_exam_marks m JOIN institution_exams e ON e.id=m.exam_id JOIN institution_exam_subjects s ON s.id=m.subject_id WHERE m.institution_id=? AND m.student_user_id=? AND e.status='published'").all(i,req.user.id):[];
  res.setHeader("Cache-Control","private, no-store");return res.json({success:true,institutionName:institution?.name||"Institution",institutionType:institution?.institutionType||"college",canManageSettings:m.role==="institution_admin",canDownloadAdmitCards:m.role==="student",exams,registrations,subjects,marks});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/examinations",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128);if(!member(req,res,i,["institution_admin"]))return;
  const title=clean(req.body?.title,180),year=clean(req.body?.academicYear,20),term=clean(req.body?.term,80),starts=clean(req.body?.startsAt,40),ends=clean(req.body?.endsAt,40),open=clean(req.body?.registrationOpenAt,40),close=clean(req.body?.registrationCloseAt,40),fee=req.body?.feeClearanceRequired===false?0:1;
  if(title.length<3||!year||!Number.isFinite(Date.parse(starts))||!Number.isFinite(Date.parse(ends))||Date.parse(ends)<=Date.parse(starts)||(open&& !Number.isFinite(Date.parse(open)))||(close&&!Number.isFinite(Date.parse(close)))||(open&&close&&Date.parse(close)<Date.parse(open)))return fail(res,400,"Enter valid exam title, academic year and registration/exam dates.");
  const examId=id(),ts=now();database.prepare("INSERT INTO institution_exams(id,institution_id,title,academic_year,term,registration_open_at,registration_close_at,starts_at,ends_at,fee_clearance_required,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)").run(examId,i,title,year,term||null,open||null,close||null,starts,ends,fee,req.user.id,ts,ts);
  audit(i,req.user.id,examId,"exam_created",{title,year});return res.status(201).json({success:true,exam:{id:examId,title,academicYear:year,status:"draft"}});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/examinations/:examId/subjects",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128);if(!member(req,res,i,["institution_admin"]))return;
  const exam=database.prepare("SELECT status FROM institution_exams WHERE id=? AND institution_id=?").get(examId,i);if(!exam)return fail(res,404,"Examination not found.");if(exam.status!=="draft"&&exam.status!=="registration_open")return fail(res,409,"Subjects cannot be changed after the examination is scheduled.");
  const code=clean(req.body?.subjectCode,40),title=clean(req.body?.title,160),date=clean(req.body?.examDate,20),starts=clean(req.body?.startsAt,40),ends=clean(req.body?.endsAt,40),venue=clean(req.body?.venue,120),total=Math.round(Number(req.body?.totalMarks)*100),passing=Math.round(Number(req.body?.passingMarks)*100),course=clean(req.body?.courseId,128)||null;
  if(code.length<1||title.length<2||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(starts))||!Number.isFinite(Date.parse(ends))||Date.parse(ends)<=Date.parse(starts)||!Number.isSafeInteger(total)||total<1||!Number.isSafeInteger(passing)||passing<0||passing>total)return fail(res,400,"Enter valid subject, date, time and marks limits.");
  if(course&&!database.prepare("SELECT id FROM institution_courses WHERE id=? AND institution_id=?").get(course,i))return fail(res,404,"Course not found in this institution.");
  const sid=id(),ts=now();const result=database.prepare("INSERT OR IGNORE INTO institution_exam_subjects(id,institution_id,exam_id,course_id,subject_code,title,exam_date,starts_at,ends_at,venue,total_marks_hundredths,passing_marks_hundredths,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(sid,i,examId,course,code,title,date,starts,ends,venue||null,total,passing,ts,ts);
  if(!result.changes)return fail(res,409,"This subject code is already added to the examination.");audit(i,req.user.id,examId,"exam_subject_added",{subjectCode:code,title});return res.status(201).json({success:true,subject:{id:sid,subjectCode:code,title}});
 }catch(e){next(e);}});
 app.patch("/api/institutions/:institutionId/examinations/:examId/status",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128);if(!member(req,res,i,["institution_admin"]))return;
  const status=clean(req.body?.status,30),allowed={draft:["registration_open","cancelled"],registration_open:["scheduled","cancelled"],scheduled:["marks_entry","cancelled"],marks_entry:["published"],published:[],cancelled:[]};
  const exam=database.prepare("SELECT status FROM institution_exams WHERE id=? AND institution_id=?").get(examId,i);if(!exam)return fail(res,404,"Examination not found.");if(!(allowed[exam.status]||[]).includes(status))return fail(res,409,"This examination status transition is not allowed.");
  if(status==="registration_open"&&!database.prepare("SELECT 1 FROM institution_exam_subjects WHERE exam_id=?").get(examId))return fail(res,409,"Add at least one subject before opening registration.");
  if(status==="scheduled"&&!database.prepare("SELECT 1 FROM institution_exam_registrations WHERE exam_id=? AND status IN ('registered','approved')").get(examId))return fail(res,409,"No students have registered for this examination.");
  if(status==="published"){const missing=database.prepare("SELECT COUNT(*) AS n FROM institution_exam_registrations r JOIN institution_exam_subjects s ON s.exam_id=r.exam_id LEFT JOIN institution_exam_marks m ON m.subject_id=s.id AND m.student_user_id=r.student_user_id WHERE r.exam_id=? AND r.status IN ('registered','approved') AND m.id IS NULL").get(examId).n;if(Number(missing)>0)return fail(res,409,"Marks are incomplete; publish is blocked until every registered student has marks for every subject.");}
  database.prepare("UPDATE institution_exams SET status=?,updated_at=? WHERE id=? AND institution_id=?").run(status,now(),examId,i);audit(i,req.user.id,examId,"exam_status_changed",{from:exam.status,to:status});return res.json({success:true,status});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/examinations/:examId/register",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128),m=member(req,res,i,["student"]);if(!m)return;
  const exam=database.prepare("SELECT status,registration_open_at AS openAt,registration_close_at AS closeAt,fee_clearance_required AS feeClearanceRequired FROM institution_exams WHERE id=? AND institution_id=?").get(examId,i);if(!exam)return fail(res,404,"Examination not found.");
  const ts=now();if(exam.status!=="registration_open"||(exam.openAt&&Date.parse(ts)<Date.parse(exam.openAt))||(exam.closeAt&&Date.parse(ts)>Date.parse(exam.closeAt)))return fail(res,409,"Examination registration is not currently open.");
  if(exam.feeClearanceRequired){const due=database.prepare("SELECT COUNT(*) AS n FROM institution_fee_invoices i WHERE i.institution_id=? AND i.student_user_id=? AND i.status IN ('unpaid','partial') AND i.amount_paise>(SELECT COALESCE(SUM(p.amount_paise),0) FROM institution_fee_payments p WHERE p.invoice_id=i.id)").get(i,req.user.id).n;if(Number(due)>0)return fail(res,409,"Fee clearance is required before examination registration.");}
  const registrationId=id();const result=database.prepare("INSERT OR IGNORE INTO institution_exam_registrations(id,institution_id,exam_id,student_user_id,registered_at,updated_at) VALUES(?,?,?,?,?,?)").run(registrationId,i,examId,req.user.id,ts,ts);if(!result.changes)return fail(res,409,"You are already registered for this examination.");
  audit(i,req.user.id,examId,"student_registered",{studentUserId:req.user.id});return res.status(201).json({success:true,registration:{id:registrationId,status:"registered"}});
 }catch(e){next(e);}});
 app.patch("/api/institutions/:institutionId/examinations/:examId/registrations/:registrationId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128);if(!member(req,res,i,["institution_admin"]))return;
  const regId=clean(req.params.registrationId,128),status=clean(req.body?.status,20),roll=clean(req.body?.rollNumber,40);
  if(!["approved","rejected","withdrawn"].includes(status))return fail(res,400,"Choose an allowed registration status.");
  const result=database.prepare("UPDATE institution_exam_registrations SET status=?,roll_number=CASE WHEN ?<>'' THEN ? ELSE roll_number END,updated_at=? WHERE id=? AND institution_id=? AND exam_id=? AND status IN ('registered','approved')").run(status,roll,roll,now(),regId,i,examId);
  if(!result.changes)return fail(res,404,"Active exam registration not found.");
  audit(i,req.user.id,examId,"registration_updated",{registrationId:regId,status,rollNumber:roll});return res.json({success:true,status,rollNumber:roll||null});
 }catch(e){if(String(e.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"That roll number is already assigned in this examination.");next(e);}});
 app.put("/api/institutions/:institutionId/examinations/:examId/subjects/:subjectId/marks/:studentId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128);if(!member(req,res,i,["institution_admin","reviewer"]))return;
  const subjectId=clean(req.params.subjectId,128),studentId=clean(req.params.studentId,128),exam=database.prepare("SELECT status FROM institution_exams WHERE id=? AND institution_id=?").get(examId,i);if(!exam||exam.status!=="marks_entry")return fail(res,409,"Examination is not in marks-entry stage.");
  const subject=database.prepare("SELECT total_marks_hundredths FROM institution_exam_subjects WHERE id=? AND exam_id=? AND institution_id=?").get(subjectId,examId,i);if(!subject)return fail(res,404,"Exam subject not found.");
  const reg=database.prepare("SELECT id FROM institution_exam_registrations WHERE exam_id=? AND student_user_id=? AND status IN ('registered','approved')").get(examId,studentId);if(!reg)return fail(res,404,"Student is not registered for this examination.");
  const marks=Math.round(Number(req.body?.marks)*100);if(!Number.isSafeInteger(marks)||marks<0||marks>Number(subject.total_marks_hundredths))return fail(res,400,"Marks must be between zero and the subject maximum.");
  const ts=now();database.prepare("INSERT INTO institution_exam_marks(id,institution_id,exam_id,subject_id,student_user_id,marks_hundredths,entered_by,entered_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id,student_user_id) DO UPDATE SET marks_hundredths=excluded.marks_hundredths,entered_by=excluded.entered_by,updated_at=excluded.updated_at").run(id(),i,examId,subjectId,studentId,marks,req.user.id,ts,ts);
  audit(i,req.user.id,examId,"marks_recorded",{subjectId,studentId,marks});return res.json({success:true,marks});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/examinations/:examId/seating",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128);if(!member(req,res,i,["institution_admin"]))return;
  const registrationId=clean(req.body?.registrationId,128),venue=clean(req.body?.venue,120),room=clean(req.body?.room,80),seat=clean(req.body?.seatNumber,30);
  const registration=database.prepare("SELECT id FROM institution_exam_registrations WHERE id=? AND institution_id=? AND exam_id=? AND status IN ('registered','approved')").get(registrationId,i,examId);
  if(!registration)return fail(res,404,"Active examination registration not found.");
  if(venue.length<2||room.length<1||seat.length<1)return fail(res,400,"Enter venue, room and seat number.");
  const seatId=id(),ts=now();
  database.prepare("INSERT INTO institution_exam_seating(id,institution_id,exam_id,registration_id,venue,room,seat_number,assigned_by,assigned_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(registration_id) DO UPDATE SET venue=excluded.venue,room=excluded.room,seat_number=excluded.seat_number,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at").run(seatId,i,examId,registrationId,venue,room,seat,req.user.id,ts);
  audit(i,req.user.id,examId,"exam_seat_assigned",{registrationId,venue,room,seatNumber:seat});return res.json({success:true,seating:{registrationId,venue,room,seatNumber:seat,assignedAt:ts}});
 }catch(e){if(String(e.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"This seat is already assigned to another student in the same examination.");next(e);}});
 app.get("/api/institutions/:institutionId/examinations/:examId/admit-card",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),examId=clean(req.params.examId,128),m=member(req,res,i,["student"]);if(!m)return;
  const row=database.prepare(`
   SELECT e.id AS examId,e.title AS examTitle,e.academic_year AS academicYear,e.term,e.starts_at AS startsAt,e.ends_at AS endsAt,e.status AS examStatus,
    ins.name AS institutionName,r.id AS registrationId,r.roll_number AS rollNumber,r.status AS registrationStatus,s.venue,s.room,s.seat_number AS seatNumber,s.assigned_at AS seatAssignedAt
   FROM institution_exams e JOIN institutions ins ON ins.id=e.institution_id
   JOIN institution_exam_registrations r ON r.exam_id=e.id AND r.institution_id=e.institution_id
   LEFT JOIN institution_exam_seating s ON s.registration_id=r.id AND s.exam_id=e.id AND s.institution_id=e.institution_id
   WHERE e.id=? AND e.institution_id=? AND r.student_user_id=?
  `).get(examId,i,req.user.id);
  if(!row)return fail(res,404,"Examination registration was not found.");
  if(row.registrationStatus!=="approved")return fail(res,409,"Your examination registration must be approved before an admit card can be issued.");
  if(row.examStatus==="cancelled")return fail(res,409,"Admit cards are unavailable for a cancelled examination.");
  if(!row.rollNumber||!row.venue||!row.room||!row.seatNumber)return fail(res,409,"Your admit card is not ready. The institution must approve your registration, assign a roll number and allocate your examination seat.");
  const subjects=database.prepare("SELECT subject_code AS subjectCode,title,exam_date AS examDate,starts_at AS startsAt,ends_at AS endsAt,venue FROM institution_exam_subjects WHERE exam_id=? AND institution_id=? ORDER BY exam_date,starts_at").all(examId,i);
  if(!subjects.length)return fail(res,409,"The examination timetable is not available yet.");
  res.setHeader("Cache-Control","private, no-store");
  return res.json({success:true,admitCard:{...row,subjects,studentEmail:req.user.email,issuedAt:now()}});
 }catch(e){next(e);}});

}
