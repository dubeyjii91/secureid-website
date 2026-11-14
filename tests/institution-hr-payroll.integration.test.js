import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerInstitutionHR} from "../server/institution-hr.js";
async function setup(t){
 const db=new DatabaseSync(":memory:");db.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT);
 CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
 CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
 CREATE TABLE institution_staff(id TEXT PRIMARY KEY,institution_id TEXT,full_name TEXT,email TEXT,employee_code TEXT,status TEXT,updated_at TEXT,user_id TEXT);
 INSERT INTO users VALUES('admin','admin@test'),('staff-user','staff@test'),('other','other@test');
 INSERT INTO institutions VALUES('college','RVS College');
 INSERT INTO institution_subscriptions VALUES('college','["staff_management"]','active');
 INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('s','college','staff-user','reviewer','active');
 INSERT INTO institution_staff VALUES('staff-1','college','=HYPERLINK("https://bad.test")','staff@test','EMP-001','active','2026-01-01T00:00:00Z','staff-user');
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
test("payroll enforces configured amounts, approval and payment lifecycle with staff-private access",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college/hr/payroll",{method:"POST",body:JSON.stringify({staffId:"staff-1",periodStart:"2026-10-01",periodEnd:"2026-10-31",grossPaise:5000000,deductionsPaise:500000})});
 assert.equal(r.status,201);const payroll=(await r.json()).payroll;assert.equal(payroll.netPaise,4500000);
 r=await request("staff-user","/api/institutions/college/hr/payroll");assert.equal(r.status,200);let body=await r.json();assert.equal(body.payroll.length,1);assert.equal(body.canManage,false);
 r=await request("other","/api/institutions/college/hr/payroll");assert.equal(r.status,403);
 r=await request("admin","/api/institutions/college/hr/payroll",{method:"POST",body:JSON.stringify({staffId:"staff-1",periodStart:"2026-10-01",periodEnd:"2026-10-31",grossPaise:5000000,deductionsPaise:500000})});assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/hr/payroll/${payroll.id}/pay`,{method:"PATCH",body:JSON.stringify({paymentMethod:"bank_transfer",paymentReference:"UTR-001"})});assert.equal(r.status,409);
 r=await request("admin",`/api/institutions/college/hr/payroll/${payroll.id}/approve`,{method:"PATCH",body:"{}"});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/hr/payroll/${payroll.id}/pay`,{method:"PATCH",body:JSON.stringify({paymentMethod:"bank_transfer",paymentReference:"UTR-001"})});assert.equal(r.status,200);
 r=await request("admin",`/api/institutions/college/hr/payroll/${payroll.id}/pay`,{method:"PATCH",body:JSON.stringify({paymentMethod:"cash",paymentReference:"CASH-001"})});assert.equal(r.status,409);
 assert.equal(db.prepare("SELECT status FROM institution_staff_payroll WHERE id=?").get(payroll.id).status,"paid");
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_hr_audit WHERE action LIKE 'payroll_%'").get().n,3);
});
test("payroll rejects invalid paise and exports formula-safe CSV only to administrators",async t=>{
 const {request}=await setup(t);
 let r=await request("admin","/api/institutions/college/hr/payroll",{method:"POST",body:JSON.stringify({staffId:"staff-1",periodStart:"2026-10-01",periodEnd:"2026-10-31",grossPaise:100,deductionsPaise:101})});assert.equal(r.status,400);
 r=await request("admin","/api/institutions/college/hr/payroll",{method:"POST",body:JSON.stringify({staffId:"staff-1",periodStart:"2026-11-01",periodEnd:"2026-11-30",grossPaise:100000,deductionsPaise:0})});assert.equal(r.status,201);
 r=await request("staff-user","/api/institutions/college/hr/payroll.csv");assert.equal(r.status,403);
 r=await request("admin","/api/institutions/college/hr/payroll.csv");assert.equal(r.status,200);
 const csv=await r.text();assert.match(csv,/'=HYPERLINK/);assert.match(csv,/net_paise/);
});
