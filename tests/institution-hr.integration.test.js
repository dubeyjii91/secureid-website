import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionHR} from "../server/institution-hr.js";
async function setup(t){
 const db=new DatabaseSync(":memory:");db.exec(`
 PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE);CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
 CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
 CREATE TABLE institution_staff(id TEXT PRIMARY KEY,institution_id TEXT,full_name TEXT NOT NULL,email TEXT,employee_code TEXT,department TEXT,designation TEXT,status TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
 INSERT INTO users VALUES('admin','admin@test'),('faculty','faculty@test'),('wrong','wrong@test');
 INSERT INTO institutions VALUES('college','College');INSERT INTO institution_subscriptions VALUES('college','["staff_management"]','active');
 INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('f','college','faculty','reviewer','active');
 INSERT INTO institution_staff VALUES('staff-1','college','Faculty Member','faculty@test','EMP-1','CSE','Assistant Professor','active','admin','2026-01-01','2026-01-01');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionHR({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});return {db,request};
}
test("staff account linking, leave approval and attendance records persist with audit",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/staff/staff-1/link-account",{method:"POST",body:JSON.stringify({userId:"faculty"})});assert.equal(r.status,200);
 r=await request("faculty","/api/institutions/college/hr/leave",{method:"POST",body:JSON.stringify({leaveType:"casual",startsOn:"2026-12-01",endsOn:"2026-12-02",reason:"Family commitment and travel."})});assert.equal(r.status,201);const leave=(await r.json()).request;
 r=await request("faculty","/api/institutions/college/hr/leave",{method:"POST",body:JSON.stringify({leaveType:"sick",startsOn:"2026-12-02",endsOn:"2026-12-03",reason:"Medical rest requested."})});assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/hr/leave/${leave.id}`,{method:"PATCH",body:JSON.stringify({status:"approved"})});assert.equal(r.status,200);
 r=await request("admin","/api/institutions/college/hr/attendance/staff-1",{method:"PUT",body:JSON.stringify({date:"2026-11-14",status:"present",note:"On campus"})});assert.equal(r.status,200);
 r=await request("admin","/api/institutions/college/hr/attendance?date=2026-11-14");assert.equal(r.status,200);assert.equal((await r.json()).attendance[0].status,"present");
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_hr_audit").get().n,4);
});
test("staff account linking requires matching email and staff-only permissions",async t=>{
 const {request}=await setup(t);
 let r=await request("admin","/api/institutions/college/staff/staff-1/link-account",{method:"POST",body:JSON.stringify({userId:"wrong"})});assert.equal(r.status,409);
 r=await request("faculty","/api/institutions/college/staff/staff-1/link-account",{method:"POST",body:JSON.stringify({userId:"faculty"})});assert.equal(r.status,403);
});
