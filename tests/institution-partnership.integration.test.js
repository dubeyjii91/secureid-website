import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionPartnership } from "../server/institution-partnership.js";

async function setup(t) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,plan_key TEXT NOT NULL,status TEXT NOT NULL,features_json TEXT,starts_at TEXT,ends_at TEXT,updated_by TEXT,updated_at TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL);
    INSERT INTO users VALUES('owner','owner@example.test'),('college-admin','admin@college.example'),('student','student@example.test');
    INSERT INTO institutions VALUES('college-a','Example College','2026-01-01T00:00:00.000Z'),('college-b','Other College','2026-01-01T00:00:00.000Z');
    INSERT INTO institution_subscriptions VALUES('college-a','standard','active','[]',NULL,NULL,'owner','2026-01-01T00:00:00.000Z');
    INSERT INTO institution_subscriptions VALUES('college-b','pilot','pilot','[]',NULL,NULL,'owner','2026-01-01T00:00:00.000Z');
    INSERT INTO institution_memberships VALUES('m1','college-a','college-admin','institution_admin','active');
    INSERT INTO institution_memberships VALUES('m2','college-a','student','student','active');
  `);
  const app = express();
  app.use(express.json());
  app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",role:req.get("x-role")||"user",mfaVerified:req.get("x-mfa")!=="false"};next();});
  const requireAuth=(req,res,next)=>req.user.id?next():res.status(401).json({success:false});
  const requireMfaProduction=(req,res,next)=>req.user.mfaVerified?next():res.status(403).json({success:false,code:"MFA_REQUIRED"});
  const enforceSameOrigin=(req,res,next)=>next();
  registerInstitutionPartnership({app,database,requireAuth,requireMfaProduction,enforceSameOrigin});
  app.use((error,req,res,next)=>res.status(500).json({success:false,message:error.message}));
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
  const request=(path,options={})=>fetch(base+path,{...options,headers:{"content-type":"application/json","x-user":"owner","x-role":"owner",...(options.headers||{})}});
  return {database,request,base};
}

test("institution cannot be marked connected until identity, representative, agreement and subscription checks pass",async t=>{
  const {request}=await setup(t);
  let response=await request("/api/admin/institutions/college-a/partnership/checks",{method:"POST",body:JSON.stringify({checkType:"technical_connection",outcome:"verified",evidenceReference:"api-test-001"})});
  assert.equal(response.status,409);
  response=await request("/api/admin/institutions/college-a/partnership",{method:"PUT",body:JSON.stringify({
    aisheCode:"U-1234",officialWebsite:"https://college.example",officialEmailDomain:"college.example",
    address:"Example Road",representativeName:"Principal Test",representativeTitle:"Principal",
    representativeEmail:"principal@college.example",agreementReference:"AGR-2026-001",
    paymentReference:"UTR-TEST-123456",paymentAmountPaise:250000,connectionMode:"dashboard"
  })});
  assert.equal(response.status,200);
  for(const [checkType,evidenceReference] of [
    ["institution_identity","AISHE-DIRECTORY-RECORD"],
    ["representative_authority","OFFICIAL-CALL-LOG-001"],
    ["partnership_agreement","SIGNED-AGREEMENT-001"],
    ["subscription_payment","BANK-UTR-123456"]
  ]){
    response=await request("/api/admin/institutions/college-a/partnership/checks",{method:"POST",body:JSON.stringify({checkType,outcome:"verified",evidenceReference})});
    assert.equal(response.status,200);
  }
  response=await request("/api/admin/institutions/college-a/partnership/checks",{method:"POST",body:JSON.stringify({checkType:"technical_connection",outcome:"verified",evidenceReference:"DASHBOARD-LOGIN-TEST-001"})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.readiness.connected,true);
  assert.equal(result.profile.connectionStatus,"connected");
  assert.equal(result.evidence.length,5);
  response=await request("/api/admin/institutions/college-a/partnership",{method:"PUT",body:JSON.stringify({
    aisheCode:"U-1234",officialWebsite:"https://college.example",officialEmailDomain:"college.example",
    address:"Example Road",representativeName:"Principal Test",representativeTitle:"Principal",
    representativeEmail:"new-principal@college.example",agreementReference:"AGR-2026-001",
    paymentReference:"UTR-TEST-123456",paymentAmountPaise:250000,connectionMode:"dashboard"
  })});
  assert.equal(response.status,200);
  const changed=await response.json();
  assert.equal(changed.profile.representativeStatus,"pending");
  assert.equal(changed.profile.connectionStatus,"not_connected");
  assert.equal(changed.readiness.connected,false);
});

test("representative must use the institution's declared official email domain",async t=>{
  const {request}=await setup(t);
  await request("/api/admin/institutions/college-a/partnership",{method:"PUT",body:JSON.stringify({
    aisheCode:"U-1234",officialWebsite:"https://college.example",officialEmailDomain:"college.example",
    address:"Example Road",representativeName:"Principal Test",representativeEmail:"principal@attacker.example"
  })});
  const response=await request("/api/admin/institutions/college-a/partnership/checks",{method:"POST",body:JSON.stringify({checkType:"representative_authority",outcome:"verified",evidenceReference:"CALL-LOG-001"})});
  assert.equal(response.status,409);
});

test("only owner with MFA can manage partnership checks; only active institution admins can read status",async t=>{
  const {request,base}=await setup(t);
  let response=await fetch(base+"/api/admin/institutions/college-a/partnership",{headers:{"x-user":"student","x-role":"user"}});
  assert.equal(response.status,403);
  response=await fetch(base+"/api/admin/institutions/college-a/partnership",{headers:{"x-user":"owner","x-role":"owner","x-mfa":"false"}});
  assert.equal(response.status,403);
  response=await fetch(base+"/api/institutions/college-a/partnership-status",{headers:{"x-user":"student"}});
  assert.equal(response.status,403);
  response=await fetch(base+"/api/institutions/college-a/partnership-status",{headers:{"x-user":"college-admin"}});
  assert.equal(response.status,200);
  response=await fetch(base+"/api/institutions/college-b/partnership-status",{headers:{"x-user":"college-admin"}});
  assert.equal(response.status,403);
});
