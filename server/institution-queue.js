import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const textValue = (value, max = 120) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ success: false, message });

export function registerInstitutionQueue({ app, database, requireAuth, requireMfaProduction, enforceSameOrigin, getInstitutionMembership, hasInstitutionFeature }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_service_counters (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      department TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      next_token_number INTEGER NOT NULL DEFAULT 1 CHECK(next_token_number > 0),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(institution_id, department, name)
    );
    CREATE TABLE IF NOT EXISTS institution_queue_tokens (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      counter_id TEXT NOT NULL REFERENCES institution_service_counters(id) ON DELETE CASCADE,
      token_number INTEGER NOT NULL CHECK(token_number > 0), student_user_id TEXT NOT NULL REFERENCES users(id),
      purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','called','serving','completed','cancelled','no_show')),
      created_at TEXT NOT NULL, called_at TEXT, started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL,
      UNIQUE(counter_id, token_number)
    );
    CREATE INDEX IF NOT EXISTS idx_institution_queue_live ON institution_queue_tokens(institution_id,counter_id,status,created_at);
    CREATE TABLE IF NOT EXISTS institution_queue_audit (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT, counter_id TEXT,
      action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS institution_service_appointments (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      counter_id TEXT NOT NULL REFERENCES institution_service_counters(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL REFERENCES users(id), scheduled_for TEXT NOT NULL,
      purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','confirmed','rejected','completed','cancelled','no_show')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id), review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_service_appointments_queue ON institution_service_appointments(institution_id,status,scheduled_for);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_service_appointment_slot ON institution_service_appointments(counter_id,scheduled_for) WHERE status IN ('requested','confirmed');
    CREATE TABLE IF NOT EXISTS institution_appointment_audit (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      appointment_id TEXT NOT NULL REFERENCES institution_service_appointments(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);

  function memberFor(req, res, institutionId, roles) {
    const member = getInstitutionMembership(req.user.id, institutionId);
    if (!member || member.status !== "active" || !roles.includes(member.role)) {
      fail(res, 403, "Your active institution role does not allow this queue action.");
      return null;
    }
    if (!hasInstitutionFeature(institutionId, "student_management")) {
      fail(res, 403, "Student management entitlement is required for service queue access.");
      return null;
    }
    return member;
  }
  function audit(institutionId, actor, action, counterId, tokenId, details = {}) {
    database.prepare("INSERT INTO institution_queue_audit(id,institution_id,actor_user_id,token_id,counter_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), institutionId, actor, tokenId || null, counterId || null, action, JSON.stringify(details), now());
  }

  app.get("/api/institutions/:institutionId/queue", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId = textValue(req.params.institutionId,128);
      const member = memberFor(req,res,institutionId,["institution_admin","reviewer","read_only","student"]);
      if (!member) return;
      const counters = database.prepare(`
        SELECT c.id,c.department,c.name,c.status,c.next_token_number,
          (SELECT COUNT(*) FROM institution_queue_tokens q WHERE q.counter_id=c.id AND q.status='waiting') AS waiting_count,
          (SELECT token_number FROM institution_queue_tokens q WHERE q.counter_id=c.id AND q.status IN ('called','serving') ORDER BY q.created_at LIMIT 1) AS current_token
        FROM institution_service_counters c WHERE c.institution_id=? ORDER BY c.department,c.name
      `).all(institutionId);
      const studentOnly = member.role === "student";
      const tokens = database.prepare(`
        SELECT q.id,q.counter_id AS counterId,c.department,c.name AS counterName,q.token_number AS tokenNumber,
          q.purpose,q.status,q.created_at AS createdAt,q.called_at AS calledAt,q.started_at AS startedAt,q.completed_at AS completedAt,
          u.email AS studentEmail
        FROM institution_queue_tokens q
        JOIN institution_service_counters c ON c.id=q.counter_id
        JOIN users u ON u.id=q.student_user_id
        WHERE q.institution_id=? ${studentOnly ? "AND q.student_user_id=?" : ""}
          AND q.status IN ('waiting','called','serving')
        ORDER BY q.created_at ASC LIMIT 500
      `).all(...(studentOnly ? [institutionId,req.user.id] : [institutionId]));
      res.setHeader("Cache-Control","private, no-store");
      return res.json({success:true,counters,tokens});
    } catch(error) { next(error); }
  });

  app.post("/api/institutions/:institutionId/queue/counters", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      if (!memberFor(req,res,institutionId,["institution_admin"])) return;
      const department=textValue(req.body?.department,100),name=textValue(req.body?.name,100);
      if(department.length<2||name.length<2) return fail(res,400,"Enter a department and counter name.");
      const counterId=id(),timestamp=now();
      const inserted = database.prepare("INSERT OR IGNORE INTO institution_service_counters(id,institution_id,department,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(counterId,institutionId,department,name,req.user.id,timestamp,timestamp);
      if (Number(inserted.changes) === 0) return fail(res,409,"A counter with this name already exists in the department.");
      audit(institutionId,req.user.id,"counter_created",counterId,null,{department,name});
      return res.status(201).json({success:true,counter:{id:counterId,department,name,status:"active",waiting_count:0}});
    } catch(error) {
      if(String(error?.code||"").includes("CONSTRAINT")) return fail(res,409,"A counter with this name already exists in the department.");
      next(error);
    }
  });

  app.patch("/api/institutions/:institutionId/queue/counters/:counterId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      if(!memberFor(req,res,institutionId,["institution_admin"])) return;
      const counterId=textValue(req.params.counterId,128),status=textValue(req.body?.status,20);
      if(!["active","paused"].includes(status)) return fail(res,400,"Counter status must be active or paused.");
      const result=database.prepare("UPDATE institution_service_counters SET status=?,updated_at=? WHERE id=? AND institution_id=?").run(status,now(),counterId,institutionId);
      if(!result.changes) return fail(res,404,"Service counter was not found.");
      audit(institutionId,req.user.id,"counter_status_changed",counterId,null,{status});
      return res.json({success:true,status});
    } catch(error) { next(error); }
  });

  app.post("/api/institutions/:institutionId/queue/counters/:counterId/tokens", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      const member=memberFor(req,res,institutionId,["institution_admin","student"]);
      if(!member) return;
      const counterId=textValue(req.params.counterId,128),purpose=textValue(req.body?.purpose,180);
      const counter=database.prepare("SELECT id,status,next_token_number FROM institution_service_counters WHERE id=? AND institution_id=?").get(counterId,institutionId);
      if(!counter) return fail(res,404,"Service counter was not found.");
      if(counter.status!=="active") return fail(res,409,"This service counter is paused and cannot issue new tokens.");
      if(purpose.length<3) return fail(res,400,"Enter the reason for your visit.");
      const tokenId=id(),timestamp=now();
      database.exec("BEGIN IMMEDIATE");
      try {
        const current=database.prepare("SELECT status,next_token_number FROM institution_service_counters WHERE id=? AND institution_id=?").get(counterId,institutionId);
        if(!current||current.status!=="active") throw Object.assign(new Error("This service counter is paused."),{status:409});
        const tokenNumber=Number(current.next_token_number);
        database.prepare("UPDATE institution_service_counters SET next_token_number=next_token_number+1,updated_at=? WHERE id=?").run(timestamp,counterId);
        database.prepare("INSERT INTO institution_queue_tokens(id,institution_id,counter_id,token_number,student_user_id,purpose,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'waiting',?,?)")
          .run(tokenId,institutionId,counterId,tokenNumber,req.user.id,purpose,timestamp,timestamp);
        audit(institutionId,req.user.id,"queue_token_issued",counterId,tokenId,{tokenNumber,purpose});
        database.exec("COMMIT");
        return res.status(201).json({success:true,token:{id:tokenId,counterId,tokenNumber,purpose,status:"waiting",createdAt:timestamp}});
      } catch(error) { try{database.exec("ROLLBACK");}catch{} throw error; }
    } catch(error) { if(error.status) return fail(res,error.status,error.message); next(error); }
  });

  app.post("/api/institutions/:institutionId/queue/counters/:counterId/call-next", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      if(!memberFor(req,res,institutionId,["institution_admin","reviewer"])) return;
      const counterId=textValue(req.params.counterId,128);
      const counter=database.prepare("SELECT id,status FROM institution_service_counters WHERE id=? AND institution_id=?").get(counterId,institutionId);
      if(!counter) return fail(res,404,"Service counter was not found.");
      if(counter.status!=="active") return fail(res,409,"Resume the counter before calling the next token.");
      database.exec("BEGIN IMMEDIATE");
      try {
        const inService=database.prepare("SELECT id FROM institution_queue_tokens WHERE counter_id=? AND status IN ('called','serving') LIMIT 1").get(counterId);
        if(inService) { database.exec("COMMIT"); return fail(res,409,"Complete or close the current service before calling another token."); }
        const next=database.prepare("SELECT id,token_number AS tokenNumber,student_user_id AS studentUserId,purpose FROM institution_queue_tokens WHERE counter_id=? AND status='waiting' ORDER BY created_at,id LIMIT 1").get(counterId);
        if(!next) { database.exec("COMMIT"); return res.status(200).json({success:true,token:null,message:"No students are waiting."}); }
        const timestamp=now();
        database.prepare("UPDATE institution_queue_tokens SET status='called',called_at=?,updated_at=? WHERE id=? AND status='waiting'").run(timestamp,timestamp,next.id);
        audit(institutionId,req.user.id,"queue_token_called",counterId,next.id,{tokenNumber:next.tokenNumber});
        database.exec("COMMIT");
        return res.json({success:true,token:{...next,status:"called",calledAt:timestamp}});
      } catch(error) { try{database.exec("ROLLBACK");}catch{} throw error; }
    } catch(error) { next(error); }
  });

  app.patch("/api/institutions/:institutionId/queue/tokens/:tokenId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128),tokenId=textValue(req.params.tokenId,128);
      const member=memberFor(req,res,institutionId,["institution_admin","reviewer","student"]);
      if(!member) return;
      const token=database.prepare("SELECT id,counter_id AS counterId,student_user_id AS studentUserId,status,token_number AS tokenNumber FROM institution_queue_tokens WHERE id=? AND institution_id=?").get(tokenId,institutionId);
      if(!token) return fail(res,404,"Queue token was not found.");
      const nextStatus=textValue(req.body?.status,20);
      if(member.role==="student" && (token.studentUserId!==req.user.id || token.status!=="waiting" || nextStatus!=="cancelled")) return fail(res,403,"Students can only cancel their own waiting token.");
      const allowed={waiting:["cancelled"],called:["serving","cancelled","no_show"],serving:["completed","no_show"]};
      if(!(allowed[token.status]||[]).includes(nextStatus)) return fail(res,409,"This queue status transition is not allowed.");
      const timestamp=now();
      const completedAt=["completed","cancelled","no_show"].includes(nextStatus)?timestamp:null;
      database.prepare("UPDATE institution_queue_tokens SET status=?,started_at=CASE WHEN ?='serving' THEN ? ELSE started_at END,completed_at=COALESCE(?,completed_at),updated_at=? WHERE id=? AND institution_id=?")
        .run(nextStatus,nextStatus,timestamp,completedAt,timestamp,tokenId,institutionId);
      audit(institutionId,req.user.id,"queue_token_status_changed",token.counterId,tokenId,{from:token.status,to:nextStatus,tokenNumber:token.tokenNumber});
      return res.json({success:true,status:nextStatus});
    } catch(error) { next(error); }
  });
  app.get("/api/institutions/:institutionId/appointments", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      const member=memberFor(req,res,institutionId,["institution_admin","reviewer","read_only","student"]);
      if(!member)return;
      const studentOnly=member.role==="student";
      const appointments=database.prepare(`
        SELECT a.id,a.counter_id AS counterId,c.department,c.name AS counterName,a.scheduled_for AS scheduledFor,
          a.purpose,a.status,a.created_at AS createdAt,a.updated_at AS updatedAt,a.review_note AS reviewNote,
          u.email AS studentEmail
        FROM institution_service_appointments a
        JOIN institution_service_counters c ON c.id=a.counter_id AND c.institution_id=a.institution_id
        JOIN users u ON u.id=a.student_user_id
        WHERE a.institution_id=? ${studentOnly?"AND a.student_user_id=?":""}
        ORDER BY a.scheduled_for DESC LIMIT 300
      `).all(...(studentOnly?[institutionId,req.user.id]:[institutionId]));
      res.setHeader("Cache-Control","private, no-store");
      return res.json({success:true,appointments,canBook:studentOnly,canManage:["institution_admin","reviewer"].includes(member.role)});
    }catch(error){next(error);}
  });

  app.post("/api/institutions/:institutionId/appointments", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128);
      if(!memberFor(req,res,institutionId,["student"]))return;
      const counterId=textValue(req.body?.counterId,128),purpose=textValue(req.body?.purpose,180),rawTime=textValue(req.body?.scheduledFor,50);
      const scheduledMs=Date.parse(rawTime);
      if(!Number.isFinite(scheduledMs)||scheduledMs<Date.now()+15*60*1000||scheduledMs>Date.now()+90*24*60*60*1000)
        return fail(res,400,"Choose an appointment at least 15 minutes from now and within the next 90 days.");
      if(purpose.length<3)return fail(res,400,"Enter the purpose of your appointment.");
      const counter=database.prepare("SELECT id,status FROM institution_service_counters WHERE id=? AND institution_id=?").get(counterId,institutionId);
      if(!counter)return fail(res,404,"Service counter was not found.");
      if(counter.status!=="active")return fail(res,409,"This service counter is paused and cannot accept appointments.");
      const appointmentId=id(),timestamp=now(),scheduledFor=new Date(scheduledMs).toISOString();
      try{
        database.prepare("INSERT INTO institution_service_appointments(id,institution_id,counter_id,student_user_id,scheduled_for,purpose,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(appointmentId,institutionId,counterId,req.user.id,scheduledFor,purpose,timestamp,timestamp);
      }catch(error){
        if(String(error.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"This appointment slot is already requested or confirmed. Choose another time.");
        throw error;
      }
      database.prepare("INSERT INTO institution_appointment_audit(id,institution_id,appointment_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(id(),institutionId,appointmentId,req.user.id,"appointment_requested",JSON.stringify({counterId,scheduledFor,purpose}),timestamp);
      return res.status(201).json({success:true,appointment:{id:appointmentId,counterId,scheduledFor,purpose,status:"requested",createdAt:timestamp}});
    }catch(error){next(error);}
  });

  app.patch("/api/institutions/:institutionId/appointments/:appointmentId", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=textValue(req.params.institutionId,128),appointmentId=textValue(req.params.appointmentId,128);
      const member=memberFor(req,res,institutionId,["institution_admin","reviewer","student"]);
      if(!member)return;
      const appointment=database.prepare("SELECT id,counter_id AS counterId,student_user_id AS studentUserId,status FROM institution_service_appointments WHERE id=? AND institution_id=?").get(appointmentId,institutionId);
      if(!appointment)return fail(res,404,"Service appointment was not found.");
      const nextStatus=textValue(req.body?.status,20),reviewNote=textValue(req.body?.reviewNote,300);
      if(member.role==="student"){
        if(appointment.studentUserId!==req.user.id||!["requested","confirmed"].includes(appointment.status)||nextStatus!=="cancelled")
          return fail(res,403,"Students can only cancel their own requested or confirmed appointments.");
      }else{
        const allowed={requested:["confirmed","rejected"],confirmed:["completed","no_show","cancelled"]};
        if(!(allowed[appointment.status]||[]).includes(nextStatus))return fail(res,409,"This appointment status transition is not allowed.");
        if(["rejected","cancelled"].includes(nextStatus)&&reviewNote.length<4)return fail(res,400,"Add a short note explaining this appointment decision.");
      }
      const timestamp=now();
      const changed=database.prepare("UPDATE institution_service_appointments SET status=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=? AND institution_id=? AND status=?")
        .run(nextStatus,member.role==="student"?null:req.user.id,reviewNote||null,timestamp,appointmentId,institutionId,appointment.status);
      if(!changed.changes)return fail(res,409,"Appointment was updated by another request. Refresh and try again.");
      database.prepare("INSERT INTO institution_appointment_audit(id,institution_id,appointment_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(id(),institutionId,appointmentId,req.user.id,"appointment_status_changed",JSON.stringify({from:appointment.status,to:nextStatus,reviewNote:reviewNote||null}),timestamp);
      return res.json({success:true,status:nextStatus});
    }catch(error){next(error);}
  });

}
