import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionCertificates} from "../server/institution-certificates.js";
async function setup(t){
 const db=new DatabaseSync(":memory:");db.exec(`
 PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE);CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
 CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
 INSERT INTO users VALUES('admin','admin@test'),('student','student@test'),('other','other@test'),('staff','staff@test');
 INSERT INTO institutions VALUES('college','RVS Test College');INSERT INTO institution_subscriptions VALUES('college','["student_management"]','active');
 INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('s','college','student','student','active'),('o','college','other','student','active'),('f','college','staff','reviewer','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionCertificates({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(u,p,o={})=>fetch("http://127.0.0.1:"+server.address().port+p,{...o,headers:{"content-type":"application/json","x-user":u,...(o.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});return {db,request};
}
test("certificate request approval issuance printable document and public verification work end to end",async t=>{
 const {db,request}=await setup(t);
 let r=await request("student","/api/institutions/college/certificates",{method:"POST",body:JSON.stringify({certificateType:"bonafide",studentName:"Test Student",studentNumber:"RVS-001",purpose:"For scholarship application"})});
 assert.equal(r.status,201);const req=(await r.json()).request;
 r=await request("staff",`/api/institutions/college/certificates/${req.id}`,{method:"PATCH",body:JSON.stringify({status:"approved",reviewNote:"Verified student record."})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/certificates/${req.id}/issue`,{method:"POST",body:"{}"});assert.equal(r.status,201);const cert=(await r.json()).certificate;
 r=await request("student",`/api/institutions/college/certificates/${cert.id}/document`);assert.equal(r.status,200);const html=await r.text();assert.match(html,/Test Student/);assert.match(html,/RVS Test College/);
 r=await request("", "/api/certificates/verify",{method:"POST",body:JSON.stringify({token:cert.verificationPath.split("#")[1]})});assert.equal(r.status,200);const verified=await r.json();assert.equal(verified.valid,true);assert.equal(verified.serialNumber,cert.serialNumber);
});
test("certificate access is student-private and requests cannot be issued before approval",async t=>{
 const {request}=await setup(t);
 let r=await request("student","/api/institutions/college/certificates",{method:"POST",body:JSON.stringify({certificateType:"character",studentName:"Test Student",studentNumber:"RVS-002",purpose:"For internship"})});const req=(await r.json()).request;
 r=await request("admin",`/api/institutions/college/certificates/${req.id}/issue`,{method:"POST",body:"{}"});assert.equal(r.status,409);
 r=await request("student",`/api/institutions/college/certificates`);const list=await r.json();assert.equal(list.requests[0].id,req.id);
 r=await request("other",`/api/institutions/college/certificates`);assert.equal((await r.json()).requests.length,0);
 r=await request("other",`/api/institutions/college/certificates/not-a-cert/document`);assert.equal(r.status,404);
});
