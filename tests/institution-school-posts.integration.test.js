import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionSchoolPosts } from "../server/institution-school-posts.js";

async function setup(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
    INSERT INTO users VALUES('admin','admin@test'),('student','student@test'),('reviewer','teacher@test'),('other-admin','other@test');
    INSERT INTO institutions VALUES('school','Example School'),('other-school','Other School');
    INSERT INTO institution_subscriptions VALUES('school','["homework","notices"]','active'),('other-school','["homework","notices"]','active');
    INSERT INTO institution_memberships VALUES('a','school','admin','institution_admin','active'),('s','school','student','student','active'),('r','school','reviewer','reviewer','active'),('oa','other-school','other-admin','institution_admin','active');
  `);
  const app = express();
  app.use(express.json());
  app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
  const auth=(req,res,next)=>req.user.id?next():res.status(401).end(), pass=(req,res,next)=>next();
  const membership=(userId,institutionId)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(userId,institutionId)||null;
  const feature=(institutionId,key)=>{const row=db.prepare("SELECT features_json,status FROM institution_subscriptions WHERE institution_id=?").get(institutionId);return row?.status==="active"&&JSON.parse(row.features_json).includes(key);};
  registerInstitutionSchoolPosts({app,database:db,requireAuth:auth,requireMfaProduction:pass,enforceSameOrigin:pass,getInstitutionMembership:membership,hasInstitutionFeature:feature});
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const request=(user,path,options={})=>fetch("http://127.0.0.1:"+server.address().port+path,{...options,headers:{"content-type":"application/json","x-user":user,...(options.headers||{})}});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  return {db,request};
}

test("school admin creates homework and notices; students and teachers see only their audience",async t=>{
  const {db,request}=await setup(t);
  let response=await request("admin","/api/institutions/school/school-posts",{method:"POST",body:JSON.stringify({type:"homework",title:"Math worksheet",subject:"Mathematics",classLabel:"Class 3-A",body:"Complete exercises 1 to 5 in your notebook.",dueAt:"2026-12-01T12:00:00.000Z",audience:"students"})});
  assert.equal(response.status,201);const homework=(await response.json()).post;assert.equal(homework.classLabel,"Class 3-A");
  response=await request("admin","/api/institutions/school/school-posts",{method:"POST",body:JSON.stringify({type:"notice",title:"Staff meeting",body:"All teachers attend the meeting at 2 PM.",audience:"staff"})});
  assert.equal(response.status,201);
  response=await request("student","/api/institutions/school/school-posts?type=homework");assert.equal(response.status,200);assert.equal((await response.json()).posts.length,1);
  response=await request("student","/api/institutions/school/school-posts?type=notice");assert.equal((await response.json()).posts.length,0);
  response=await request("reviewer","/api/institutions/school/school-posts?type=notice");assert.equal((await response.json()).posts.length,1);
  response=await request("student","/api/institutions/school/school-posts",{method:"POST",body:JSON.stringify({type:"notice",title:"Unsafe",body:"Student cannot publish a notice."})});assert.equal(response.status,403);
  response=await request("other-admin","/api/institutions/school/school-posts?type=homework");assert.equal(response.status,403);
  response=await request("admin",`/api/institutions/school/school-posts/${homework.id}`,{method:"PATCH",body:JSON.stringify({status:"archived"})});assert.equal(response.status,200);
  response=await request("student","/api/institutions/school/school-posts?type=homework");assert.equal((await response.json()).posts.length,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM institution_school_posts_audit WHERE institution_id='school'").get().n,3);
});

test("school communications require enabled entitlements and valid homework deadlines",async t=>{
  const {db,request}=await setup(t);
  let response=await request("admin","/api/institutions/school/school-posts",{method:"POST",body:JSON.stringify({type:"homework",title:"No due date",body:"Instructions without deadline"})});
  assert.equal(response.status,400);
  db.prepare("UPDATE institution_subscriptions SET features_json='[]' WHERE institution_id='school'").run();
  response=await request("admin","/api/institutions/school/school-posts?type=notice");assert.equal(response.status,403);
});
