import crypto from "node:crypto";
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),clean=(v,n=300)=>String(v??"").trim().slice(0,n),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fail=(res,s,m)=>res.status(s).json({success:false,message:m});
export function registerInstitutionCertificates({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 database.exec(`
 CREATE TABLE IF NOT EXISTS institution_certificate_requests(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES users(id),certificate_type TEXT NOT NULL CHECK(certificate_type IN ('bonafide','character','transfer','fee_clearance')),
  student_name TEXT NOT NULL,student_number TEXT NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','issued')),
  requested_at TEXT NOT NULL,updated_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id),review_note TEXT
 );
 CREATE TABLE IF NOT EXISTS institution_certificates(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE REFERENCES institution_certificate_requests(id),student_user_id TEXT NOT NULL REFERENCES users(id),
  certificate_type TEXT NOT NULL,serial_number TEXT NOT NULL UNIQUE,verification_token_hash TEXT NOT NULL UNIQUE,
  student_name TEXT NOT NULL,student_number TEXT NOT NULL,purpose TEXT NOT NULL,issued_by TEXT NOT NULL REFERENCES users(id),
  issued_at TEXT NOT NULL,revoked_at TEXT,revocation_reason TEXT
 );
 CREATE INDEX IF NOT EXISTS idx_cert_requests_queue ON institution_certificate_requests(institution_id,status,requested_at);
 `);
 function member(req,res,i,roles){const m=getInstitutionMembership(req.user.id,i);if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this certificate action.");return null;}if(!hasInstitutionFeature(i,"student_management")){fail(res,403,"Student services are not enabled.");return null;}return m;}
 function typeName(t){return ({bonafide:"Bonafide Certificate",character:"Character Certificate",transfer:"Transfer Certificate",fee_clearance:"Fee Clearance Certificate"})[t]||"Certificate";}
 app.get("/api/institutions/:institutionId/certificates",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),m=member(req,res,i,["institution_admin","reviewer","read_only","student"]);if(!m)return;
  const rows=database.prepare(`SELECT r.id,r.student_user_id AS studentUserId,u.email AS studentEmail,r.certificate_type AS certificateType,r.student_name AS studentName,r.student_number AS studentNumber,r.purpose,r.status,r.requested_at AS requestedAt,r.review_note AS reviewNote,c.id AS certificateId,c.serial_number AS serialNumber,c.issued_at AS issuedAt,c.revoked_at AS revokedAt FROM institution_certificate_requests r JOIN users u ON u.id=r.student_user_id LEFT JOIN institution_certificates c ON c.request_id=r.id WHERE r.institution_id=? ${m.role==="student"?"AND r.student_user_id=?":""} ORDER BY r.requested_at DESC LIMIT 300`).all(...(m.role==="student"?[i,req.user.id]:[i]));
  res.setHeader("Cache-Control","private, no-store");return res.json({success:true,requests:rows});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/certificates",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128);if(!member(req,res,i,["student"]))return;
  const type=clean(req.body?.certificateType,30),name=clean(req.body?.studentName,120),number=clean(req.body?.studentNumber,60),purpose=clean(req.body?.purpose,300);
  if(!["bonafide","character","transfer","fee_clearance"].includes(type)||name.length<2||number.length<2||purpose.length<5)return fail(res,400,"Enter a valid certificate type, student name, student number and purpose.");
  const requestId=id(),ts=now();database.prepare("INSERT INTO institution_certificate_requests(id,institution_id,student_user_id,certificate_type,student_name,student_number,purpose,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(requestId,i,req.user.id,type,name,number,purpose,ts,ts);
  return res.status(201).json({success:true,request:{id:requestId,certificateType:type,status:"pending",requestedAt:ts}});
 }catch(e){next(e);}});
 app.patch("/api/institutions/:institutionId/certificates/:requestId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),requestId=clean(req.params.requestId,128);if(!member(req,res,i,["institution_admin","reviewer"]))return;
  const status=clean(req.body?.status,20),note=clean(req.body?.reviewNote,1000);if(!["approved","rejected"].includes(status))return fail(res,400,"Choose approve or reject.");if(status==="rejected"&&note.length<5)return fail(res,400,"Add a reason for rejection.");
  const row=database.prepare("SELECT status FROM institution_certificate_requests WHERE id=? AND institution_id=?").get(requestId,i);if(!row)return fail(res,404,"Certificate request not found.");if(row.status!=="pending")return fail(res,409,"Only pending requests can be reviewed.");
  const ts=now();database.prepare("UPDATE institution_certificate_requests SET status=?,updated_at=?,reviewed_by=?,review_note=? WHERE id=? AND institution_id=? AND status='pending'").run(status,ts,req.user.id,note||null,requestId,i);
  return res.json({success:true,status});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/certificates/:requestId/issue",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),requestId=clean(req.params.requestId,128);if(!member(req,res,i,["institution_admin"]))return;
  const row=database.prepare("SELECT * FROM institution_certificate_requests WHERE id=? AND institution_id=?").get(requestId,i);if(!row)return fail(res,404,"Certificate request not found.");if(row.status!=="approved")return fail(res,409,"Only an approved request can be issued.");
  const institution=database.prepare("SELECT name FROM institutions WHERE id=?").get(i);const ts=now(),serial="SID-"+new Date().getUTCFullYear()+"-"+crypto.randomBytes(5).toString("hex").toUpperCase(),token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex"),certificateId=id();
  database.exec("BEGIN IMMEDIATE");try{
   const changed=database.prepare("UPDATE institution_certificate_requests SET status='issued',updated_at=? WHERE id=? AND institution_id=? AND status='approved'").run(ts,requestId,i);if(!changed.changes){database.exec("ROLLBACK");return fail(res,409,"Request status changed; reload before issuing.");}
   database.prepare("INSERT INTO institution_certificates(id,institution_id,request_id,student_user_id,certificate_type,serial_number,verification_token_hash,student_name,student_number,purpose,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(certificateId,i,requestId,row.student_user_id,row.certificate_type,serial,hash,row.student_name,row.student_number,row.purpose,req.user.id,ts);
   database.exec("COMMIT");
  }catch(e){try{database.exec("ROLLBACK");}catch{}throw e;}
  return res.status(201).json({success:true,certificate:{id:certificateId,serialNumber:serial,verificationToken:token,verificationPath:"/api/certificates/verify/"+token,issuedAt:ts,institutionName:institution?.name}});
 }catch(e){next(e);}});
 app.get("/api/institutions/:institutionId/certificates/:certificateId/document",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),certificateId=clean(req.params.certificateId,128),m=member(req,res,i,["institution_admin","reviewer","read_only","student"]);if(!m)return;
  const row=database.prepare("SELECT c.*,i.name AS institutionName FROM institution_certificates c JOIN institutions i ON i.id=c.institution_id WHERE c.id=? AND c.institution_id=?").get(certificateId,i);if(!row)return fail(res,404,"Certificate not found.");if(m.role==="student"&&row.student_user_id!==req.user.id)return fail(res,403,"You cannot access another student's certificate.");if(row.revoked_at)return fail(res,410,"This certificate has been revoked.");
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(typeName(row.certificate_type))} · ${esc(row.serial_number)}</title><style>body{font-family:Georgia,serif;margin:0;background:#f3f4f6;color:#18202b}.sheet{max-width:850px;margin:40px auto;padding:64px;border:10px double #263b57;background:white;min-height:520px;text-align:center}.eyebrow{letter-spacing:3px;color:#596b82}.name{font-size:30px;font-weight:bold;margin:30px}.meta{margin-top:60px;display:flex;justify-content:space-between;font:14px Arial}.seal{border:1px solid #9aa8b7;border-radius:50%;padding:18px;display:inline-block;margin-top:28px}@media print{body{background:white}.sheet{margin:0;max-width:none;min-height:90vh;box-shadow:none}}</style></head><body><main class="sheet"><p class="eyebrow">${esc(row.institutionName)}</p><h1>${esc(typeName(row.certificate_type))}</h1><p>This is to certify that</p><div class="name">${esc(row.student_name)}</div><p>Student number <strong>${esc(row.student_number)}</strong></p><p>${esc(row.purpose)}</p><p class="seal">Institutionally issued record<br><small>SecureID verification enabled</small></p><div class="meta"><span>Serial: ${esc(row.serial_number)}</span><span>Issued: ${esc(new Date(row.issued_at).toLocaleDateString("en-IN"))}</span></div><p style="margin-top:35px;font:12px Arial">Verify this certificate using its serial number and institution-issued verification link.</p></main><script>window.print()</script></body></html>`;
  res.setHeader("Cache-Control","private, no-store");res.type("html").send(html);
 }catch(e){next(e);}});
 app.get("/api/certificates/verify/:token",(req,res,next)=>{try{
  const token=clean(req.params.token,100),hash=crypto.createHash("sha256").update(token).digest("hex");
  const row=database.prepare("SELECT c.serial_number AS serialNumber,c.certificate_type AS certificateType,c.issued_at AS issuedAt,c.revoked_at AS revokedAt,i.name AS institutionName FROM institution_certificates c JOIN institutions i ON i.id=c.institution_id WHERE c.verification_token_hash=?").get(hash);
  if(!row)return fail(res,404,"Certificate verification record was not found.");
  res.setHeader("Cache-Control","no-store");return res.json({success:true,valid:!row.revokedAt,serialNumber:row.serialNumber,certificateType:typeName(row.certificateType),institutionName:row.institutionName,issuedAt:row.issuedAt,revoked:!!row.revokedAt});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/certificates/:certificateId/revoke",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),cid=clean(req.params.certificateId,128);if(!member(req,res,i,["institution_admin"]))return;
  const reason=clean(req.body?.reason,500);if(reason.length<5)return fail(res,400,"A revocation reason is required.");
  const changed=database.prepare("UPDATE institution_certificates SET revoked_at=?,revocation_reason=? WHERE id=? AND institution_id=? AND revoked_at IS NULL").run(now(),reason,cid,i);if(!changed.changes)return fail(res,404,"Active certificate not found.");return res.json({success:true,revoked:true});
 }catch(e){next(e);}});
}
