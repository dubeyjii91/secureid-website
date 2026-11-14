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
      database.prepare("INSERT INTO institution_service_counters(id,institution_id,department,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(counterId,institutionId,department,name,req.user.id,timestamp,timestamp);
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
}
