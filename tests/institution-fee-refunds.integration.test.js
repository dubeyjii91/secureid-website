import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionFeeRefunds } from "../server/institution-fee-refunds.js";

async function setup(t){
 const db=new DatabaseSync(":memory:");
 db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
  CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
  CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
  CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
  CREATE TABLE institution_fee_invoices(id TEXT PRIMARY KEY,institution_id TEXT,student_user_id TEXT,fee_head TEXT,amount_paise INTEGER,status TEXT,updated_at TEXT);
  CREATE TABLE institution_fee_payments(id TEXT PRIMARY KEY,institution_id TEXT,invoice_id TEXT,student_user_id TEXT,amount_paise INTEGER,method TEXT,reference TEXT,created_at TEXT);
  INSERT INTO users VALUES('admin','admin@college.test'),('finance','finance@college.test'),('student','student@college.test'),('other','other@college.test');
  INSERT INTO institutions VALUES('college','RVS College'),('other-college','Other College');
  INSERT INTO institution_subscriptions VALUES('college','["finance"]','active'),('other-college','["finance"]','active');
  INSERT INTO institution_memberships VALUES('a','college','admin','institution_admin','active'),('f','college','finance','finance_manager','active'),('s','college','student','student','active'),('o','other-college','other','institution_admin','active');
  INSERT INTO institution_fee_invoices VALUES('invoice','college','student','Tuition Fee',100000,'paid','2026-11-14T10:00:00.000Z');
  INSERT INTO institution_fee_payments VALUES('payment','college','invoice','student',100000,'upi','UPI-001','2026-11-14T10:00:00.000Z');
 `);
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",email:({admin:"admin@college.test",finance:"finance@college.test",student:"student@college.test",other:"other@college.test"})[req.get("x-user")]||""};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),pass=(req,res,next)=>next();
 const membership=(userId,institutionId)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(userId,institutionId)||null;
 const feature=(institutionId,name)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(institutionId)?.features_json?.includes('"'+name+'"')||false;
 registerInstitutionFeeRefunds({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
 const request=(user,url,options={})=>fetch("http://127.0.0.1:"+server.address().port+url,{...options,headers:{"content-type":"application/json","x-user":user,...(options.headers||{})}});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 return {db,request};
}

test("refund requests reserve payment balance, require independent review and reconcile only after external reference",async t=>{
 const {db,request}=await setup(t);
 let response=await request("admin","/api/institutions/college/finance/refunds");
 assert.equal(response.status,200);
 let data=await response.json();assert.equal(data.payments[0].refundablePaise,100000);assert.equal(data.payments[0].studentEmail,"student@college.test");
 response=await request("student","/api/institutions/college/finance/payments/payment/refunds",{method:"POST",headers:{"Idempotency-Key":"refund-request-0001"},body:JSON.stringify({amountPaise:30000,reason:"Student withdrew before the final course start date."})});
 assert.equal(response.status,201);const refund=(await response.json()).refund;
 response=await request("student","/api/institutions/college/finance/payments/payment/refunds",{method:"POST",headers:{"Idempotency-Key":"refund-request-0001"},body:JSON.stringify({studentUserId:"student",amountPaise:30000,reason:"Student withdrew before the final course start date."})});
 assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);
 response=await request("admin","/api/institutions/college/finance/payments/payment/refunds",{method:"POST",headers:{"Idempotency-Key":"refund-request-0002"},body:JSON.stringify({amountPaise:80000,reason:"Second refund request would exceed the remaining payment balance."})});
 assert.equal(response.status,409);
 response=await request("student","/api/institutions/college/finance/refunds");assert.equal(response.status,200);assert.equal((await response.json()).canRequest,true);
 response=await request("other","/api/institutions/college/finance/refunds");assert.equal(response.status,403);
 response=await request("admin",`/api/institutions/college/finance/refunds/${refund.id}`,{method:"PATCH",body:JSON.stringify({decision:"approve",reviewNote:"Reviewed and eligible."})});
 assert.equal(response.status,403,"The initiator cannot approve their own refund.");
 response=await request("finance",`/api/institutions/college/finance/refunds/${refund.id}`,{method:"PATCH",body:JSON.stringify({decision:"approve",reviewNote:"Reviewed and eligible."})});
 assert.equal(response.status,200);
 response=await request("finance",`/api/institutions/college/finance/refunds/${refund.id}`,{method:"PATCH",body:JSON.stringify({decision:"record",reviewNote:"Bank transfer confirmed.",externalReference:"UTR-REFUND-001"})});
 assert.equal(response.status,200);
 assert.equal(db.prepare("SELECT status FROM institution_fee_invoices WHERE id='invoice'").get().status,"partial");
 assert.equal(db.prepare("SELECT status,external_reference FROM institution_fee_refund_requests WHERE id=?").get(refund.id).status,"recorded");
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_fee_refund_audit WHERE refund_id=?").get(refund.id).n,3);
 response=await request("admin","/api/institutions/college/finance/refunds");
 data=await response.json();assert.equal(data.payments[0].refundablePaise,70000);assert.equal(data.refunds[0].canReviewThis,true);
});

test("refunds cannot be recorded before approval or without a completed external transfer reference",async t=>{
 const {request}=await setup(t);
 let response=await request("admin","/api/institutions/college/finance/payments/payment/refunds",{method:"POST",headers:{"Idempotency-Key":"refund-request-0003"},body:JSON.stringify({amountPaise:10000,reason:"Refund due to duplicate payment transaction."})});
 const refund=(await response.json()).refund;
 response=await request("finance",`/api/institutions/college/finance/refunds/${refund.id}`,{method:"PATCH",body:JSON.stringify({decision:"record",reviewNote:"Attempting early record.",externalReference:"UTR-001"})});
 assert.equal(response.status,409);
 response=await request("finance",`/api/institutions/college/finance/refunds/${refund.id}`,{method:"PATCH",body:JSON.stringify({decision:"approve",reviewNote:"Approved for refund."})});
 assert.equal(response.status,200);
 response=await request("finance",`/api/institutions/college/finance/refunds/${refund.id}`,{method:"PATCH",body:JSON.stringify({decision:"record",reviewNote:"Transfer made but reference missing."})});
 assert.equal(response.status,400);
});
