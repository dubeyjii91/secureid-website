import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { registerStudentAdmissions } from "../server/student-admissions.js";

function seal(value,key){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return {iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")};
}
function open(payload,key){
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(payload.iv,"base64"));
  decipher.setAuthTag(Buffer.from(payload.tag,"base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data,"base64")),decipher.final()]).toString("utf8"));
}

test("student admission is encrypted, consented, institution-scoped and only approved by institution admins",async t=>{
  const database=new DatabaseSync(":memory:");
  const key=randomBytes(32);
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,plan_key TEXT,status TEXT,features_json TEXT,starts_at TEXT,ends_at TEXT,updated_at TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(institution_id,user_id));
    CREATE TABLE institution_student_profiles(institution_id TEXT NOT NULL,user_id TEXT NOT NULL,student_number TEXT,department TEXT,program TEXT,academic_year TEXT,status TEXT,created_at TEXT,updated_at TEXT,PRIMARY KEY(institution_id,user_id));
    INSERT INTO users VALUES('student','student@example.test'),('admin','admin@example.test'),('other-admin','other@example.test');
    INSERT INTO institutions VALUES('college-a','College A','2026-01-01T00:00:00.000Z'),('college-b','College B','2026-01-01T00:00:00.000Z');
    INSERT INTO institution_subscriptions VALUES('college-a','pilot','pilot','[]',NULL,NULL,'2026-01-01T00:00:00.000Z'),('college-b','pilot','pilot','[]',NULL,NULL,'2026-01-01T00:00:00.000Z');
    INSERT INTO institution_memberships VALUES('admin-a','college-a','admin','institution_admin','active','2026-01-01','2026-01-01');
    INSERT INTO institution_memberships VALUES('admin-b','college-b','other-admin','institution_admin','active','2026-01-01','2026-01-01');
  `);
  const memberships=database.prepare("SELECT id,institution_id AS institutionId,role,status FROM institution_memberships WHERE user_id=? AND institution_id=?");
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:req.get("x-mfa")!=="false"};next();});
  const requireAuth=(req,res,next)=>req.user.id?next():res.status(401).json({success:false});
  const requireMfaProduction=(req,res,next)=>req.user.mfaVerified?next():res.status(403).json({success:false});
  registerStudentAdmissions({app,database,requireAuth,requireMfaProduction,enforceSameOrigin:(req,res,next)=>next(),getInstitutionMembership:(userId,institutionId)=>memberships.get(userId,institutionId),encrypt:value=>seal(value,key),decrypt:value=>open(value,key)});
  app.use((error,req,res,next)=>res.status(500).json({success:false,message:error.message}));
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers=(user,mfa=true)=>({"x-user":user,"x-mfa":String(mfa),"content-type":"application/json"});
  const body={institutionId:"college-a",fullName:"Test Student",course:"BCA",department:"Computer Science",academicYear:"2026-2027",admissionYear:"2026",studentNumber:"TEST-01",message:"Admission test",consent:true};

  const noMfa=await fetch(base+"/api/admissions/institutions",{headers:headers("student",false)});
  assert.equal(noMfa.status,403);
  const directory=await fetch(base+"/api/admissions/institutions",{headers:headers("student")});
  assert.equal(directory.status,200);
  assert.deepEqual((await directory.json()).institutions.map(x=>x.id),["college-a","college-b"]);

  const noConsent=await fetch(base+"/api/admissions/applications",{method:"POST",headers:headers("student"),body:JSON.stringify({...body,consent:false})});
  assert.equal(noConsent.status,400);
  const createdResponse=await fetch(base+"/api/admissions/applications",{method:"POST",headers:headers("student"),body:JSON.stringify(body)});
  assert.equal(createdResponse.status,201,await createdResponse.clone().text());
  const created=(await createdResponse.json()).application;
  const stored=database.prepare("SELECT encrypted_application FROM institution_admission_requests WHERE id=?").get(created.id);
  assert.ok(stored);
  assert.equal(stored.encrypted_application.includes("Test Student"),false);
  assert.equal(open(JSON.parse(stored.encrypted_application),key).course,"BCA");

  const duplicate=await fetch(base+"/api/admissions/applications",{method:"POST",headers:headers("student"),body:JSON.stringify(body)});
  assert.equal(duplicate.status,409);
  const crossTenant=await fetch(base+`/api/institutions/college-a/admission-requests`,{headers:headers("other-admin")});
  assert.equal(crossTenant.status,403);
  const selfApprove=await fetch(base+`/api/institutions/college-a/admission-requests/${created.id}`,{method:"PATCH",headers:headers("student"),body:JSON.stringify({status:"approved"})});
  assert.equal(selfApprove.status,403);

  const queue=await fetch(base+"/api/institutions/college-a/admission-requests",{headers:headers("admin")});
  assert.equal(queue.status,200);
  const application=(await queue.json()).applications[0];
  assert.equal(application.fullName,"Test Student");
  assert.equal(application.studentEmail,"student@example.test");

  const approved=await fetch(base+`/api/institutions/college-a/admission-requests/${created.id}`,{method:"PATCH",headers:headers("admin"),body:JSON.stringify({status:"approved",reviewNote:"Approved"})});
  assert.equal(approved.status,200,await approved.clone().text());
  assert.equal(database.prepare("SELECT role,status FROM institution_memberships WHERE institution_id='college-a' AND user_id='student'").get().role,"student");
  assert.equal(database.prepare("SELECT program,department,academic_year FROM institution_student_profiles WHERE institution_id='college-a' AND user_id='student'").get().program,"BCA");
  const secondApproval=await fetch(base+`/api/institutions/college-a/admission-requests/${created.id}`,{method:"PATCH",headers:headers("admin"),body:JSON.stringify({status:"approved"})});
  assert.equal(secondApproval.status,409);
  const mine=await fetch(base+"/api/admissions/mine",{headers:headers("student")});
  assert.equal((await mine.json()).applications[0].status,"approved");
});
