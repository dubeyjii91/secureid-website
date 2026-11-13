import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { registerOwnerDeletion } from "../server/owner-deletion.js";

function setup() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE secure_documents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,encrypted_path TEXT NOT NULL);
    CREATE TABLE identity_profiles(user_id TEXT PRIMARY KEY,encrypted_data TEXT);
    CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,actor_user_id TEXT,actor_email TEXT,action TEXT,target_user_id TEXT,target_email TEXT,details_json TEXT,created_at INTEGER);
    INSERT INTO users VALUES('owner-id','owner@example.test','owner',1);
    INSERT INTO users VALUES('user-id','student@example.test','user',2);
    INSERT INTO sessions VALUES('session-user','user-id');
    INSERT INTO identity_profiles VALUES('user-id','encrypted');
  `);
  const routes = new Map();
  const app = {
    get: (route, ...handlers) => routes.set("GET " + route, handlers),
    delete: (route, ...handlers) => routes.set("DELETE " + route, handlers),
    post: (route, ...handlers) => routes.set("POST " + route, handlers)
  };
  const pass = (_req,_res,next) => next();
  process.env.OWNER_EMAIL = "owner@example.test";
  registerOwnerDeletion({ app, database, requireAuth:pass, requireMfa:pass, requireOwner:pass, enforceSameOrigin:pass, logEvent:()=>{}, runEncryptedBackup:()=>({file:"/tmp/fresh.backup.json",bytes:10}) });
  return { database, routes };
}

function response() {
  return {
    statusCode:200, headers:{}, body:null,
    setHeader(name,value){ this.headers[name]=value; return this; },
    status(code){ this.statusCode=code; return this; },
    json(value){ this.body=value; return this; }
  };
}

test("configured Owner account is protected even with exact delete confirmations", () => {
  const { database, routes } = setup();
  const handlers = routes.get("DELETE /api/admin/users/:userId");
  const res = response();
  handlers.at(-1)({
    params:{userId:"owner-id"},
    body:{confirmationEmail:"owner@example.test",confirmationPhrase:"DELETE owner@example.test"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"}
  },res);
  assert.equal(res.statusCode,403);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users").get().n,2);
  database.close();
});

test("deletion removes owned rows, revokes sessions and preserves audit evidence", () => {
  const { database, routes } = setup();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),"secureid-owner-delete-"));
  const previousRoot = process.env.DOCUMENT_STORAGE_PATH;
  process.env.DOCUMENT_STORAGE_PATH = temp;
  const documentPath = path.join(temp,"student.json");
  fs.writeFileSync(documentPath,"encrypted");
  database.prepare("INSERT INTO secure_documents VALUES(?,?,?)").run("doc-id","user-id",documentPath);
  const handlers = routes.get("DELETE /api/admin/users/:userId");
  const res = response();
  handlers.at(-1)({
    params:{userId:"user-id"},
    body:{confirmationEmail:"student@example.test",confirmationPhrase:"DELETE student@example.test"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"}
  },res);
  assert.equal(res.statusCode,200);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='user-id'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='user-id'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM identity_profiles WHERE user_id='user-id'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='USER_PERMANENTLY_DELETED'").get().n,1);
  assert.equal(fs.existsSync(documentPath),false);
  if (previousRoot === undefined) delete process.env.DOCUMENT_STORAGE_PATH;
  else process.env.DOCUMENT_STORAGE_PATH = previousRoot;
  fs.rmSync(temp,{recursive:true,force:true});
  database.close();
});

test("individual deletion accepts lowercase DELETE keyword but still requires the exact account email", () => {
  const { database, routes } = setup();
  const handlers = routes.get("DELETE /api/admin/users/:userId");
  const res = response();
  handlers.at(-1)({
    params:{userId:"user-id"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"},
    body:{confirmationEmail:"student@example.test",confirmationPhrase:"delete student@example.test"}
  },res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.deletedEmail,"student@example.test");
  database.close();
});

test("restrictive dependencies block deletion before any data changes", () => {
  const { database, routes } = setup();
  database.exec("CREATE TABLE reviews(id TEXT PRIMARY KEY, reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT); INSERT INTO reviews VALUES('review-1','user-id');");
  const handlers = routes.get("DELETE /api/admin/users/:userId");
  const res = response();
  handlers.at(-1)({
    params:{userId:"user-id"},
    body:{confirmationEmail:"student@example.test",confirmationPhrase:"DELETE student@example.test"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"}
  },res);
  assert.equal(res.statusCode,409);
  assert.equal(res.body.code,"DEPENDENCY_REVIEW_REQUIRED");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='user-id'").get().n,1);
  database.close();
});

test("backup inventory and purge only target encrypted backup artifacts after explicit acknowledgement", () => {
  const { database, routes } = setup();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),"secureid-backup-purge-"));
  const previousDir = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = temp;
  fs.writeFileSync(path.join(temp,"secureid-one.backup.json"),"encrypted");
  fs.writeFileSync(path.join(temp,"keep.txt"),"keep");
  const getHandlers = routes.get("GET /api/admin/backups");
  const preview = response();
  getHandlers.at(-1)({},preview);
  assert.equal(preview.body.totalBackups,1);
  const deleteHandlers = routes.get("DELETE /api/admin/backups");
  const denied = response();
  deleteHandlers.at(-1)({body:{confirmationEmail:"owner@example.test",confirmationPhrase:"DELETE ALL ENCRYPTED BACKUPS"}},denied);
  assert.equal(denied.statusCode,400);
  assert.equal(fs.existsSync(path.join(temp,"secureid-one.backup.json")),true);
  const accepted = response();
  deleteHandlers.at(-1)({body:{confirmationEmail:"owner@example.test",confirmationPhrase:"DELETE ALL ENCRYPTED BACKUPS",recoveryAcknowledged:true}},accepted);
  assert.equal(accepted.statusCode,200);
  assert.equal(accepted.body.remainingBackups,0);
  assert.equal(fs.existsSync(path.join(temp,"keep.txt")),true);
  if (previousDir === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = previousDir;
  fs.rmSync(temp,{recursive:true,force:true});
  database.close();
});

test("Owner can create a fresh encrypted backup through the protected route", () => {
  const { database, routes } = setup();
  const handlers = routes.get("POST /api/admin/backups/create");
  const res = response();
  handlers.at(-1)({user:{id:"owner-id",email:"owner@example.test",role:"owner"}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.fileName,"fresh.backup.json");
  database.close();
});
