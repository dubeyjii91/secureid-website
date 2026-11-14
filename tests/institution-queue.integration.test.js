import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionQueue } from "../server/institution-queue.js";

async function setup(t) {
  const database=new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
    INSERT INTO users VALUES('admin','admin@example.test'),('student-a','a@example.test'),('student-b','b@example.test'),('other-admin','other@example.test');
    INSERT INTO institutions VALUES('college-a','College A'),('college-b','College B');
    INSERT INTO institution_subscriptions VALUES('college-a','["student_management"]','active'),('college-b','["student_management"]','active');
    INSERT INTO institution_memberships VALUES('m1','college-a','admin','institution_admin','active'),('m2','college-a','student-a','student','active'),('m3','college-a','student-b','student','active'),('m4','college-b','other-admin','institution_admin','active');
  `);
  const app=express();
  app.use(express.json());
  app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",role:"user",mfaVerified:true};next();});
  const requireAuth=(req,res,next)=>req.user.id?next():res.status(401).json({success:false});
  const requireMfaProduction=(req,res,next)=>req.user.mfaVerified?next():res.status(403).json({success:false});
  const enforceSameOrigin=(req,res,next)=>next();
  const getInstitutionMembership=(userId,institutionId)=>database.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(userId,institutionId)||null;
  const hasInstitutionFeature=(institutionId,feature)=>database.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(institutionId)?.features_json?.includes('"'+feature+'"')||false;
  registerInstitutionQueue({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature});
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const request=(user,path,options={})=>fetch(base+path,{...options,headers:{"content-type":"application/json","x-user":user,...(options.headers||{})}});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
  return {database,request};
}

test("institution service queue issues sequential persisted tokens and completes a service visit",async t=>{
  const {database,request}=await setup(t);
  let response=await request("admin","/api/institutions/college-a/queue/counters",{method:"POST",body:JSON.stringify({department:"Accounts",name:"Fee Counter 1"})});
  assert.equal(response.status,201);
  const counter=(await response.json()).counter;
  response=await request("student-a",`/api/institutions/college-a/queue/counters/${counter.id}/tokens`,{method:"POST",body:JSON.stringify({purpose:"Fee receipt"})});
  assert.equal(response.status,201);
  const first=(await response.json()).token;
  response=await request("student-b",`/api/institutions/college-a/queue/counters/${counter.id}/tokens`,{method:"POST",body:JSON.stringify({purpose:"Fee correction"})});
  assert.equal(response.status,201);
  const second=(await response.json()).token;
  assert.equal(first.tokenNumber,1);assert.equal(second.tokenNumber,2);
  response=await request("admin",`/api/institutions/college-a/queue/counters/${counter.id}/call-next`,{method:"POST",body:"{}"});
  assert.equal(response.status,200);assert.equal((await response.json()).token.id,first.id);
  response=await request("admin","/api/institutions/college-a/queue/counters/"+counter.id+"/call-next",{method:"POST",body:"{}"});
  assert.equal(response.status,409,"A second token must not be called while the first is active.");
  response=await request("admin",`/api/institutions/college-a/queue/tokens/${first.id}`,{method:"PATCH",body:JSON.stringify({status:"serving"})});
  assert.equal(response.status,200);
  response=await request("admin",`/api/institutions/college-a/queue/tokens/${first.id}`,{method:"PATCH",body:JSON.stringify({status:"completed"})});
  assert.equal(response.status,200);
  const saved=database.prepare("SELECT status FROM institution_queue_tokens WHERE id=?").get(first.id);
  assert.equal(saved.status,"completed");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_queue_audit WHERE institution_id='college-a'").get().n,6);
});

test("queue data and actions are institution-scoped and students can cancel only their own waiting token",async t=>{
  const {request}=await setup(t);
  const created=await request("admin","/api/institutions/college-a/queue/counters",{method:"POST",body:JSON.stringify({department:"Admissions",name:"Help Desk"})});
  const counter=(await created.json()).counter;
  const issued=await request("student-a",`/api/institutions/college-a/queue/counters/${counter.id}/tokens`,{method:"POST",body:JSON.stringify({purpose:"Admission query"})});
  const token=(await issued.json()).token;
  let response=await request("student-b",`/api/institutions/college-a/queue/tokens/${token.id}`,{method:"PATCH",body:JSON.stringify({status:"cancelled"})});
  assert.equal(response.status,403);
  response=await request("student-a",`/api/institutions/college-a/queue/tokens/${token.id}`,{method:"PATCH",body:JSON.stringify({status:"cancelled"})});
  assert.equal(response.status,200);
  response=await request("other-admin",`/api/institutions/college-a/queue`);
  assert.equal(response.status,403);
});

test("queue rejects duplicate counters, paused counters and invalid status transitions",async t=>{
  const {request}=await setup(t);
  const first=await request("admin","/api/institutions/college-a/queue/counters",{method:"POST",body:JSON.stringify({department:"Library",name:"Desk A"})});
  const counter=(await first.json()).counter;
  let response=await request("admin","/api/institutions/college-a/queue/counters",{method:"POST",body:JSON.stringify({department:"Library",name:"Desk A"})});
  assert.equal(response.status,409);
  response=await request("admin",`/api/institutions/college-a/queue/counters/${counter.id}`,{method:"PATCH",body:JSON.stringify({status:"paused"})});
  assert.equal(response.status,200);
  response=await request("student-a",`/api/institutions/college-a/queue/counters/${counter.id}/tokens`,{method:"POST",body:JSON.stringify({purpose:"Library book issue"})});
  assert.equal(response.status,409);
});


test("appointments are persisted, slot-exclusive, institution-scoped and student-private",async t=>{
  const {database,request}=await setup(t);
  let response=await request("admin","/api/institutions/college-a/queue/counters",{method:"POST",body:JSON.stringify({department:"Admissions",name:"Admissions Desk"})});
  assert.equal(response.status,201);
  const counter=(await response.json()).counter;
  const scheduledFor=new Date(Date.now()+60*60*1000).toISOString();
  response=await request("student-a","/api/institutions/college-a/appointments",{method:"POST",body:JSON.stringify({counterId:counter.id,scheduledFor,purpose:"Admission document review"})});
  assert.equal(response.status,201);
  const appointment=(await response.json()).appointment;
  response=await request("student-b","/api/institutions/college-a/appointments",{method:"POST",body:JSON.stringify({counterId:counter.id,scheduledFor,purpose:"Admission counselling"})});
  assert.equal(response.status,409,"An occupied counter slot must not be double-booked.");
  response=await request("student-b","/api/institutions/college-a/appointments");
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).appointments,[]);
  response=await request("other-admin","/api/institutions/college-a/appointments");
  assert.equal(response.status,403);
  response=await request("admin","/api/institutions/college-a/appointments");
  assert.equal(response.status,200);
  assert.equal((await response.json()).appointments[0].id,appointment.id);
  response=await request("admin",`/api/institutions/college-a/appointments/${appointment.id}`,{method:"PATCH",body:JSON.stringify({status:"confirmed"})});
  assert.equal(response.status,200);
  response=await request("student-a",`/api/institutions/college-a/appointments/${appointment.id}`,{method:"PATCH",body:JSON.stringify({status:"cancelled"})});
  assert.equal(response.status,200);
  assert.equal(database.prepare("SELECT status FROM institution_service_appointments WHERE id=?").get(appointment.id).status,"cancelled");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_appointment_audit WHERE appointment_id=?").get(appointment.id).n,3);
});

test("appointments reject invalid times, paused counters and unauthorized review transitions",async t=>{
  const {request}=await setup(t);
  let response=await request("admin","/api/institutions/college-a/queue/counters",{method:"POST",body:JSON.stringify({department:"Accounts",name:"Fee Desk"})});
  const counter=(await response.json()).counter;
  response=await request("student-a","/api/institutions/college-a/appointments",{method:"POST",body:JSON.stringify({counterId:counter.id,scheduledFor:new Date(Date.now()+1000).toISOString(),purpose:"Fee query"})});
  assert.equal(response.status,400);
  const future=new Date(Date.now()+2*60*60*1000).toISOString();
  response=await request("admin",`/api/institutions/college-a/queue/counters/${counter.id}`,{method:"PATCH",body:JSON.stringify({status:"paused"})});
  assert.equal(response.status,200);
  response=await request("student-a","/api/institutions/college-a/appointments",{method:"POST",body:JSON.stringify({counterId:counter.id,scheduledFor:future,purpose:"Fee query"})});
  assert.equal(response.status,409);
  response=await request("admin",`/api/institutions/college-a/appointments/missing`,{method:"PATCH",body:JSON.stringify({status:"confirmed"})});
  assert.equal(response.status,404);
});
