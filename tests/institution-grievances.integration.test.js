import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionGrievances} from "../server/institution-grievances.js";
async function setup(t){
 const db=new DatabaseSync(":memory:");db.exec(`
 PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE);CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
 CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
 INSERT INTO users VALUES('admin','admin@test'),('student-a','a@test'),('student-b','b@test'),('staff','staff@test');
 INSERT INTO institutions VALUES('college','College');INSERT INTO institution_subscriptions VALUES('college','["student_management"]','active');
 INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('b','college','student-a','student','active'),('c','college','student-b','student','active'),('d','college','staff','reviewer','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionGrievances({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});return {db,request};
}
test("student grievance is ticketed, private, threaded and resolved with audit trail",async t=>{
 const {db,request}=await setup(t);
 let r=await request("student-a","/api/institutions/college/grievances",{method:"POST",body:JSON.stringify({category:"Hostel",subject:"Water supply issue",description:"There has been no water supply in the hostel block since morning.",priority:"high"})});
 assert.equal(r.status,201);const ticket=(await r.json()).grievance;assert.equal(ticket.ticketNumber,1);assert.ok(Date.parse(ticket.slaDueAt)>Date.now());
 r=await request("student-b",`/api/institutions/college/grievances/${ticket.id}/messages`);assert.equal(r.status,403);
 r=await request("student-a",`/api/institutions/college/grievances/${ticket.id}/messages`,{method:"POST",body:JSON.stringify({message:"Adding a photo reference in the next update."})});assert.equal(r.status,201);
 r=await request("staff",`/api/institutions/college/grievances/${ticket.id}`,{method:"PATCH",body:JSON.stringify({status:"assigned",assignedTo:"staff",priority:"urgent"})});assert.equal(r.status,200);
 r=await request("staff",`/api/institutions/college/grievances/${ticket.id}`,{method:"PATCH",body:JSON.stringify({status:"resolved",resolution:"Maintenance team restored the water supply and verified the pump."})});assert.equal(r.status,200);
 r=await request("student-a","/api/institutions/college/grievances");assert.equal(r.status,200);const list=await r.json();assert.equal(list.grievances[0].status,"resolved");
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_grievance_audit WHERE grievance_id=?").get(ticket.id).n,3);
});
test("grievance validates fields, status transitions and student ownership",async t=>{
 const {request}=await setup(t);
 let r=await request("student-a","/api/institutions/college/grievances",{method:"POST",body:JSON.stringify({category:"x",subject:"bad",description:"short"})});assert.equal(r.status,400);
 r=await request("student-a","/api/institutions/college/grievances",{method:"POST",body:JSON.stringify({category:"Fees",subject:"Incorrect fee demand",description:"My fee demand shows an amount that differs from the approved schedule."})});const ticket=(await r.json()).grievance;
 r=await request("student-a",`/api/institutions/college/grievances/${ticket.id}`,{method:"PATCH",body:JSON.stringify({status:"closed"})});assert.equal(r.status,403);
 r=await request("staff",`/api/institutions/college/grievances/${ticket.id}`,{method:"PATCH",body:JSON.stringify({status:"closed"})});assert.equal(r.status,200);
 r=await request("staff",`/api/institutions/college/grievances/${ticket.id}`,{method:"PATCH",body:JSON.stringify({status:"resolved",resolution:"This is not an allowed transition after closure."})});assert.equal(r.status,409);
});
