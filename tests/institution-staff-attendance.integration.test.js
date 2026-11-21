import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { registerInstitutionModules } from "../server/institution-modules.js";

test("staff QR attendance is institution-scoped, short-lived, camera-token-only, and rejects repeats", async (t) => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE institution_subscriptions(institution_id TEXT PRIMARY KEY,plan_key TEXT,status TEXT,features_json TEXT,starts_at TEXT,ends_at TEXT,updated_at TEXT);
    CREATE TABLE institution_memberships(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE institution_staff_attendance(id TEXT PRIMARY KEY,institution_id TEXT,staff_id TEXT,checked_in_at TEXT);
    INSERT INTO users VALUES('teacher-a','teacher@example.test'),('admin-a','admin@example.test'),('student-a','student@example.test'),('teacher-b','other@example.test');
    INSERT INTO institutions VALUES('college-a','Example College','2026-01-01'),('college-b','Other College','2026-01-01');
    INSERT INTO institution_memberships VALUES('member-teacher-a','college-a','teacher-a','reviewer','active');
    INSERT INTO institution_memberships VALUES('member-admin-a','college-a','admin-a','institution_admin','active');
    INSERT INTO institution_memberships VALUES('member-student-a','college-a','student-a','student','active');
    INSERT INTO institution_memberships VALUES('member-teacher-b','college-b','teacher-b','reviewer','active');
    INSERT INTO institution_staff_attendance VALUES('legacy-attendance','college-a','legacy-staff','2025-01-01T00:00:00.000Z');
  `);
  const app = express();
  app.use(express.json());
  app.use((req,res,_next) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({success:false});
    req.user = {id,mfaVerified:req.get("x-test-mfa") !== "false"};
    _next();
  });
  const getInstitutionMembership = (userId,institutionId) => database.prepare("SELECT id,institution_id AS institutionId,user_id AS userId,role,status FROM institution_memberships WHERE user_id=? AND institution_id=?").get(userId,institutionId);
  registerInstitutionModules({
    app,database,
    requireAuth:(req,res,next) => next(),
    requireMfaProduction:(req,res,next) => req.user.mfaVerified ? next() : res.status(403).json({success:false,message:"MFA verification is required."}),
    enforceSameOrigin:(req,res,next) => next(),
    getInstitutionMembership,
    hasInstitutionFeature:() => true,
  });
  assert.equal(database.prepare("SELECT staff_id FROM institution_staff_attendance_legacy WHERE id='legacy-attendance'").get().staff_id,"legacy-staff");
  assert.deepEqual(database.prepare("PRAGMA table_info(institution_staff_attendance)").all().map(column => column.name),[
    "id","institution_id","session_id","user_id","challenge_id","checked_in_at"
  ]);
  app.use((error,req,res,_next) => res.status(500).json({success:false,message:error.message}));
  const server = app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); database.close(); });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (user,mfa=true) => ({"Content-Type":"application/json","x-test-user":user,"x-test-mfa":String(mfa)});
  const post = (path,user,body={},mfa=true) => fetch(base+path,{method:"POST",headers:headers(user,mfa),body:JSON.stringify(body)});
  const start = await post("/api/institutions/college-a/attendance/sessions","teacher-a",{title:"Morning attendance"});
  assert.equal(start.status,201,await start.clone().text());
  const session = (await start.json()).session;

  const studentStart = await post("/api/institutions/college-a/attendance/sessions","student-a",{title:"Not allowed"});
  assert.equal(studentStart.status,403);
  const noMfaStart = await post("/api/institutions/college-a/attendance/sessions","teacher-a",{title:"No MFA"},false);
  assert.equal(noMfaStart.status,403);

  const rotate = () => post(`/api/institutions/college-a/attendance/sessions/${session.id}/qr`,"teacher-a");
  const firstResponse = await rotate();
  assert.equal(firstResponse.status,200,await firstResponse.clone().text());
  const firstChallenge = (await firstResponse.json()).challenge;
  assert.match(firstChallenge.qrValue,/^secureid:\/\/attendance\/[A-Za-z0-9_-]{40,64}$/);
  assert.match(firstChallenge.qrCodeDataUrl,/^data:image\/png;base64,/);
  const rawToken = firstChallenge.qrValue.split("/").at(-1);
  const storedChallenge = database.prepare("SELECT token_hash FROM institution_attendance_qr_challenges WHERE session_id=?").get(session.id);
  assert.ok(storedChallenge.token_hash);
  assert.equal(storedChallenge.token_hash.includes(rawToken),false);
  assert.equal((await rotate()).status,429,"QR refresh requests must respect the server cooldown");

  const studentCheckIn = await post("/api/institutions/attendance/check-in","student-a",{qrValue:firstChallenge.qrValue});
  assert.equal(studentCheckIn.status,403);
  const otherCollegeCheckIn = await post("/api/institutions/attendance/check-in","teacher-b",{qrValue:firstChallenge.qrValue});
  assert.equal(otherCollegeCheckIn.status,403);
  const malformed = await post("/api/institutions/attendance/check-in","teacher-a",{qrValue:"https://example.test/qr.png"});
  assert.equal(malformed.status,400);

  database.prepare("UPDATE institution_attendance_qr_challenges SET created_at=? WHERE session_id=?")
    .run(new Date(Date.now()-10_000).toISOString(),session.id);
  const secondChallenge = (await (await rotate()).json()).challenge;
  const oldCodeCheckIn = await post("/api/institutions/attendance/check-in","teacher-a",{qrValue:firstChallenge.qrValue});
  assert.equal(oldCodeCheckIn.status,410);
  const checkIn = await post("/api/institutions/attendance/check-in","teacher-a",{qrValue:secondChallenge.qrValue});
  assert.equal(checkIn.status,201,await checkIn.clone().text());
  assert.equal((await checkIn.json()).attendance.sessionTitle,"Morning attendance");
  const repeated = await post("/api/institutions/attendance/check-in","teacher-a",{qrValue:secondChallenge.qrValue});
  assert.equal(repeated.status,409);

  const expiringSessionResponse = await post("/api/institutions/college-a/attendance/sessions","teacher-a",{title:"Expiry check"});
  const expiringSession = (await expiringSessionResponse.json()).session;
  const expiringChallenge = (await (await post(`/api/institutions/college-a/attendance/sessions/${expiringSession.id}/qr`,"teacher-a")).json()).challenge;
  const expiringToken = expiringChallenge.qrValue.split("/").at(-1);
  const expiringHash = (await import("node:crypto")).createHash("sha256").update(expiringToken).digest("hex");
  database.prepare("UPDATE institution_attendance_qr_challenges SET expires_at=? WHERE token_hash=?").run(new Date(Date.now()-1000).toISOString(),expiringHash);
  const expiredCheckIn = await post("/api/institutions/attendance/check-in","teacher-a",{qrValue:expiringChallenge.qrValue});
  assert.equal(expiredCheckIn.status,410);

  const myAttendance = await fetch(base+"/api/institutions/college-a/attendance/my",{headers:headers("teacher-a")});
  assert.equal(myAttendance.status,200);
  assert.equal((await myAttendance.json()).attendance.length,1);
  const records = await fetch(base+`/api/institutions/college-a/attendance/sessions/${session.id}/records`,{headers:headers("admin-a")});
  assert.equal(records.status,200);
  assert.equal((await records.json()).records[0].email,"teacher@example.test");

  const close = await post(`/api/institutions/college-a/attendance/sessions/${session.id}/close`,"teacher-a");
  assert.equal(close.status,200);
  const closedCode = await post("/api/institutions/attendance/check-in","admin-a",{qrValue:secondChallenge.qrValue});
  assert.equal(closedCode.status,410);
});

test("native attendance scanner only consumes live camera QR values and has no gallery picker", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../mobile/app/attendance.tsx",import.meta.url),"utf8");
  assert.match(source,/CameraView/);
  assert.match(source,/barcodeTypes:\["qr"\]/);
  assert.match(source,/onBarcodeScanned=/);
  assert.match(source,/secureid:\\\/\\\/attendance/);
  assert.doesNotMatch(source,/expo-image-picker|launchImageLibrary|expo-document-picker|DocumentPicker/);
});
