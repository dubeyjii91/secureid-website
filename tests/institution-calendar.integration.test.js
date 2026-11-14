import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionCalendar} from "../server/institution-calendar.js";
async function setup(t){
 const db=new DatabaseSync(":memory:");db.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT);
 CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
 CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
 INSERT INTO users VALUES('admin','admin@test'),('student','student@test'),('other-admin','other@test');
 INSERT INTO institutions VALUES('college','RVS College'),('other-college','Other College');
 INSERT INTO institution_subscriptions VALUES('college','["academics"]','active'),('other-college','["academics"]','active');
 INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('s','college','student','student','active'),('oa','other-college','other-admin','institution_admin','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionCalendar({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});return {db,request};
}
test("institution academic calendar persists events, filters audience, edits and audits cancellation",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/calendar",{method:"POST",body:JSON.stringify({title:"Semester begins",category:"academic",description:"First day of semester",startsAt:"2026-12-01T09:00:00.000Z",endsAt:"2026-12-01T10:00:00.000Z",allDay:false,location:"Main campus",audience:"students"})});
 assert.equal(r.status,201);const event=(await r.json()).event;assert.equal(event.status,"scheduled");
 r=await request("student","/api/institutions/college/calendar");assert.equal(r.status,200);let list=await r.json();assert.equal(list.events.length,1);assert.equal(list.canManage,false);
 r=await request("student","/api/institutions/college/calendar",{method:"POST",body:"{}"});assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/calendar/${event.id}`,{method:"PATCH",body:JSON.stringify({title:"Updated semester begins",category:"academic",startsAt:"2026-12-02T09:00:00.000Z",endsAt:"2026-12-02T10:00:00.000Z",audience:"all"})});assert.equal(r.status,200);
 r=await request("other-admin","/api/institutions/college/calendar");assert.equal(r.status,403);
 r=await request("admin",`/api/institutions/college/calendar/${event.id}`,{method:"DELETE"});assert.equal(r.status,200);
 r=await request("admin","/api/institutions/college/calendar");assert.equal((await r.json()).events.length,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_calendar_audit WHERE institution_id='college'").get().n,3);
});
test("academic calendar rejects invalid ranges and categories",async t=>{
 const {request}=await setup(t);
 let r=await request("admin","/api/institutions/college/calendar",{method:"POST",body:JSON.stringify({title:"Bad date",category:"holiday",startsAt:"2026-12-02T10:00:00Z",endsAt:"2026-12-01T10:00:00Z",audience:"all"})});assert.equal(r.status,400);
 r=await request("admin","/api/institutions/college/calendar",{method:"POST",body:JSON.stringify({title:"Unknown",category:"random",startsAt:"2026-12-01T09:00:00Z",endsAt:"2026-12-01T10:00:00Z",audience:"all"})});assert.equal(r.status,400);
});
