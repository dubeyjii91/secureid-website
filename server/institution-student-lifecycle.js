const clean=(value,max=240)=>String(value??"").trim().slice(0,max);
const fail=(res,status,message)=>res.status(status).json({success:false,message});
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
import crypto from "node:crypto";

export function registerInstitutionStudentLifecycle({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 database.exec(`
  CREATE TABLE IF NOT EXISTS institution_student_guardians(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   student_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   full_name TEXT NOT NULL,relationship TEXT NOT NULL CHECK(relationship IN ('parent','guardian','spouse','sibling','other')),
   email TEXT,phone TEXT,is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
   created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_student_guardians_student ON institution_student_guardians(institution_id,student_user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_student_guardians_primary ON institution_student_guardians(institution_id,student_user_id) WHERE is_primary=1;
  CREATE TABLE IF NOT EXISTS institution_student_status_history(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   student_user_id TEXT NOT NULL REFERENCES users(id),from_status TEXT NOT NULL,to_status TEXT NOT NULL,
   reason TEXT NOT NULL,actor_user_id TEXT NOT NULL REFERENCES users(id),changed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_student_status_history_student ON institution_student_status_history(institution_id,student_user_id,changed_at DESC);
  CREATE TABLE IF NOT EXISTS institution_student_lifecycle_audit(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   student_user_id TEXT NOT NULL REFERENCES users(id),actor_user_id TEXT NOT NULL REFERENCES users(id),
   action TEXT NOT NULL,entity_id TEXT,details_json TEXT NOT NULL,created_at TEXT NOT NULL
  );
 `);
 function member(req,res,institutionId,roles){
  const m=getInstitutionMembership(req.user.id,institutionId);
  if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this student record action.");return null;}
  if(!hasInstitutionFeature(institutionId,"student_management")){fail(res,403,"Student management is not enabled.");return null;}
  return m;
 }
 function activeStudent(institutionId,userId){
  return database.prepare("SELECT id,status FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status IN ('active','suspended')").get(institutionId,userId)||null;
 }
 function audit(institutionId,studentUserId,actorUserId,action,entityId,details={}){
  database.prepare("INSERT INTO institution_student_lifecycle_audit(id,institution_id,student_user_id,actor_user_id,action,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
   .run(id(),institutionId,studentUserId,actorUserId,action,entityId||null,JSON.stringify(details),now());
 }
 function validateGuardian(body){
  const fullName=clean(body?.fullName,120),relationship=clean(body?.relationship,20),email=clean(body?.email,254).toLowerCase(),phone=clean(body?.phone,30).replace(/[\s()-]/g,"");
  const isPrimary=body?.isPrimary===true||body?.isPrimary===1;
  if(fullName.length<2)return {error:"Enter the guardian's full name."};
  if(!["parent","guardian","spouse","sibling","other"].includes(relationship))return {error:"Choose a valid relationship."};
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {error:"Enter a valid guardian email address."};
  if(phone&&!/^\+?[0-9]{7,15}$/.test(phone))return {error:"Enter a valid guardian phone number."};
  if(!email&&!phone)return {error:"Enter at least one guardian contact method: email or phone."};
  return {fullName,relationship,email:email||null,phone:phone||null,isPrimary:isPrimary?1:0};
 }

 app.get("/api/institutions/:institutionId/students/:userId/guardians",requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),studentUserId=clean(req.params.userId,128);
   const m=member(req,res,institutionId,["institution_admin","reviewer","read_only","student"]);if(!m)return;
   const membership=activeStudent(institutionId,studentUserId);if(!membership)return fail(res,404,"Student membership was not found.");
   if(m.role==="student"&&(req.user.id!==studentUserId||membership.status!=="active"))return fail(res,403,"Students can only view their own guardian contacts while their membership is active.");
   const guardians=database.prepare("SELECT id,full_name AS fullName,relationship,email,phone,is_primary AS isPrimary,created_at AS createdAt,updated_at AS updatedAt FROM institution_student_guardians WHERE institution_id=? AND student_user_id=? ORDER BY is_primary DESC,full_name COLLATE NOCASE").all(institutionId,studentUserId);
   res.setHeader("Cache-Control","private, no-store");return res.json({success:true,guardians,canManage:m.role==="institution_admin"});
  }catch(error){next(error);}
 });

 app.post("/api/institutions/:institutionId/students/:userId/guardians",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),studentUserId=clean(req.params.userId,128);
   if(!member(req,res,institutionId,["institution_admin"]))return;
   if(!activeStudent(institutionId,studentUserId))return fail(res,404,"Student membership was not found.");
   const value=validateGuardian(req.body);if(value.error)return fail(res,400,value.error);
   const guardianId=id(),timestamp=now();
   database.prepare("INSERT INTO institution_student_guardians(id,institution_id,student_user_id,full_name,relationship,email,phone,is_primary,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(guardianId,institutionId,studentUserId,value.fullName,value.relationship,value.email,value.phone,value.isPrimary,req.user.id,timestamp,timestamp);
   audit(institutionId,studentUserId,req.user.id,"guardian_created",guardianId,{relationship:value.relationship,isPrimary:!!value.isPrimary});
   return res.status(201).json({success:true,guardian:{id:guardianId,...value,createdAt:timestamp,updatedAt:timestamp}});
  }catch(error){if(String(error.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"This student already has a primary guardian. Edit the existing primary contact first.");next(error);}
 });

 app.patch("/api/institutions/:institutionId/students/:userId/guardians/:guardianId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),studentUserId=clean(req.params.userId,128),guardianId=clean(req.params.guardianId,128);
   if(!member(req,res,institutionId,["institution_admin"]))return;
   const value=validateGuardian(req.body);if(value.error)return fail(res,400,value.error);
   const timestamp=now();
   const changed=database.prepare("UPDATE institution_student_guardians SET full_name=?,relationship=?,email=?,phone=?,is_primary=?,updated_at=? WHERE id=? AND institution_id=? AND student_user_id=?")
    .run(value.fullName,value.relationship,value.email,value.phone,value.isPrimary,timestamp,guardianId,institutionId,studentUserId);
   if(!changed.changes)return fail(res,404,"Guardian contact was not found.");
   audit(institutionId,studentUserId,req.user.id,"guardian_updated",guardianId,{relationship:value.relationship,isPrimary:!!value.isPrimary});
   return res.json({success:true,guardian:{id:guardianId,...value,updatedAt:timestamp}});
  }catch(error){if(String(error.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"This student already has a primary guardian.");next(error);}
 });

 app.delete("/api/institutions/:institutionId/students/:userId/guardians/:guardianId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),studentUserId=clean(req.params.userId,128),guardianId=clean(req.params.guardianId,128);
   if(!member(req,res,institutionId,["institution_admin"]))return;
   const changed=database.prepare("DELETE FROM institution_student_guardians WHERE id=? AND institution_id=? AND student_user_id=?").run(guardianId,institutionId,studentUserId);
   if(!changed.changes)return fail(res,404,"Guardian contact was not found.");
   audit(institutionId,studentUserId,req.user.id,"guardian_deleted",guardianId);
   return res.json({success:true});
  }catch(error){next(error);}
 });

 app.get("/api/institutions/:institutionId/students/:userId/status-history",requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),studentUserId=clean(req.params.userId,128);
   const m=member(req,res,institutionId,["institution_admin","reviewer","read_only","student"]);if(!m)return;
   const membership=activeStudent(institutionId,studentUserId);if(!membership)return fail(res,404,"Student membership was not found.");
   if(m.role==="student"&&(req.user.id!==studentUserId||membership.status!=="active"))return fail(res,403,"Students can only view their own status history while their membership is active.");
   const history=database.prepare("SELECT h.id,h.from_status AS fromStatus,h.to_status AS toStatus,h.reason,h.changed_at AS changedAt,u.email AS changedBy FROM institution_student_status_history h JOIN users u ON u.id=h.actor_user_id WHERE h.institution_id=? AND h.student_user_id=? ORDER BY h.changed_at DESC LIMIT 100").all(institutionId,studentUserId);
   res.setHeader("Cache-Control","private, no-store");return res.json({success:true,history});
  }catch(error){next(error);}
 });
}
