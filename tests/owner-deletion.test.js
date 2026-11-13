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


test("owner deletion clears only the target account's three restrictive audit dependencies", () => {
  const { database, routes } = setup();
  database.exec(`
    CREATE TABLE institutions(id TEXT PRIMARY KEY);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE institution_review_submissions(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),student_user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE institution_review_audit(id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES institution_review_submissions(id),institution_id TEXT NOT NULL REFERENCES institutions(id),actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,from_status TEXT,to_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE institution_membership_audit(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),membership_id TEXT NOT NULL REFERENCES institution_memberships(id),actor_user_id TEXT NOT NULL REFERENCES users(id),target_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,from_role TEXT,to_role TEXT,from_status TEXT,to_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE scholarship_applications(id TEXT PRIMARY KEY,student_user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE scholarship_audit(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES scholarship_applications(id),institution_id TEXT NOT NULL REFERENCES institutions(id),actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,from_status TEXT,to_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE hostel_applications(id TEXT PRIMARY KEY,student_user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE hostel_application_audit(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES hostel_applications(id),institution_id TEXT NOT NULL REFERENCES institutions(id),actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,from_status TEXT,to_status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE hostel_operations_audit(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),application_id TEXT NOT NULL REFERENCES hostel_applications(id),actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL);
    CREATE TABLE institution_admission_requests(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),student_user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE institution_admission_audit(id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES institution_admission_requests(id) ON DELETE CASCADE,institution_id TEXT NOT NULL REFERENCES institutions(id),actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE scholarship_document_access_audit(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES scholarship_applications(id),institution_id TEXT NOT NULL REFERENCES institutions(id),document_id TEXT NOT NULL,actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,outcome TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO institutions VALUES('institution-1');
    INSERT INTO institution_memberships VALUES('membership-1','institution-1','user-id');
    INSERT INTO institution_review_submissions VALUES('submission-1','institution-1','user-id');
    INSERT INTO scholarship_applications VALUES('scholarship-1','user-id');
    INSERT INTO hostel_applications VALUES('hostel-application-1','user-id');
    INSERT INTO hostel_application_audit VALUES('hostel-audit-1','hostel-application-1','institution-1','owner-id','application_reviewed',NULL,NULL,'2026-11-13T00:00:00.000Z');
    INSERT INTO hostel_operations_audit VALUES('hostel-ops-audit-1','institution-1','hostel-application-1','owner-id','reviewed',NULL,'2026-11-13T00:00:00.000Z');
    INSERT INTO institution_admission_requests VALUES('admission-1','institution-1','user-id');
    INSERT INTO institution_admission_audit VALUES('admission-audit-1','admission-1','institution-1','owner-id','reviewed','2026-11-13T00:00:00.000Z');
    INSERT INTO scholarship_document_access_audit VALUES('scholarship-doc-audit-1','scholarship-1','institution-1','doc-1','owner-id','preview','success','2026-11-13T00:00:00.000Z');
  `);
  const insertReview = database.prepare("INSERT INTO institution_review_audit VALUES(?,?,?,?,?,?,?,?)");
  for (let i=0;i<6;i++) insertReview.run("review-audit-"+i,"submission-1","institution-1","user-id","reviewed",null,null,new Date().toISOString());
  const insertMembership = database.prepare("INSERT INTO institution_membership_audit VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  for (let i=0;i<3;i++) insertMembership.run("membership-audit-"+i,"institution-1","membership-1","owner-id","user-id","warden_role_granted",null,"warden","active","active",Date.now());
  const insertScholarship = database.prepare("INSERT INTO scholarship_audit VALUES(?,?,?,?,?,?,?,?)");
  for (let i=0;i<3;i++) insertScholarship.run("scholarship-audit-"+i,"scholarship-1","institution-1","user-id","reviewed",null,null,new Date().toISOString());

  const previewHandlers = routes.get("GET /api/admin/users/:userId/details");
  const preview = response();
  previewHandlers.at(-1)({params:{userId:"user-id"}},preview);
  assert.equal(preview.statusCode,200);
  assert.equal(preview.body.deletionAllowed,true);
  assert.deepEqual(preview.body.blockers,[]);

  const handlers = routes.get("DELETE /api/admin/users/:userId");
  const res = response();
  handlers.at(-1)({
    params:{userId:"user-id"},
    body:{confirmationEmail:"student@example.test",confirmationPhrase:"DELETE student@example.test"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"}
  },res);

  assert.equal(res.statusCode,200);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='user-id'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_review_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_membership_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM scholarship_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_applications").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_application_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_operations_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_admission_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM scholarship_document_access_audit").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='owner-id'").get().n,1);
  database.close();
});


test("individual deletion removes hostel application descendants but preserves shared room data", () => {
  const { database, routes } = setup();
  database.exec(`
    CREATE TABLE hostel_applications(id TEXT PRIMARY KEY, student_user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE hostel_rooms(id TEXT PRIMARY KEY, room_number TEXT NOT NULL);
    CREATE TABLE hostel_bed_allocations(
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES hostel_applications(id),
      room_id TEXT NOT NULL REFERENCES hostel_rooms(id)
    );
    CREATE TABLE hostel_fee_records(
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES hostel_applications(id),
      allocation_id TEXT NOT NULL REFERENCES hostel_bed_allocations(id)
    );
    CREATE TABLE hostel_fee_payments(
      id TEXT PRIMARY KEY,
      fee_record_id TEXT NOT NULL REFERENCES hostel_fee_records(id)
    );
    INSERT INTO hostel_applications VALUES('hostel-app-1','user-id');
    INSERT INTO hostel_rooms VALUES('shared-room-1','A-101');
    INSERT INTO hostel_bed_allocations VALUES('bed-allocation-1','hostel-app-1','shared-room-1');
    INSERT INTO hostel_fee_records VALUES('hostel-fee-1','hostel-app-1','bed-allocation-1');
    INSERT INTO hostel_fee_payments VALUES('hostel-payment-1','hostel-fee-1');
  `);
  const preview = response();
  routes.get("GET /api/admin/users/:userId/details").at(-1)({params:{userId:"user-id"}},preview);
  assert.equal(preview.statusCode,200);
  assert.equal(preview.body.deletionAllowed,true);
  const res = response();
  routes.get("DELETE /api/admin/users/:userId").at(-1)({
    params:{userId:"user-id"},
    body:{confirmationEmail:"student@example.test",confirmationPhrase:"DELETE student@example.test"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"}
  },res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='user-id'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_applications").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_bed_allocations").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_fee_records").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_fee_payments").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hostel_rooms WHERE id='shared-room-1'").get().n,1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='owner-id'").get().n,1);
  database.close();
});


test("individual deletion removes review submissions and invoice payments before their parents", () => {
  const { database, routes } = setup();
  database.exec(`
    CREATE TABLE institution_review_submissions(
      id TEXT PRIMARY KEY,
      student_user_id TEXT NOT NULL REFERENCES users(id),
      document_id TEXT NOT NULL REFERENCES secure_documents(id)
    );
    CREATE TABLE institution_fee_invoices(
      id TEXT PRIMARY KEY,
      student_user_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE institution_fee_payments(
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES institution_fee_invoices(id),
      student_user_id TEXT NOT NULL REFERENCES users(id)
    );
    INSERT INTO secure_documents VALUES('doc-review-1','user-id','/tmp/nonexistent-encrypted-doc');
    INSERT INTO institution_review_submissions VALUES('review-submission-1','user-id','doc-review-1');
    INSERT INTO institution_fee_invoices VALUES('fee-invoice-1','user-id');
    INSERT INTO institution_fee_payments VALUES('fee-payment-1','fee-invoice-1','user-id');
  `);
  const preview = response();
  routes.get("GET /api/admin/users/:userId/details").at(-1)({params:{userId:"user-id"}},preview);
  assert.equal(preview.statusCode,200);
  assert.equal(preview.body.deletionAllowed,true);
  const res = response();
  routes.get("DELETE /api/admin/users/:userId").at(-1)({
    params:{userId:"user-id"},
    body:{confirmationEmail:"student@example.test",confirmationPhrase:"DELETE student@example.test"},
    user:{id:"owner-id",email:"owner@example.test",role:"owner"}
  },res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_review_submissions").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM secure_documents").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_fee_payments").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_fee_invoices").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='owner-id'").get().n,1);
  database.close();
});

test("fresh-start preview reports category counts and never changes Owner or institution data", () => {
  const { database, routes } = setup();
  database.exec(`
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,user_id TEXT NOT NULL);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,plan_key TEXT);
    CREATE TABLE hostel_applications(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL);
    INSERT INTO institutions VALUES('test-college','SecureID Test College','2026-01-01');
    INSERT INTO institutions VALUES('rvs-college','RVS College of Engineering and Technology','2026-01-02');
    INSERT INTO institution_memberships VALUES('m1','test-college','user-id');
    INSERT INTO institution_subscriptions VALUES('test-college','pilot');
    INSERT INTO hostel_applications VALUES('h1','test-college');
    INSERT INTO institution_memberships VALUES('m2','rvs-college','owner-id');
  `);
  const res = response();
  routes.get("GET /api/admin/fresh-start-preview").at(-1)({},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.nonOwnerAccounts,1);
  assert.equal(res.body.institutions.find(item => item.id === "test-college").testCandidate,true);
  assert.equal(res.body.institutions.find(item => item.id === "test-college").totalRelatedRows,3);
  assert.equal(res.body.institutions.find(item => item.id === "rvs-college").manualReviewRequired,true);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM users WHERE id='owner-id'").get().n,1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institutions").get().n,2);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM institution_memberships").get().n,2);
  database.close();
});
