import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerParentPortal } from "../server/parent-portal.js";

async function setup(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL);
    CREATE TABLE email_verification_state(user_id TEXT PRIMARY KEY,verified_at INTEGER);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT,starts_at TEXT,ends_at TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
    CREATE TABLE institution_student_profiles(institution_id TEXT,user_id TEXT,student_number TEXT,program TEXT,academic_year TEXT,PRIMARY KEY(institution_id,user_id));
    CREATE TABLE institution_courses(id TEXT PRIMARY KEY,institution_id TEXT,title TEXT);
    CREATE TABLE institution_attendance(id TEXT PRIMARY KEY,institution_id TEXT,course_id TEXT,student_user_id TEXT,attendance_date TEXT,status TEXT);
    CREATE TABLE institution_fee_invoices(id TEXT PRIMARY KEY,institution_id TEXT,student_user_id TEXT,fee_head TEXT,description TEXT,amount_paise INTEGER,due_date TEXT,status TEXT,created_at TEXT);
    CREATE TABLE institution_assessments(id TEXT PRIMARY KEY,institution_id TEXT,course_id TEXT,title TEXT,exam_date TEXT,total_marks_hundredths INTEGER);
    CREATE TABLE institution_assessment_results(id TEXT PRIMARY KEY,institution_id TEXT,assessment_id TEXT,student_user_id TEXT,marks_hundredths INTEGER);
    CREATE TABLE institution_school_posts(id TEXT PRIMARY KEY,institution_id TEXT,post_type TEXT,title TEXT,subject TEXT,class_label TEXT,body TEXT,due_at TEXT,audience TEXT,status TEXT,created_at TEXT);
    INSERT INTO users VALUES
      ('admin','admin@example.test'),('parent-a','parent-a@example.test'),
      ('parent-b','parent-b@example.test'),('student-a','student-a@example.test'),
      ('student-b','student-b@example.test'),('owner','owner@example.test');
    INSERT INTO email_verification_state VALUES
      ('admin',1),('parent-a',1),('parent-b',1),('student-a',1),('student-b',1),('owner',1);
    INSERT INTO institutions VALUES('school','Demo School');
    INSERT INTO institution_subscriptions VALUES('school','["student_management","academics","finance","homework"]','active',NULL,NULL);
    INSERT INTO institution_memberships VALUES
      ('admin-membership','school','admin','institution_admin','active'),
      ('student-a-membership','school','student-a','student','active'),
      ('student-b-membership','school','student-b','student','active');
    INSERT INTO institution_student_profiles VALUES
      ('school','student-a','S-001','Class 1','2026-27'),
      ('school','student-b','S-002','Class 2','2026-27');
    INSERT INTO institution_courses VALUES('course-a','school','Mathematics');
    INSERT INTO institution_attendance VALUES('att-a','school','course-a','student-a','2026-11-01','present');
    INSERT INTO institution_fee_invoices VALUES('invoice-a','school','student-a','Tuition','Term 1',50000,'2026-12-01','unpaid','2026-11-01');
    INSERT INTO institution_assessments VALUES('exam-a','school','course-a','Unit Test','2026-11-05',10000);
    INSERT INTO institution_assessment_results VALUES('result-a','school','exam-a','student-a',8500);
    INSERT INTO institution_school_posts VALUES('hw-a','school','homework','Read chapter 1','English','Class 1','Read and answer questions','2026-11-25','students','published','2026-11-20');
  `);
  const app = express();
  app.use(express.json());
  app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",role:req.get("x-role")||"user",mfaVerified:true};next();});
  const auth=(req,res,next)=>req.user.id?next():res.status(401).end();
  const pass=(req,res,next)=>next();
  const membership=(userId,institutionId)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(userId,institutionId)||null;
  const feature=(institutionId,name)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(institutionId)?.features_json?.includes('"'+name+'"')||false;
  registerParentPortal({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
  app.use((error,req,res,next)=>res.status(500).json({success:false,message:error.message}));
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const request=(user,path,options={})=>fetch("http://127.0.0.1:"+server.address().port+path,{...options,headers:{"content-type":"application/json","x-user":user,...(options.headers||{})}});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  return {db,request};
}

test("parent can only view children explicitly linked by the school",async t=>{
  const {db,request}=await setup(t);
  let response=await request("admin","/api/institutions/school/parent-links",{method:"POST",body:JSON.stringify({parentEmail:"parent-a@example.test",studentUserId:"student-a",relationship:"mother",consentConfirmed:true})});
  assert.equal(response.status,201);
  response=await request("parent-a","/api/parent-portal/children");
  assert.equal(response.status,200);
  const children=(await response.json()).children;
  assert.equal(children.length,1);
  assert.equal(children[0].studentUserId,"student-a");
  assert.equal(children[0].institutionName,"Demo School");
  response=await request("parent-a","/api/parent-portal/children/student-a?institutionId=school");
  assert.equal(response.status,200);
  const child=await response.json();
  assert.equal(child.attendance.length,1);
  assert.equal(child.invoices.length,1);
  assert.equal(child.results.length,1);
  assert.equal(child.homework.length,1);
  response=await request("parent-a","/api/parent-portal/children/student-b?institutionId=school");
  assert.equal(response.status,404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_parent_portal_audit WHERE action='parent_child_records_viewed'").get().n,1);
});

test("unverified parent accounts cannot be linked and Platform Owner cannot read school records",async t=>{
  const {db,request}=await setup(t);
  db.prepare("DELETE FROM email_verification_state WHERE user_id='parent-b'").run();
  let response=await request("admin","/api/institutions/school/parent-links",{method:"POST",body:JSON.stringify({parentEmail:"parent-b@example.test",studentUserId:"student-a",consentConfirmed:true})});
  assert.equal(response.status,404);
  response=await request("owner","/api/parent-portal/children",{headers:{"x-role":"owner"}});
  assert.equal(response.status,403);
  response=await request("owner","/api/parent-portal/children/student-a?institutionId=school",{headers:{"x-role":"owner"}});
  assert.equal(response.status,403);
});

test("institution admin can revoke a parent link and access stops immediately",async t=>{
  const {request}=await setup(t);
  let response=await request("admin","/api/institutions/school/parent-links",{method:"POST",body:JSON.stringify({parentEmail:"parent-a@example.test",studentUserId:"student-a",consentConfirmed:true})});
  assert.equal(response.status,201);
  response=await request("admin","/api/institutions/school/parent-links/parent-a/student-a",{method:"DELETE"});
  assert.equal(response.status,200);
  response=await request("parent-a","/api/parent-portal/children/student-a?institutionId=school");
  assert.equal(response.status,404);
});

test("suspended students disappear from parent access and unsupported relationships are rejected",async t=>{
  const {db,request}=await setup(t);
  let response=await request("admin","/api/institutions/school/parent-links",{method:"POST",body:JSON.stringify({parentEmail:"parent-a@example.test",studentUserId:"student-a",relationship:"mother",consentConfirmed:true})});
  assert.equal(response.status,201);

  db.prepare("UPDATE institution_memberships SET status='suspended' WHERE institution_id='school' AND user_id='student-a' AND role='student'").run();

  response=await request("parent-a","/api/parent-portal/children/student-a?institutionId=school");
  assert.equal(response.status,404);
  response=await request("parent-a","/api/parent-portal/children");
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).children,[]);
  response=await request("admin","/api/institutions/school/parent-links");
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).links,[]);

  response=await request("admin","/api/institutions/school/parent-links",{method:"POST",body:JSON.stringify({parentEmail:"parent-b@example.test",studentUserId:"student-b",relationship:"unsupported-value",consentConfirmed:true})});
  assert.equal(response.status,400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_parent_links WHERE parent_user_id='parent-b' AND student_user_id='student-b'").get().n,0);
});
