import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerSecureIdMonetization } from "../server/secureid-monetization.js";

test("SecureID monetization is owner/MFA-only, paise-based, idempotent and keeps sponsorships labelled", async t => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE secure_documents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,size_bytes INTEGER NOT NULL,deleted_at INTEGER);
    INSERT INTO users VALUES('owner','owner@example.test'),('user','user@example.test');
    INSERT INTO institutions VALUES('college-a','College A','2026-01-01');
  `);
  const app = express();
  app.use(express.json());
  app.use((req,res,next) => {
    req.user = { id: req.get("x-user") || "", role: req.get("x-role") || "user", mfaVerified: req.get("x-mfa") !== "false" };
    next();
  });
  const requireAuth = (req,res,next) => req.user.id ? next() : res.status(401).json({success:false});
  const requireMfaProduction = (req,res,next) => req.user.mfaVerified ? next() : res.status(403).json({success:false});
  registerSecureIdMonetization({app,database,requireAuth,requireMfaProduction,enforceSameOrigin:(req,res,next)=>next()});
  app.use((error,req,res,next) => res.status(500).json({success:false,message:error.message}));
  const server = app.listen(0,"127.0.0.1");
  await new Promise(resolve => server.once("listening",resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (role="owner",mfa=true) => ({ "x-user": role === "owner" ? "owner" : "user", "x-role": role, "x-mfa": String(mfa), "content-type": "application/json" });

  const forbidden = await fetch(base + "/api/admin/monetization/overview", {headers:headers("user")});
  assert.equal(forbidden.status,403);
  const noMfa = await fetch(base + "/api/admin/monetization/overview", {headers:headers("owner",false)});
  assert.equal(noMfa.status,403);
  const overview = await fetch(base + "/api/admin/monetization/overview", {headers:headers()});
  assert.equal(overview.status,200);
  const summary = await overview.json();
  assert.equal(summary.livePaymentsEnabled,false);
  assert.equal(summary.billingMode,"manual_ledger_only");
  assert.equal(Object.hasOwn(summary,"plans"),false);

  const payload = {category:"admission_service_fee",status:"pending",amountPaise:15000,institutionId:"college-a",description:"Agreed fee for confirmed admission",reference:"ADM-2026-001",idempotencyKey:"admission-fee-2026-001"};
  const createdResponse = await fetch(base + "/api/admin/monetization/entries",{method:"POST",headers:headers(),body:JSON.stringify(payload)});
  assert.equal(createdResponse.status,201,await createdResponse.clone().text());
  const created = (await createdResponse.json()).entry;
  assert.equal(created.amountPaise,15000);
  assert.equal(created.status,"pending");

  const duplicate = await fetch(base + "/api/admin/monetization/entries",{method:"POST",headers:headers(),body:JSON.stringify(payload)});
  assert.equal(duplicate.status,409);
  const invalid = await fetch(base + "/api/admin/monetization/entries",{method:"POST",headers:headers(),body:JSON.stringify({...payload,amountPaise:1.25,idempotencyKey:"admission-fee-2026-002"})});
  assert.equal(invalid.status,400);

  const paid = await fetch(base + "/api/admin/monetization/entries/"+created.id,{method:"PATCH",headers:headers(),body:JSON.stringify({status:"paid"})});
  assert.equal(paid.status,200);
  const updatedOverview = await (await fetch(base + "/api/admin/monetization/overview",{headers:headers()})).json();
  assert.equal(updatedOverview.totals.paidPaise,15000);

  const sponsor = await fetch(base + "/api/admin/monetization/sponsorships",{method:"POST",headers:headers(),body:JSON.stringify({sponsorName:"Learning Partner",campaignName:"Scholarship Awareness"})});
  assert.equal(sponsor.status,201);
  const sponsorData = (await sponsor.json()).sponsorship;
  assert.equal(sponsorData.placementLabel,"Sponsored");
  assert.equal(sponsorData.status,"draft");
  const sponsorships = await (await fetch(base + "/api/admin/monetization/sponsorships",{headers:headers()})).json();
  assert.equal(sponsorships.sponsorships.length,1);
});
