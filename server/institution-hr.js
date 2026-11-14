import crypto from "node:crypto";
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),clean=(v,n=240)=>String(v??"").trim().slice(0,n),fail=(r,s,m)=>r.status(s).json({success:false,message:m});
export function registerInstitutionHR({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 const columns=database.prepare("PRAGMA table_info(institution_staff)").all();
 if(columns.length&&!columns.some(c=>c.name==="user_id"))database.exec("ALTER TABLE institution_staff ADD COLUMN user_id TEXT REFERENCES users(id)");
 database.exec(`
 CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_staff_user ON institution_staff(institution_id,user_id) WHERE user_id IS NOT NULL;
 CREATE TABLE IF NOT EXISTS institution_staff_leave(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES institution_staff(id),user_id TEXT NOT NULL REFERENCES users(id),
  leave_type TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  reviewed_by TEXT REFERENCES users(id),review_note TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  CHECK(ends_on>=starts_on)
 );
 CREATE INDEX IF NOT EXISTS idx_staff_leave_queue ON institution_staff_leave(institution_id,status,starts_on);
 CREATE TABLE IF NOT EXISTS institution_staff_attendance(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES institution_staff(id),attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','leave','holiday')),
  marked_by TEXT NOT NULL REFERENCES users(id),note TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  UNIQUE(staff_id,attendance_date)
 );
 CREATE TABLE IF NOT EXISTS institution_hr_audit(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,entity_id TEXT,details_json TEXT NOT NULL,created_at TEXT NOT NULL
 );
 `);
 function member(req,res,i,roles){const m=getInstitutionMembership(req.user.id,i);if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this HR action.");return null;}if(!hasInstitutionFeature(i,"staff_management")){fail(res,403,"Staff management is not enabled.");return null;}return m;}
 function audit(i,u,a,e,d={}){database.prepare("INSERT INTO institution_hr_audit(id,institution_id,actor_user_id,action,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(id(),i,u,a,e||null,JSON.stringify(d),now());}
 app.post("/api/institutions/:institutionId/staff/:staffId/link-account",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),staffId=clean(req.params.staffId,128);if(!member(req,res,i,["institution_admin"]))return;
  const requestedUserId=clean(req.body?.userId,128),email=clean(req.body?.email,180).toLowerCase(),staff=database.prepare("SELECT id,email,user_id AS userId FROM institution_staff WHERE id=? AND institution_id=?").get(staffId,i),user=requestedUserId?database.prepare("SELECT id,email FROM users WHERE id=?").get(requestedUserId):database.prepare("SELECT id,email FROM users WHERE lower(email)=?").get(email);
  if(!staff||!user)return fail(res,404,"Staff record or user account not found.");
  if(staff.userId)return fail(res,409,"This staff record is already linked to an account.");
  if(!staff.email||staff.email.toLowerCase()!==user.email.toLowerCase())return fail(res,409,"Staff email and account email must match exactly before linking.");
  const userId=user.id,m=getInstitutionMembership(userId,i);if(!m||m.status!=="active"||m.role==="student")return fail(res,409,"User must have an active non-student institution membership.");
  const result=database.prepare("UPDATE institution_staff SET user_id=?,updated_at=? WHERE id=? AND institution_id=? AND user_id IS NULL").run(userId,now(),staffId,i);if(!result.changes)return fail(res,409,"Staff account link changed concurrently.");
  audit(i,req.user.id,"staff_account_linked",staffId,{userId});return res.json({success:true,staffId,userId});
 }catch(e){if(String(e.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"This account is already linked to another staff record.");next(e);}});
 app.get("/api/institutions/:institutionId/hr/leave",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),m=member(req,res,i,["institution_admin","reviewer"]);if(!m)return;
  const staff=database.prepare("SELECT id FROM institution_staff WHERE institution_id=? AND user_id=? AND status='active'").get(i,req.user.id);
  if(m.role!=="institution_admin"&&!staff)return fail(res,403,"Your account is not linked to an active staff record.");
  const rows=database.prepare(`SELECT l.id,l.staff_id AS staffId,s.full_name AS staffName,s.employee_code AS employeeCode,l.leave_type AS leaveType,l.starts_on AS startsOn,l.ends_on AS endsOn,l.reason,l.status,l.review_note AS reviewNote,l.created_at AS createdAt FROM institution_staff_leave l JOIN institution_staff s ON s.id=l.staff_id WHERE l.institution_id=? ${m.role==="institution_admin"?"":"AND l.user_id=?"} ORDER BY l.created_at DESC LIMIT 500`).all(...(m.role==="institution_admin"?[i]:[i,req.user.id]));
  res.setHeader("Cache-Control","private, no-store");return res.json({success:true,requests:rows});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/hr/leave",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),m=member(req,res,i,["reviewer"]);if(!m)return;
  const staff=database.prepare("SELECT id FROM institution_staff WHERE institution_id=? AND user_id=? AND status='active'").get(i,req.user.id);if(!staff)return fail(res,403,"Link your institution staff record before requesting leave.");
  const type=clean(req.body?.leaveType,40),start=clean(req.body?.startsOn,10),end=clean(req.body?.endsOn,10),reason=clean(req.body?.reason,1000);
  if(!["casual","sick","earned","duty","unpaid","other"].includes(type)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start||reason.length<5)return fail(res,400,"Enter valid leave type, dates and reason.");
  const overlap=database.prepare("SELECT 1 FROM institution_staff_leave WHERE staff_id=? AND status IN ('pending','approved') AND starts_on<=? AND ends_on>=?").get(staff.id,end,start);if(overlap)return fail(res,409,"A pending or approved leave request overlaps these dates.");
  const leaveId=id(),ts=now();database.prepare("INSERT INTO institution_staff_leave(id,institution_id,staff_id,user_id,leave_type,starts_on,ends_on,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(leaveId,i,staff.id,req.user.id,type,start,end,reason,ts,ts);
  audit(i,req.user.id,"leave_requested",leaveId,{type,start,end});return res.status(201).json({success:true,request:{id:leaveId,status:"pending"}});
 }catch(e){next(e);}});
 app.patch("/api/institutions/:institutionId/hr/leave/:leaveId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),leaveId=clean(req.params.leaveId,128);if(!member(req,res,i,["institution_admin"]))return;
  const status=clean(req.body?.status,20),note=clean(req.body?.reviewNote,1000);if(!["approved","rejected"].includes(status)||status==="rejected"&&note.length<5)return fail(res,400,"Choose approve or reject and include a reason when rejecting.");
  const changed=database.prepare("UPDATE institution_staff_leave SET status=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=? AND institution_id=? AND status='pending'").run(status,req.user.id,note||null,now(),leaveId,i);if(!changed.changes)return fail(res,404,"Pending leave request not found.");
  audit(i,req.user.id,"leave_"+status,leaveId,{note});return res.json({success:true,status});
 }catch(e){next(e);}});
 app.get("/api/institutions/:institutionId/hr/attendance",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128);if(!member(req,res,i,["institution_admin"]))return;
  const date=clean(req.query?.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail(res,400,"Provide attendance date as YYYY-MM-DD.");
  const rows=database.prepare("SELECT a.id,a.staff_id AS staffId,s.full_name AS fullName,s.employee_code AS employeeCode,a.attendance_date AS attendanceDate,a.status,a.note FROM institution_staff_attendance a JOIN institution_staff s ON s.id=a.staff_id WHERE a.institution_id=? AND a.attendance_date=? ORDER BY s.full_name").all(i,date);
  return res.json({success:true,attendance:rows});
 }catch(e){next(e);}});
 app.put("/api/institutions/:institutionId/hr/attendance/:staffId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),staffId=clean(req.params.staffId,128);if(!member(req,res,i,["institution_admin"]))return;
  const date=clean(req.body?.date,10),status=clean(req.body?.status,20),note=clean(req.body?.note,500);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!["present","absent","late","leave","holiday"].includes(status))return fail(res,400,"Enter a valid attendance date and status.");
  if(!database.prepare("SELECT id FROM institution_staff WHERE id=? AND institution_id=?").get(staffId,i))return fail(res,404,"Staff record not found.");
  const ts=now();database.prepare("INSERT INTO institution_staff_attendance(id,institution_id,staff_id,attendance_date,status,marked_by,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(staff_id,attendance_date) DO UPDATE SET status=excluded.status,marked_by=excluded.marked_by,note=excluded.note,updated_at=excluded.updated_at").run(id(),i,staffId,date,status,req.user.id,note||null,ts,ts);
  audit(i,req.user.id,"staff_attendance_marked",staffId,{date,status});return res.json({success:true,status,date});
 }catch(e){next(e);}});
}
