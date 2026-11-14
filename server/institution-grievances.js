import crypto from "node:crypto";
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),clean=(v,n=300)=>String(v??"").trim().slice(0,n);
const fail=(res,s,m)=>res.status(s).json({success:false,message:m});
export function registerInstitutionGrievances({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 database.exec(`
 CREATE TABLE IF NOT EXISTS institution_grievances(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  ticket_number INTEGER NOT NULL,student_user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,subject TEXT NOT NULL,description TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','resolved','closed','reopened')),
  assigned_to TEXT REFERENCES users(id),sla_due_at TEXT NOT NULL,resolution TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,closed_at TEXT,
  UNIQUE(institution_id,ticket_number)
 );
 CREATE TABLE IF NOT EXISTS institution_grievance_messages(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  grievance_id TEXT NOT NULL REFERENCES institution_grievances(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,internal INTEGER NOT NULL DEFAULT 0 CHECK(internal IN (0,1)),created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS institution_grievance_audit(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  grievance_id TEXT NOT NULL REFERENCES institution_grievances(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_grievances_queue ON institution_grievances(institution_id,status,priority,sla_due_at);
 `);
 function member(req,res,i,roles){const m=getInstitutionMembership(req.user.id,i);if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this grievance action.");return null;}if(!hasInstitutionFeature(i,"student_management")){fail(res,403,"Student services are not enabled.");return null;}return m;}
 function audit(i,g,u,a,d={}){database.prepare("INSERT INTO institution_grievance_audit(id,institution_id,grievance_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(id(),i,g,u,a,JSON.stringify(d),now());}
 app.get("/api/institutions/:institutionId/grievances",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),m=member(req,res,i,["institution_admin","reviewer","read_only","student"]);if(!m)return;
  const rows=database.prepare(`SELECT g.id,g.ticket_number AS ticketNumber,g.student_user_id AS studentUserId,u.email AS studentEmail,g.category,g.subject,g.description,g.priority,g.status,g.assigned_to AS assignedTo,g.sla_due_at AS slaDueAt,g.resolution,g.created_at AS createdAt,g.updated_at AS updatedAt FROM institution_grievances g JOIN users u ON u.id=g.student_user_id WHERE g.institution_id=? ${m.role==="student"?"AND g.student_user_id=?":""} ORDER BY CASE g.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,g.sla_due_at LIMIT 500`).all(...(m.role==="student"?[i,req.user.id]:[i]));
  res.setHeader("Cache-Control","private, no-store");return res.json({success:true,grievances:rows});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/grievances",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128);if(!member(req,res,i,["student"]))return;
  const category=clean(req.body?.category,80),subject=clean(req.body?.subject,160),description=clean(req.body?.description,4000),priority=clean(req.body?.priority||"normal",20);
  if(category.length<2||subject.length<5||description.length<10||!["low","normal","high","urgent"].includes(priority))return fail(res,400,"Enter a category, clear subject, detailed description and valid priority.");
  const slaHours={low:120,normal:72,high:24,urgent:4}[priority],ts=now(),due=new Date(Date.now()+slaHours*3600000).toISOString();
  database.exec("BEGIN IMMEDIATE");try{
   const next=database.prepare("SELECT COALESCE(MAX(ticket_number),0)+1 AS n FROM institution_grievances WHERE institution_id=?").get(i).n,ticketId=id();
   database.prepare("INSERT INTO institution_grievances(id,institution_id,ticket_number,student_user_id,category,subject,description,priority,sla_due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(ticketId,i,next,req.user.id,category,subject,description,priority,due,ts,ts);
   audit(i,ticketId,req.user.id,"grievance_submitted",{category,priority});database.exec("COMMIT");return res.status(201).json({success:true,grievance:{id:ticketId,ticketNumber:next,status:"open",slaDueAt:due}});
  }catch(e){try{database.exec("ROLLBACK");}catch{}throw e;}
 }catch(e){next(e);}});
 app.get("/api/institutions/:institutionId/grievances/:grievanceId/messages",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),g=clean(req.params.grievanceId,128),m=member(req,res,i,["institution_admin","reviewer","read_only","student"]);if(!m)return;
  const row=database.prepare("SELECT student_user_id AS studentUserId FROM institution_grievances WHERE id=? AND institution_id=?").get(g,i);if(!row)return fail(res,404,"Grievance not found.");if(m.role==="student"&&row.studentUserId!==req.user.id)return fail(res,403,"You cannot view another student's grievance.");
  const messages=database.prepare("SELECT id,sender_user_id AS senderUserId,message,created_at AS createdAt FROM institution_grievance_messages WHERE institution_id=? AND grievance_id=? AND internal=0 ORDER BY created_at").all(i,g);
  return res.json({success:true,messages});
 }catch(e){next(e);}});
 app.post("/api/institutions/:institutionId/grievances/:grievanceId/messages",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),g=clean(req.params.grievanceId,128),m=member(req,res,i,["institution_admin","reviewer","student"]);if(!m)return;
  const row=database.prepare("SELECT student_user_id AS studentUserId,status FROM institution_grievances WHERE id=? AND institution_id=?").get(g,i);if(!row)return fail(res,404,"Grievance not found.");if(m.role==="student"&&row.studentUserId!==req.user.id)return fail(res,403,"You cannot reply to another student's grievance.");
  const message=clean(req.body?.message,2000);if(message.length<2)return fail(res,400,"Enter a message.");
  const msgId=id(),ts=now();database.prepare("INSERT INTO institution_grievance_messages(id,institution_id,grievance_id,sender_user_id,message,created_at) VALUES(?,?,?,?,?,?)").run(msgId,i,g,req.user.id,message,ts);
  database.prepare("UPDATE institution_grievances SET updated_at=? WHERE id=? AND institution_id=?").run(ts,g,i);audit(i,g,req.user.id,"message_added",{messageId:msgId});return res.status(201).json({success:true,message:{id:msgId,createdAt:ts}});
 }catch(e){next(e);}});
 app.patch("/api/institutions/:institutionId/grievances/:grievanceId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const i=clean(req.params.institutionId,128),g=clean(req.params.grievanceId,128);if(!member(req,res,i,["institution_admin","reviewer"]))return;
  const row=database.prepare("SELECT status FROM institution_grievances WHERE id=? AND institution_id=?").get(g,i);if(!row)return fail(res,404,"Grievance not found.");
  const status=clean(req.body?.status,20),priority=clean(req.body?.priority,20),assigned=clean(req.body?.assignedTo,128),resolution=clean(req.body?.resolution,2000);
  const allowed={open:["assigned","in_progress","resolved","closed"],assigned:["in_progress","resolved","closed"],in_progress:["resolved","closed"],resolved:["closed","reopened"],closed:["reopened"],reopened:["assigned","in_progress","resolved","closed"]};
  if(status&&!(allowed[row.status]||[]).includes(status))return fail(res,409,"This grievance status transition is not allowed.");
  if(priority&&!["low","normal","high","urgent"].includes(priority))return fail(res,400,"Invalid priority.");
  if(assigned&&!database.prepare("SELECT 1 FROM institution_memberships WHERE institution_id=? AND user_id=? AND status='active' AND role<>'student'").get(i,assigned))return fail(res,404,"Assigned staff member is not an active institution member.");
  if(status==="resolved"&&resolution.length<5)return fail(res,400,"Add a resolution note before resolving the grievance.");
  const ts=now();database.prepare("UPDATE institution_grievances SET status=COALESCE(NULLIF(? ,''),status),priority=COALESCE(NULLIF(? ,''),priority),assigned_to=CASE WHEN ?<>'' THEN ? ELSE assigned_to END,resolution=CASE WHEN ?<>'' THEN ? ELSE resolution END,closed_at=CASE WHEN ?='closed' THEN ? WHEN ?='reopened' THEN NULL ELSE closed_at END,updated_at=? WHERE id=? AND institution_id=?").run(status,priority,assigned,assigned,resolution,resolution,status,ts,status,ts,g,i);
  audit(i,g,req.user.id,"grievance_updated",{status,priority,assignedTo:assigned,resolution});return res.json({success:true});
 }catch(e){next(e);}});
}
