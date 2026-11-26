import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {DatabaseSync} from "node:sqlite";
import {registerSmartFill} from "../server/smartfill.js";
test("SmartFill requires consent, limits suggestions to consented stable keys and audits no values",async t=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE identity_profiles(user_id TEXT PRIMARY KEY,encrypted_data TEXT,updated_at INTEGER);CREATE TABLE wallet_settings(user_id TEXT PRIMARY KEY,locked INTEGER DEFAULT 0);INSERT INTO identity_profiles VALUES('u1','{\\"name\\":\\"Private Test\\",\\"email\\":\\"test@example.test\\"}',1)");
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:req.get("x-mfa")!=="false"};next();});const auth=(req,res,next)=>req.user.id?next():res.sendStatus(401);
 registerSmartFill({app,database:db,requireAuth:auth,enforceSameOrigin:(req,res,next)=>next(),encryptValue:x=>x,decryptValue:x=>x,assertWalletUnlocked:()=>{}});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 const base=`http://127.0.0.1:${server.address().port}`,headers={"x-user":"u1","content-type":"application/json"};
 assert.equal((await fetch(base+"/api/smartfill/suggestions?formId=admission",{headers})).status,403);
 const grant=await fetch(base+"/api/smartfill/consent",{method:"POST",headers,body:JSON.stringify({formId:"admission",fields:["personal.full_name"],sources:["identity"],consent:true})});assert.equal(grant.status,200);
 const result=await (await fetch(base+"/api/smartfill/suggestions?formId=admission",{headers})).json();assert.deepEqual(result.suggestions.map(x=>x.fieldKey),["personal.full_name"]);assert.equal(result.suggestions[0].status,"unverified");
 const audit=JSON.stringify(db.prepare("SELECT * FROM smartfill_audit").all());assert.equal(audit.includes("Private Test"),false);
 assert.equal((await fetch(base+"/api/smartfill/schema",{headers:{"x-user":"u1","x-mfa":"false"}})).status,403);
});
