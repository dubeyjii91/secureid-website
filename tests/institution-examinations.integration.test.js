import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionExaminations} from "../server/institution-examinations.js";
async function setup(t){
 const db=new DatabaseSync(":memory:");db.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
 CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
 CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
 CREATE TABLE institution_courses(id TEXT PRIMARY KEY,institution_id TEXT,course_code TEXT,title TEXT);
 CREATE TABLE institution_fee_invoices(id TEXT PRIMARY KEY,institution_id TEXT,student_user_id TEXT,status TEXT,amount_paise INTEGER);
 CREATE TABLE institution_fee_payments(id TEXT PRIMARY KEY,invoice_id TEXT,amount_paise INTEGER);
 INSERT INTO users VALUES('admin','admin@test'),('faculty','faculty@test'),('student','student@test'),('other','other@test');
 INSERT INTO institutions VALUES('college','College');
 INSERT INTO institution_subscriptions VALUES('college','["academics"]','active');
 INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('f','college','faculty','reviewer','active'),('s','college','student','student','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionExaminations({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});return {db,request};
}
test("exam lifecycle supports registration, roll allocation, marks and published student results",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/examinations",{method:"POST",body:JSON.stringify({title:"Semester 1",academicYear:"2026-27",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-10T17:00:00Z",feeClearanceRequired:false})});
 assert.equal(r.status,201);const exam=(await r.json()).exam;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/subjects`,{method:"POST",body:JSON.stringify({subjectCode:"CS101",title:"Programming",examDate:"2026-12-01",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-01T12:00:00Z",totalMarks:100,passingMarks:40})});
 assert.equal(r.status,201);const subject=(await r.json()).subject;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"registration_open"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,201);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,409);
 const registration=db.prepare("SELECT id FROM institution_exam_registrations WHERE exam_id=?").get(exam.id);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/registrations/${registration.id}`,{method:"PATCH",body:JSON.stringify({status:"approved",rollNumber:"RVS-001"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"scheduled"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"marks_entry"})});assert.equal(r.status,200);
 r=await request("faculty",`/api/institutions/college/examinations/${exam.id}/subjects/${subject.id}/marks/student`,{method:"PUT",body:JSON.stringify({marks:78.5})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"published"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations`);assert.equal(r.status,200);const result=await r.json();assert.equal(result.marks[0].marksHundredths,7850);
});
test("exam roles, marks bounds and publication completeness are enforced",async t=>{
 const {request}=await setup(t);
 let r=await request("student","/api/institutions/college/examinations",{method:"POST",body:JSON.stringify({title:"Forbidden",academicYear:"2026-27",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-02T17:00:00Z"})});assert.equal(r.status,403);
 r=await request("admin","/api/institutions/college/examinations",{method:"POST",body:JSON.stringify({title:"Midterm",academicYear:"2026-27",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-02T17:00:00Z",feeClearanceRequired:false})});const exam=(await r.json()).exam;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/subjects`,{method:"POST",body:JSON.stringify({subjectCode:"M1",title:"Math",examDate:"2026-12-01",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-01T12:00:00Z",totalMarks:50,passingMarks:20})});assert.equal(r.status,201);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"registration_open"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,201);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"scheduled"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"marks_entry"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"published"})});assert.equal(r.status,409);
});


test("exam seating prevents duplicate room seats across registered students",async t=>{
 const {db,request}=await setup(t);
 db.prepare("INSERT INTO users VALUES('student-two','student-two@test')").run();
 db.prepare("INSERT INTO institution_memberships VALUES('s2','college','student-two','student','active')").run();
 let r=await request("admin","/api/institutions/college/examinations",{method:"POST",body:JSON.stringify({title:"Final Exam",academicYear:"2026-27",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-10T17:00:00Z",feeClearanceRequired:false})});
 const exam=(await r.json()).exam;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/subjects`,{method:"POST",body:JSON.stringify({subjectCode:"CS1",title:"Programming",examDate:"2026-12-01",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-01T12:00:00Z",totalMarks:100,passingMarks:40})});assert.equal(r.status,201);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"registration_open"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,201);
 r=await request("student-two",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,201);
 const regs=db.prepare("SELECT id FROM institution_exam_registrations WHERE exam_id=? ORDER BY student_user_id").all(exam.id);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/seating`,{method:"POST",body:JSON.stringify({registrationId:regs[0].id,venue:"Main Block",room:"Room 101",seatNumber:"A-01"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/seating`,{method:"POST",body:JSON.stringify({registrationId:regs[1].id,venue:"Main Block",room:"Room 101",seatNumber:"A-01"})});assert.equal(r.status,409);
});


test("admit cards are student-private and require approval, roll number, seat and timetable",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/examinations",{method:"POST",body:JSON.stringify({title:"Admit Card Exam",academicYear:"2026-27",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-10T17:00:00Z",feeClearanceRequired:false})});
 assert.equal(r.status,201);const exam=(await r.json()).exam;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/subjects`,{method:"POST",body:JSON.stringify({subjectCode:"CS101",title:"Programming",examDate:"2026-12-01",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-01T12:00:00Z",venue:"Main Block",totalMarks:100,passingMarks:40})});assert.equal(r.status,201);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"registration_open"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,201);
 const registration=db.prepare("SELECT id FROM institution_exam_registrations WHERE exam_id=?").get(exam.id);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/admit-card`);assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/registrations/${registration.id}`,{method:"PATCH",body:JSON.stringify({status:"approved",rollNumber:"RVS-ADMIT-001"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/admit-card`);assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/seating`,{method:"POST",body:JSON.stringify({registrationId:registration.id,venue:"Main Block",room:"101",seatNumber:"A-01"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/admit-card`);assert.equal(r.status,403);
 r=await request("other",`/api/institutions/college/examinations/${exam.id}/admit-card`);assert.equal(r.status,403);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/admit-card`);assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.admitCard.rollNumber,"RVS-ADMIT-001");assert.equal(body.admitCard.seatNumber,"A-01");assert.equal(body.admitCard.subjects.length,1);assert.equal(body.admitCard.institutionName,"College");assert.equal(body.admitCard.institutionType,"college");
 r=await request("admin","/api/institutions/college/examinations/settings",{method:"PATCH",body:JSON.stringify({institutionType:"university"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/admit-card?format=print`);assert.equal(r.status,200);assert.match(r.headers.get("content-type"),/text\/html/);const printable=await r.text();assert.match(printable,/UNIVERSITY EXAMINATION ADMIT CARD/);assert.match(printable,/OFFICIAL EXAMINATION ENTRY DOCUMENT/);assert.match(printable,/NOT AN ADMISSION \/ ENROLMENT LETTER/);assert.match(printable,/RVS-ADMIT-001/);assert.match(printable,/Print \/ Save as PDF/);
 r=await request("admin","/api/institutions/college/examinations/settings",{method:"PATCH",body:JSON.stringify({institutionType:"school"})});assert.equal(r.status,200);
 r=await request("student","/api/institutions/college/examinations");assert.equal(r.status,200);const workspace=await r.json();assert.equal(workspace.institutionType,"school");assert.equal(workspace.canDownloadAdmitCards,true);
});

test("published examination result statement is student-private and printable",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/examinations",{method:"POST",body:JSON.stringify({title:"Results Exam",academicYear:"2026-27",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-10T17:00:00Z",feeClearanceRequired:false})});const exam=(await r.json()).exam;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/subjects`,{method:"POST",body:JSON.stringify({subjectCode:"R1",title:"Mathematics",examDate:"2026-12-01",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-01T12:00:00Z",totalMarks:100,passingMarks:40})});assert.equal(r.status,201);const subject=(await r.json()).subject;
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"registration_open"})});assert.equal(r.status,200);
 r=await request("student",`/api/institutions/college/examinations/${exam.id}/register`,{method:"POST",body:"{}"});assert.equal(r.status,201);const reg=db.prepare("SELECT id FROM institution_exam_registrations WHERE exam_id=?").get(exam.id);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/registrations/${reg.id}`,{method:"PATCH",body:JSON.stringify({status:"approved",rollNumber:"R-RESULT-1"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"scheduled"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"marks_entry"})});assert.equal(r.status,200);
 r=await request("faculty",`/api/institutions/college/examinations/${exam.id}/subjects/${subject.id}/marks/student`,{method:"PUT",body:JSON.stringify({marks:82.5})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/examinations/${exam.id}/status`,{method:"PATCH",body:JSON.stringify({status:"published"})});assert.equal(r.status,200);
 const path=`/api/institutions/college/examinations/${exam.id}/result-statement`;
 r=await request("other",path);assert.equal(r.status,403);
 r=await request("student",path);assert.equal(r.status,200);const body=await r.json();assert.equal(body.resultStatement.obtainedMarksHundredths,8250);assert.equal(body.resultStatement.percentage,82.5);assert.equal(body.resultStatement.result,"PASS");
 r=await request("student",path+"?format=print");assert.equal(r.status,200);assert.match(r.headers.get("content-type"),/text\/html/);const html=await r.text();assert.match(html,/Examination result statement/);assert.match(html,/R-RESULT-1/);assert.match(html,/82.50%/);assert.match(html,/not a university-issued consolidated transcript/i);
});
