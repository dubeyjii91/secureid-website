import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionModules} from "../server/institution-modules.js";

async function setup(t){
 const db=new DatabaseSync(":memory:");
 db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
  CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT,updated_at TEXT);
  CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
  INSERT INTO users VALUES('admin','admin@test'),('student','student@test'),('other','other@test');
  INSERT INTO institutions VALUES('college','College'),('other-college','Other College');
  INSERT INTO institution_subscriptions VALUES('college','["academics","student_management","staff_management","finance"]','active',CURRENT_TIMESTAMP),('other-college','["academics"]','active',CURRENT_TIMESTAMP);
  INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('s','college','student','student','active'),('o','other-college','other','institution_admin','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status IN ('pilot','active')").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionModules({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 return {db,request};
}

test("weekly timetable persists, rejects overlaps, enforces tenant roles and records audit",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/courses",{method:"POST",body:JSON.stringify({courseCode:"CS101",title:"Computer Science",academicYear:"2026-2027"})});
 assert.equal(r.status,201);const course=(await r.json()).course;
 r=await request("admin","/api/institutions/college/timetable",{method:"POST",body:JSON.stringify({courseId:course.id,weekday:1,startsAt:"09:00",endsAt:"10:00",room:"A-101"})});
 assert.equal(r.status,201);const entry=(await r.json()).entry;
 r=await request("admin","/api/institutions/college/timetable",{method:"POST",body:JSON.stringify({courseId:course.id,weekday:1,startsAt:"09:30",endsAt:"10:30"})});
 assert.equal(r.status,409);
 r=await request("student","/api/institutions/college/timetable");assert.equal(r.status,200);const rows=(await r.json()).entries;assert.equal(rows.length,1);assert.equal(rows[0].room,"A-101");
 r=await request("other","/api/institutions/college/timetable");assert.equal(r.status,403);
 r=await request("student",`/api/institutions/college/timetable/${entry.id}`,{method:"DELETE"});assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/timetable/${entry.id}`,{method:"DELETE"});assert.equal(r.status,200);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_operations_audit WHERE entity_type='timetable'").get().n,2);
});
