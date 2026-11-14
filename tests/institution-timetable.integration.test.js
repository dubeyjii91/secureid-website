import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionModules} from "../server/institution-modules.js";
import {registerInstitutionStudentLifecycle} from "../server/institution-student-lifecycle.js";

async function setup(t){
 const db=new DatabaseSync(":memory:");
 db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
  CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT,updated_at TEXT);
  CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  INSERT INTO users VALUES('admin','admin@test'),('student','student@test'),('student2','student2@test'),('other','other@test');
  INSERT INTO institutions VALUES('college','College'),('other-college','Other College');
  INSERT INTO institution_subscriptions VALUES('college','["academics","student_management","staff_management","finance"]','active',CURRENT_TIMESTAMP),('other-college','["academics"]','active',CURRENT_TIMESTAMP);
  INSERT INTO institution_memberships(id,institution_id,user_id,role,status) VALUES('a','college','admin','institution_admin','active'),('s','college','student','student','active'),('s2','college','student2','student','active'),('o','other-college','other','institution_admin','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status IN ('pilot','active')").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionModules({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 registerInstitutionStudentLifecycle({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 return {db,request};
}

test("weekly timetable persists, rejects overlaps, enforces tenant roles and records audit",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/courses",{method:"POST",body:JSON.stringify({courseCode:"CS101",title:"Computer Science",academicYear:"2026-2027"})});
 assert.equal(r.status,201);const course=(await r.json()).course;
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student"})});assert.equal(r.status,201);
 r=await request("admin","/api/institutions/college/timetable",{method:"POST",body:JSON.stringify({courseId:course.id,weekday:1,startsAt:"09:00",endsAt:"10:00",room:"A-101"})});
 assert.equal(r.status,201);const entry=(await r.json()).entry;
 r=await request("admin","/api/institutions/college/timetable",{method:"POST",body:JSON.stringify({courseId:course.id,weekday:1,startsAt:"09:30",endsAt:"10:30",room:"A-101"})});
 assert.equal(r.status,409);
 r=await request("admin","/api/institutions/college/timetable",{method:"POST",body:JSON.stringify({courseId:course.id,weekday:1,startsAt:"09:30",endsAt:"10:30",room:"B-202"})});assert.equal(r.status,201);
 r=await request("student","/api/institutions/college/timetable");assert.equal(r.status,200);const rows=(await r.json()).entries;assert.equal(rows.length,2);assert.equal(rows[0].room,"A-101");
 r=await request("student2","/api/institutions/college/timetable");assert.equal(r.status,200);assert.equal((await r.json()).entries.length,0);
 r=await request("student","/api/institutions/college/courses");assert.equal(r.status,200);assert.equal((await r.json()).courses.length,1);
 r=await request("student2","/api/institutions/college/courses");assert.equal(r.status,200);assert.equal((await r.json()).courses.length,0);
 r=await request("other","/api/institutions/college/timetable");assert.equal(r.status,403);
 r=await request("student",`/api/institutions/college/timetable/${entry.id}`,{method:"DELETE"});assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/timetable/${entry.id}`,{method:"DELETE"});assert.equal(r.status,200);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_operations_audit WHERE entity_type='timetable'").get().n,3);
});


test("course enrollment is tenant-scoped, rejects duplicates and supports withdrawal/reactivation",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/courses",{method:"POST",body:JSON.stringify({courseCode:"AI201",title:"Applied AI",academicYear:"2026-2027"})});
 assert.equal(r.status,201);const course=(await r.json()).course;
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student"})});
 assert.equal(r.status,201);const enrollment=(await r.json()).enrollment;
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student"})});
 assert.equal(r.status,409);
 r=await request("student","/api/institutions/college/enrollments");
 assert.equal(r.status,200);let rows=(await r.json()).enrollments;assert.equal(rows.length,1);assert.equal(rows[0].courseId,course.id);
 r=await request("admin",`/api/institutions/college/courses/${course.id}/attendance`,{method:"POST",body:JSON.stringify({studentUserId:"student2",date:"2026-11-14",status:"present"})});
 assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/courses/${course.id}/attendance`,{method:"POST",body:JSON.stringify({studentUserId:"student",date:"2026-11-14",status:"present"})});
 assert.equal(r.status,201);
 r=await request("admin",`/api/institutions/college/courses/${course.id}/assessments`,{method:"POST",body:JSON.stringify({title:"Midterm",examDate:"2026-11-20",totalMarks:100})});
 assert.equal(r.status,201);const assessment=(await r.json()).assessment;
 r=await request("admin",`/api/institutions/college/assessments/${assessment.id}/results/student2`,{method:"PUT",body:JSON.stringify({marksObtained:70})});
 assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/assessments/${assessment.id}/results/student`,{method:"PUT",body:JSON.stringify({marksObtained:70})});
 assert.equal(r.status,200);
 r=await request("other","/api/institutions/college/enrollments");assert.equal(r.status,403);
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"other"})});
 assert.equal(r.status,400);
 r=await request("student",`/api/institutions/college/enrollments/${enrollment.id}`,{method:"DELETE"});assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/enrollments/${enrollment.id}`,{method:"DELETE"});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/courses/${course.id}/attendance`,{method:"POST",body:JSON.stringify({studentUserId:"student",date:"2026-11-15",status:"present"})});assert.equal(r.status,409);
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student"})});
 assert.equal(r.status,200);assert.equal((await r.json()).enrollment.status,"enrolled");
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_course_enrollments").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_operations_audit WHERE entity_type='course_enrollment'").get().n,3);
});


test("course sections enforce institution scope, unique codes, capacity and student assignment visibility",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/courses",{method:"POST",body:JSON.stringify({courseCode:"SEC101",title:"Sectioned Course",academicYear:"2026-2027"})});
 assert.equal(r.status,201);const course=(await r.json()).course;
 r=await request("admin","/api/institutions/college/sections",{method:"POST",body:JSON.stringify({courseId:course.id,sectionCode:"A",sectionName:"Batch A",capacity:1})});
 assert.equal(r.status,201);const section=(await r.json()).section;
 r=await request("admin","/api/institutions/college/sections",{method:"POST",body:JSON.stringify({courseId:course.id,sectionCode:"A",sectionName:"Duplicate",capacity:5})});assert.equal(r.status,409);
 r=await request("other","/api/institutions/college/sections");assert.equal(r.status,403);
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student",sectionId:section.id})});assert.equal(r.status,201);
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student2",sectionId:section.id})});assert.equal(r.status,409);
 r=await request("student","/api/institutions/college/sections");assert.equal(r.status,200);let rows=(await r.json()).sections;assert.equal(rows.length,1);assert.equal(rows[0].id,section.id);assert.equal(rows[0].enrolledCount,1);
 r=await request("student2","/api/institutions/college/sections");assert.equal(r.status,200);assert.equal((await r.json()).sections.length,0);
 r=await request("admin",`/api/institutions/college/sections/${section.id}`,{method:"PATCH",body:JSON.stringify({status:"inactive",capacity:1})});assert.equal(r.status,200);
 r=await request("admin","/api/institutions/college/enrollments",{method:"POST",body:JSON.stringify({courseId:course.id,studentUserId:"student2",sectionId:section.id})});assert.equal(r.status,400);
 r=await request("admin",`/api/institutions/college/sections/${section.id}`,{method:"PATCH",body:JSON.stringify({status:"active",capacity:1})});assert.equal(r.status,200);
 assert.equal(db.prepare("SELECT section_id FROM institution_course_enrollments WHERE student_user_id='student'").get().section_id,section.id);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_operations_audit WHERE entity_type='course_section'").get().n,3);
});


test("guardian contacts are validated, audited, private and institution-scoped",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/students/student/guardians",{method:"POST",body:JSON.stringify({fullName:"Parent One",relationship:"parent",email:"parent@example.test",phone:"+919876543210",isPrimary:true})});
 assert.equal(r.status,201);const guardian=(await r.json()).guardian;
 r=await request("admin","/api/institutions/college/students/student/guardians",{method:"POST",body:JSON.stringify({fullName:"Parent Two",relationship:"guardian",email:"parent2@example.test",isPrimary:true})});
 assert.equal(r.status,409,"Only one primary guardian is allowed.");
 r=await request("student","/api/institutions/college/students/student/guardians");assert.equal(r.status,200);assert.equal((await r.json()).guardians.length,1);
 r=await request("student","/api/institutions/college/students/student/guardians",{method:"POST",body:JSON.stringify({fullName:"Student edit",relationship:"parent",email:"x@example.test"})});assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/students/student/guardians/${guardian.id}`,{method:"PATCH",body:JSON.stringify({fullName:"Parent One Updated",relationship:"parent",phone:"9876543210",isPrimary:true})});assert.equal(r.status,200);
 r=await request("other","/api/institutions/college/students/student/guardians");assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/students/student/guardians/${guardian.id}`,{method:"DELETE"});assert.equal(r.status,200);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_student_lifecycle_audit").get().n,3);
});

test("student suspension and withdrawal revoke institution access and preserve status history with reasons",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/students/student",{method:"PUT",body:JSON.stringify({studentNumber:"RVS-01",department:"AIML",program:"B.Tech",academicYear:"2026-2027",status:"suspended"})});
 assert.equal(r.status,400,"Status changes without a reason must be rejected.");
 r=await request("admin","/api/institutions/college/students/student",{method:"PUT",body:JSON.stringify({studentNumber:"RVS-01",department:"AIML",program:"B.Tech",academicYear:"2026-2027",status:"suspended",statusReason:"Temporary disciplinary suspension approved."})});
 assert.equal(r.status,200);
 assert.equal(db.prepare("SELECT status FROM institution_memberships WHERE user_id='student'").get().status,"suspended");
 r=await request("student","/api/institutions/college/courses");assert.equal(r.status,403);
 r=await request("admin","/api/institutions/college/students");assert.equal(r.status,200);assert.equal((await r.json()).students[0].membershipStatus,"suspended");
 r=await request("admin","/api/institutions/college/students/student/status-history");assert.equal(r.status,200);assert.equal((await r.json()).history.length,1);
 r=await request("admin","/api/institutions/college/students/student",{method:"PUT",body:JSON.stringify({studentNumber:"RVS-01",department:"AIML",program:"B.Tech",academicYear:"2026-2027",status:"active",statusReason:"Suspension period completed and cleared."})});
 assert.equal(r.status,200);assert.equal(db.prepare("SELECT status FROM institution_memberships WHERE user_id='student'").get().status,"active");
 r=await request("admin","/api/institutions/college/students/student/status-history");assert.equal(r.status,200);assert.equal((await r.json()).history.length,2);
});
