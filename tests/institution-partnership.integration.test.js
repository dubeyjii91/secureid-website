import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionPartnership } from "../server/institution-partnership.js";
import { registerInstitutionFeeGateway } from "../server/institution-fee-gateway.js";

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
    INSERT INTO institution_subscriptions VALUES('college-a','standard','active','[\"finance\"]',NULL,NULL,'owner','2026-01-01T00:00:00.000Z');
    INSERT INTO institution_subscriptions VALUES('college-b','pilot','pilot','[]',NULL,NULL,'owner','2026-01-01T00:00:00.000Z');
    INSERT INTO institution_memberships VALUES('m1','college-a','college-admin','institution_admin','active');
    INSERT INTO institution_memberships VALUES('m2','college-a','student','student','active');
    CREATE TABLE institution_fee_invoices(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,student_user_id TEXT NOT NULL,fee_head TEXT NOT NULL,description TEXT,amount_paise INTEGER NOT NULL,due_date TEXT,status TEXT NOT NULL DEFAULT 'unpaid',created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE institution_fee_payments(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,invoice_id TEXT NOT NULL,student_user_id TEXT NOT NULL,amount_paise INTEGER NOT NULL,method TEXT NOT NULL,reference TEXT,idempotency_key TEXT NOT NULL,received_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(institution_id,idempotency_key));
    CREATE TABLE institution_operations_audit(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details_json TEXT,created_at TEXT NOT NULL);
  `);
  const app = express();
  app.use(express.json({verify(req,res,buffer){req.rawBody=Buffer.from(buffer);}}));
  app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",role:req.get("x-role")||"user",mfaVerified:req.get("x-mfa")!=="false"};next();});
  const requireAuth=(req,res,next)=>req.user.id?next():res.status(401).json({success:false});
  const requireMfaProduction=(req,res,next)=>req.user.mfaVerified?next():res.status(403).json({success:false,code:"MFA_REQUIRED"});
  const enforceSameOrigin=(req,res,next)=>next();
  registerInstitutionPartnership({app,database,requireAuth,requireMfaProduction,enforceSameOrigin});
  const getInstitutionMembership=(userId,institutionId)=>database.prepare("SELECT role,status FROM institution_memberships WHERE institution_id=? AND user_id=?").get(institutionId,userId)||null;
  const hasInstitutionFeature=(institutionId,feature)=>database.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(institutionId)?.features_json?.includes('"'+feature+'"')||false;
  registerInstitutionFeeGateway({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature});
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

test("free pilot access cannot be recorded as a paid subscription",async t=>{
  const {request}=await setup(t);
  const saved=await request("/api/admin/institutions/college-b/partnership",{method:"PUT",body:JSON.stringify({
    aisheCode:"U-5678",officialWebsite:"https://other.example",officialEmailDomain:"other.example",
    address:"Other Road",paymentReference:"PILOT-NOT-PAID",paymentAmountPaise:100000,connectionMode:"dashboard"
  })});
  assert.equal(saved.status,200);
  const response=await request("/api/admin/institutions/college-b/partnership/checks",{method:"POST",body:JSON.stringify({
    checkType:"subscription_payment",outcome:"verified",evidenceReference:"PILOT-TEST-REF"
  })});
  assert.equal(response.status,409);
});


test("Razorpay payment webhook requires a valid signature and activates the paid institution only after settlement",async t=>{
  const {database,request}=await setup(t);
  const previousSecret=process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET="test-webhook-secret";
  t.after(()=>{if(previousSecret===undefined)delete process.env.RAZORPAY_WEBHOOK_SECRET;else process.env.RAZORPAY_WEBHOOK_SECRET=previousSecret;});
  await request("/api/admin/institutions/college-a/partnership",{method:"PUT",body:JSON.stringify({
    aisheCode:"U-1234",officialWebsite:"https://college.example",officialEmailDomain:"college.example",
    address:"Example Road",representativeName:"Principal Test",representativeEmail:"principal@college.example",
    agreementReference:"AGR-2026-001",paymentAmountPaise:250000,connectionMode:"dashboard"
  })});
  database.prepare("INSERT INTO institution_payment_links(id,institution_id,provider_link_id,amount_paise,short_url,created_by,created_at) VALUES('link-row','college-a','plink_test',250000,'https://rzp.io/test','owner',?)").run(new Date().toISOString());
  const payload={event:"payment_link.paid",payload:{payment_link:{entity:{id:"plink_test",amount_paid:250000,currency:"INR"}}}};
  const raw=JSON.stringify(payload);
  const bad=await request("/api/webhooks/razorpay",{method:"POST",body:raw,headers:{"x-razorpay-signature":"0".repeat(64),"x-razorpay-event-id":"evt_bad"}});
  assert.equal(bad.status,401);
  const signature=(await import("node:crypto")).createHmac("sha256","test-webhook-secret").update(raw).digest("hex");
  const good=await request("/api/webhooks/razorpay",{method:"POST",body:raw,headers:{"x-razorpay-signature":signature,"x-razorpay-event-id":"evt_paid_001"}});
  const goodBody=await good.text();
  if (good.status !== 200) console.error("RAZORPAY_WEBHOOK_DIAGNOSTIC", { status: good.status, body: goodBody });
  assert.equal(good.status,200,`Signed webhook response (${good.status}): ${goodBody}`);
  assert.equal(database.prepare("SELECT status FROM institution_payment_links WHERE provider_link_id='plink_test'").get().status,"paid");
  assert.equal(database.prepare("SELECT payment_status FROM institution_partnership_profiles WHERE institution_id='college-a'").get().payment_status,"verified");
  assert.equal(database.prepare("SELECT status FROM institution_subscriptions WHERE institution_id='college-a'").get().status,"active");
  const duplicate=await request("/api/webhooks/razorpay",{method:"POST",body:raw,headers:{"x-razorpay-signature":signature,"x-razorpay-event-id":"evt_paid_001"}});
  const duplicateBody=await duplicate.text();
  assert.equal(duplicate.status,200,`Duplicate webhook response (${duplicate.status}): ${duplicateBody}`);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_payment_webhook_events").get().n,1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_partnership_audit WHERE action='payment_confirmed_by_gateway'").get().n,1);
});


test("API and ERP modes cannot be declared connected without an actual integration handshake",async t=>{
  const {request}=await setup(t);
  await request("/api/admin/institutions/college-a/partnership",{method:"PUT",body:JSON.stringify({
    aisheCode:"U-1234",officialWebsite:"https://college.example",officialEmailDomain:"college.example",
    address:"Example Road",representativeName:"Principal Test",representativeEmail:"principal@college.example",
    agreementReference:"AGR-2026-001",paymentReference:"UTR-TEST-123456",paymentAmountPaise:250000,connectionMode:"api"
  })});
  for(const [checkType,evidenceReference] of [
    ["institution_identity","AISHE-RECORD-001"],
    ["representative_authority","OFFICIAL-AUTHORITY-001"],
    ["partnership_agreement","SIGNED-MOU-001"],
    ["subscription_payment","BANK-UTR-001"]
  ]){
    const response=await request("/api/admin/institutions/college-a/partnership/checks",{method:"POST",body:JSON.stringify({checkType,outcome:"verified",evidenceReference})});
    assert.equal(response.status,200);
  }
  const response=await request("/api/admin/institutions/college-a/partnership/checks",{method:"POST",body:JSON.stringify({
    checkType:"technical_connection",outcome:"verified",evidenceReference:"API-CLAIM-001"
  })});
  assert.equal(response.status,409);
  assert.match((await response.json()).message,/real authenticated integration handshake/i);
});


test("verified Razorpay fee webhook settles the exact invoice balance idempotently",async t=>{
  const {database,request}=await setup(t);
  const previousSecret=process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET="fee-webhook-secret";
  t.after(()=>{if(previousSecret===undefined)delete process.env.RAZORPAY_WEBHOOK_SECRET;else process.env.RAZORPAY_WEBHOOK_SECRET=previousSecret;});
  const ts=new Date().toISOString();
  database.prepare("INSERT INTO institution_fee_invoices(id,institution_id,student_user_id,fee_head,amount_paise,status,created_by,created_at,updated_at) VALUES('invoice-fee-1','college-a','student','Tuition',150000,'unpaid','college-admin',?,?)").run(ts,ts);
  database.prepare("INSERT INTO institution_fee_payment_links(id,institution_id,invoice_id,student_user_id,provider_link_id,amount_paise,short_url,created_by,created_at) VALUES('fee-link-row','college-a','invoice-fee-1','student','plink_fee_001',150000,'https://rzp.io/fee','college-admin',?)").run(ts);
  const payload={event:"payment_link.paid",payload:{payment_link:{entity:{id:"plink_fee_001",amount_paid:150000,currency:"INR"}},payment:{entity:{id:"pay_fee_001"}}}};
  const raw=JSON.stringify(payload),signature=(await import("node:crypto")).createHmac("sha256","fee-webhook-secret").update(raw).digest("hex");
  let response=await request("/api/webhooks/razorpay",{method:"POST",body:raw,headers:{"x-razorpay-signature":signature,"x-razorpay-event-id":"evt_fee_paid_001"}});
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.kind,"fee_payment");
  assert.equal(database.prepare("SELECT status FROM institution_fee_invoices WHERE id='invoice-fee-1'").get().status,"paid");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_fee_payments WHERE invoice_id='invoice-fee-1'").get().n,1);
  response=await request("/api/webhooks/razorpay",{method:"POST",body:raw,headers:{"x-razorpay-signature":signature,"x-razorpay-event-id":"evt_fee_paid_001"}});
  assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_fee_payments WHERE invoice_id='invoice-fee-1'").get().n,1);
});


test("student can request a Razorpay payment link only for their own exact outstanding invoice balance",async t=>{
  const {database,request}=await setup(t);
  const previousId=process.env.RAZORPAY_KEY_ID,previousSecret=process.env.RAZORPAY_KEY_SECRET,originalFetch=globalThis.fetch;
  process.env.RAZORPAY_KEY_ID="rzp_test_key";process.env.RAZORPAY_KEY_SECRET="test-secret";
  globalThis.fetch=async(url,options)=>String(url).includes("api.razorpay.com")?new Response(JSON.stringify({id:"plink_fee_create_001",short_url:"https://rzp.io/i/fee001"}),{status:200,headers:{"content-type":"application/json"}}):originalFetch(url,options);
  t.after(()=>{globalThis.fetch=originalFetch;if(previousId===undefined)delete process.env.RAZORPAY_KEY_ID;else process.env.RAZORPAY_KEY_ID=previousId;if(previousSecret===undefined)delete process.env.RAZORPAY_KEY_SECRET;else process.env.RAZORPAY_KEY_SECRET=previousSecret;});
  const ts=new Date().toISOString();
  database.prepare("INSERT INTO institution_fee_invoices(id,institution_id,student_user_id,fee_head,amount_paise,status,created_by,created_at,updated_at) VALUES('invoice-owned','college-a','student','Tuition',90000,'unpaid','college-admin',?,?)").run(ts,ts);
  let response=await request("/api/institutions/college-a/finance/invoices/invoice-owned/payment-link",{method:"POST",headers:{"x-user":"student"},body:"{}"});
  assert.equal(response.status,201);const body=await response.json();assert.equal(body.paymentLink.shortUrl,"https://rzp.io/i/fee001");assert.equal(body.paymentLink.amountPaise,90000);
  response=await request("/api/institutions/college-a/finance/invoices/invoice-owned/payment-link",{method:"POST",headers:{"x-user":"owner"},body:"{}"});
  assert.equal(response.status,403);
});
