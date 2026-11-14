import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionExamServices } from "../server/institution-exam-services.js";

async function setup(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,institution_type TEXT NOT NULL DEFAULT 'college');
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
    CREATE TABLE institution_exams(id TEXT PRIMARY KEY,institution_id TEXT,title TEXT,academic_year TEXT,term TEXT,status TEXT);
    CREATE TABLE institution_exam_subjects(id TEXT PRIMARY KEY,institution_id TEXT,exam_id TEXT,subject_code TEXT,title TEXT,total_marks_hundredths INTEGER,passing_marks_hundredths INTEGER);
    CREATE TABLE institution_exam_registrations(id TEXT PRIMARY KEY,institution_id TEXT,exam_id TEXT,student_user_id TEXT,roll_number TEXT,status TEXT);
    CREATE TABLE institution_exam_marks(id TEXT PRIMARY KEY,institution_id TEXT,exam_id TEXT,subject_id TEXT,student_user_id TEXT,marks_hundredths INTEGER,entered_by TEXT,updated_at TEXT);
    INSERT INTO users VALUES('admin','admin@college.test'),('faculty','faculty@college.test'),('student','student@college.test'),('other','other@college.test');
    INSERT INTO institutions VALUES('college','RVS College','college');
    INSERT INTO institution_subscriptions VALUES('college','["academics"]','active');
    INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('f','college','faculty','reviewer','active'),('s','college','student','student','active'),('o','college','other','student','active');
    INSERT INTO institution_exams VALUES('exam','college','Semester 1','2026-27','Semester 1','published');
    INSERT INTO institution_exam_subjects VALUES('subject','college','exam','CS101','Programming',10000,4000);
    INSERT INTO institution_exam_registrations VALUES('registration','college','exam','student','RVS-001','approved');
    INSERT INTO institution_exam_marks VALUES('mark','college','exam','subject','student',7800,'faculty','2026-11-14T10:00:00.000Z');
  `);
  const app = express();
  app.use(express.json());
  app.use((req,res,next) => { req.user = { id:req.get("x-user") || "", email:({admin:"admin@college.test",faculty:"faculty@college.test",student:"student@college.test",other:"other@college.test"})[req.get("x-user")] || "" }; next(); });
  const auth=(req,res,next)=>req.user.id?next():res.status(401).end();
  const pass=(req,res,next)=>next();
  const membership=(userId,institutionId)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(userId,institutionId)||null;
  const feature=(institutionId,feature)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(institutionId)?.features_json?.includes('"'+feature+'"')||false;
  registerInstitutionExamServices({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const request=(user,path,options={})=>fetch("http://127.0.0.1:"+server.address().port+path,{...options,headers:{"content-type":"application/json","x-user":user,...(options.headers||{})}});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  return {db,request};
}

test("student can request one revaluation and an authorized reviewer updates marks with audit history",async t=>{
  const {db,request}=await setup(t);
  let response=await request("student","/api/institutions/college/examinations/exam/subjects/subject/revaluation",{method:"POST",body:JSON.stringify({reason:"Please recheck question three and the totaling of my marks."})});
  assert.equal(response.status,201);
  const created=(await response.json()).request;
  response=await request("student","/api/institutions/college/examinations/exam/subjects/subject/revaluation",{method:"POST",body:JSON.stringify({reason:"Please recheck my marks again."})});
  assert.equal(response.status,409);
  response=await request("other","/api/institutions/college/exam-services");
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).requests,[]);
  response=await request("faculty","/api/institutions/college/exam-services");
  assert.equal(response.status,200);
  const queue=(await response.json()).requests;
  assert.equal(queue.length,1);
  assert.equal(queue[0].id,created.id);
  response=await request("faculty",`/api/institutions/college/examinations/exam/revaluations/${created.id}`,{method:"PATCH",body:JSON.stringify({decision:"complete",revisedMarks:84.5,reviewNote:"Rechecked script; totaling corrected."})});
  assert.equal(response.status,200);
  assert.equal(db.prepare("SELECT marks_hundredths FROM institution_exam_marks WHERE id='mark'").get().marks_hundredths,8450);
  assert.equal(db.prepare("SELECT status FROM institution_exam_revaluation_requests WHERE id=?").get(created.id).status,"completed");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_exam_revaluation_audit WHERE request_id=?").get(created.id).n,2);
  response=await request("faculty",`/api/institutions/college/examinations/exam/revaluations/${created.id}`,{method:"PATCH",body:JSON.stringify({decision:"complete",revisedMarks:90,reviewNote:"Duplicate decision."})});
  assert.equal(response.status,409);
});

test("transcript contains only complete published approved results and is student-private",async t=>{
  const {db,request}=await setup(t);
  let response=await request("student","/api/institutions/college/transcript");
  assert.equal(response.status,200);
  let body=await response.json();
  assert.equal(body.transcript.records.length,1);
  assert.equal(body.transcript.records[0].percentage,78);
  assert.match(body.recordSha256,/^[a-f0-9]{64}$/);
  response=await request("student","/api/institutions/college/transcript?format=print");
  assert.equal(response.status,200);
  assert.match(await response.text(),/Consolidated academic transcript/);
  response=await request("faculty","/api/institutions/college/transcript");
  assert.equal(response.status,403);
});
