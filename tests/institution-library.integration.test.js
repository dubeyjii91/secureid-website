import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionLibrary } from "../server/institution-library.js";

async function setup(t){
 const db=new DatabaseSync(":memory:");
 db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
  CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL);
  CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,features_json TEXT,status TEXT);
  CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT,user_id TEXT,role TEXT,status TEXT);
  INSERT INTO users VALUES('admin','admin@test'),('librarian','librarian@test'),('student-a','a@test'),('student-b','b@test'),('outsider','outside@test');
  INSERT INTO institutions VALUES('college-a','College A'),('college-b','College B');
  INSERT INTO institution_subscriptions VALUES('college-a','["library"]','active'),('college-b','["library"]','active');
  INSERT INTO institution_memberships VALUES('m1','college-a','admin','institution_admin','active'),('m2','college-a','librarian','reviewer','active'),('m3','college-a','student-a','student','active'),('m4','college-a','student-b','student','active'),('m5','college-b','outsider','institution_admin','active');
 `);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.get("x-user")||"",mfaVerified:true};next();});
 const auth=(req,res,next)=>req.user.id?next():res.status(401).end(),mfa=(req,res,next)=>next(),origin=(req,res,next)=>next();
 const membership=(u,i)=>db.prepare("SELECT role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(u,i)||null;
 const feature=(i,f)=>db.prepare("SELECT features_json FROM institution_subscriptions WHERE institution_id=? AND status='active'").get(i)?.features_json?.includes('"'+f+'"')||false;
 registerInstitutionLibrary({app,database:db,requireAuth:auth,requireMfaProduction:mfa,enforceSameOrigin:origin,getInstitutionMembership:membership,hasInstitutionFeature:feature});
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const request=(user,path,options={})=>fetch("http://127.0.0.1:"+server.address().port+path,{...options,headers:{"content-type":"application/json","x-user":user,...(options.headers||{})}});
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 return {db,request};
}
test("library catalogue, issue and return persist inventory and late fee",async t=>{
 const {db,request}=await setup(t);
 let r=await request("admin","/api/institutions/college-a/library/books",{method:"POST",body:JSON.stringify({accessionNumber:"ACC-001",title:"Database Systems",author:"A. Author",totalCopies:1})});
 assert.equal(r.status,201);const book=(await r.json()).book;
 r=await request("librarian","/api/institutions/college-a/library/loans",{method:"POST",body:JSON.stringify({bookId:book.id,studentUserId:"student-a",loanDays:1})});
 assert.equal(r.status,201);const loan=(await r.json()).loan;
 assert.equal(db.prepare("SELECT available_copies FROM institution_library_books WHERE id=?").get(book.id).available_copies,0);
 r=await request("librarian","/api/institutions/college-a/library/loans",{method:"POST",body:JSON.stringify({bookId:book.id,studentUserId:"student-b"})});
 assert.equal(r.status,409);
 db.prepare("UPDATE institution_library_loans SET due_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",loan.id);
 r=await request("librarian",`/api/institutions/college-a/library/loans/${loan.id}/return`,{method:"POST",body:"{}"});
 assert.equal(r.status,200);const returned=await r.json();assert.ok(returned.finePaise>0);
 assert.equal(db.prepare("SELECT available_copies FROM institution_library_books WHERE id=?").get(book.id).available_copies,1);
 assert.equal(db.prepare("SELECT status FROM institution_library_loans WHERE id=?").get(loan.id).status,"returned");
});
test("library roles and institution boundaries are enforced; duplicate accession is rejected",async t=>{
 const {request}=await setup(t);
 const payload=JSON.stringify({accessionNumber:"ACC-002",title:"Networks",author:"B. Author",totalCopies:2});
 let r=await request("admin","/api/institutions/college-a/library/books",{method:"POST",body:payload});assert.equal(r.status,201);
 r=await request("admin","/api/institutions/college-a/library/books",{method:"POST",body:payload});assert.equal(r.status,409);
 r=await request("outsider","/api/institutions/college-a/library");assert.equal(r.status,403);
 r=await request("student-a","/api/institutions/college-a/library/books",{method:"POST",body:payload});assert.equal(r.status,403);
});
test("students can reserve unavailable titles but cannot reserve available copies",async t=>{
 const {request}=await setup(t);
 let r=await request("admin","/api/institutions/college-a/library/books",{method:"POST",body:JSON.stringify({accessionNumber:"ACC-003",title:"Algorithms",author:"C. Author",totalCopies:1})});
 const book=(await r.json()).book;
 r=await request("librarian","/api/institutions/college-a/library/loans",{method:"POST",body:JSON.stringify({bookId:book.id,studentUserId:"student-b"})});assert.equal(r.status,201);
 r=await request("student-a","/api/institutions/college-a/library/reservations",{method:"POST",body:JSON.stringify({bookId:book.id})});assert.equal(r.status,201);
 r=await request("student-a","/api/institutions/college-a/library/reservations",{method:"POST",body:JSON.stringify({bookId:book.id})});assert.equal(r.status,409);
});
