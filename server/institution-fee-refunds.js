import crypto from "node:crypto";

const clean=(value,max=300)=>String(value??"").trim().slice(0,max);
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const fail=(res,status,message)=>res.status(status).json({success:false,message});

export function registerInstitutionFeeRefunds({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 database.exec(`
  CREATE TABLE IF NOT EXISTS institution_fee_refund_requests(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   payment_id TEXT NOT NULL REFERENCES institution_fee_payments(id) ON DELETE CASCADE,
   invoice_id TEXT NOT NULL REFERENCES institution_fee_invoices(id) ON DELETE CASCADE,
   student_user_id TEXT NOT NULL REFERENCES users(id),requested_by TEXT NOT NULL REFERENCES users(id),amount_paise INTEGER NOT NULL CHECK(amount_paise>0),
   reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected','recorded')),
   idempotency_key TEXT NOT NULL,requested_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   reviewed_by TEXT REFERENCES users(id),review_note TEXT,external_reference TEXT,recorded_at TEXT,
   UNIQUE(institution_id,idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_fee_refunds_queue ON institution_fee_refund_requests(institution_id,status,requested_at);
  CREATE INDEX IF NOT EXISTS idx_fee_refunds_payment ON institution_fee_refund_requests(payment_id,status);
  CREATE TABLE IF NOT EXISTS institution_fee_refund_audit(
   id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
   refund_id TEXT NOT NULL REFERENCES institution_fee_refund_requests(id) ON DELETE CASCADE,
   actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL
  );
 `);
 function member(req,res,institutionId,roles){
  const m=getInstitutionMembership(req.user.id,institutionId);
  if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this finance action.");return null;}
  if(!hasInstitutionFeature(institutionId,"finance")){fail(res,403,"Finance is not enabled.","FEATURE_NOT_ENTITLED");return null;}
  return m;
 }
 function audit(institutionId,refundId,actorId,action,details={}){
  database.prepare("INSERT INTO institution_fee_refund_audit(id,institution_id,refund_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
   .run(id(),institutionId,refundId,actorId,action,JSON.stringify(details),now());
 }

 app.get("/api/institutions/:institutionId/finance/refunds",requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),m=member(req,res,institutionId,["institution_admin","finance_manager","accounts"]);if(!m)return;
   const studentOnly=false;
   const payments=database.prepare(`
    SELECT p.id,p.invoice_id AS invoiceId,p.student_user_id AS studentUserId,u.email AS studentEmail,p.amount_paise AS amountPaise,p.method,p.reference,p.created_at AS createdAt,
      i.fee_head AS feeHead,COALESCE(SUM(r.amount_paise),0) AS reservedRefundPaise,
      p.amount_paise-COALESCE(SUM(r.amount_paise),0) AS refundablePaise
    FROM institution_fee_payments p
    JOIN institution_fee_invoices i ON i.id=p.invoice_id AND i.institution_id=p.institution_id
    JOIN users u ON u.id=p.student_user_id
    LEFT JOIN institution_fee_refund_requests r ON r.payment_id=p.id AND r.status IN ('requested','approved','recorded')
    WHERE p.institution_id=? ${studentOnly?"AND p.student_user_id=?":""}
    GROUP BY p.id ORDER BY p.created_at DESC LIMIT 500
   `).all(...(studentOnly?[institutionId,req.user.id]:[institutionId]));
   const refunds=database.prepare(`
    SELECT r.id,r.payment_id AS paymentId,r.invoice_id AS invoiceId,r.student_user_id AS studentUserId,
      r.amount_paise AS amountPaise,r.reason,r.status,r.requested_at AS requestedAt,r.updated_at AS updatedAt,
      r.review_note AS reviewNote,r.external_reference AS externalReference,r.recorded_at AS recordedAt,r.requested_by AS requestedBy,
      u.email AS studentEmail,i.fee_head AS feeHead,p.method,p.reference AS paymentReference
    FROM institution_fee_refund_requests r
    JOIN users u ON u.id=r.student_user_id
    JOIN institution_fee_invoices i ON i.id=r.invoice_id AND i.institution_id=r.institution_id
    JOIN institution_fee_payments p ON p.id=r.payment_id AND p.institution_id=r.institution_id
    WHERE r.institution_id=? ${studentOnly?"AND r.student_user_id=?":""}
    ORDER BY CASE r.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,r.requested_at DESC LIMIT 500
   `).all(...(studentOnly?[institutionId,req.user.id]:[institutionId]));
   res.setHeader("Cache-Control","private, no-store");return res.json({success:true,payments,refunds:refunds.map(item=>({...item,canReviewThis:item.requestedBy!==req.user.id})),canRequest:true,canReview:true});
  }catch(error){next(error);}
 });

 app.post("/api/institutions/:institutionId/finance/payments/:paymentId/refunds",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),paymentId=clean(req.params.paymentId,128);
   if(!member(req,res,institutionId,["institution_admin","finance_manager","accounts"]))return;
   const studentUserId=clean(req.body?.studentUserId,128);
   const amountPaise=Number(req.body?.amountPaise),reason=clean(req.body?.reason,1000),idempotencyKey=clean(req.get("Idempotency-Key")||req.body?.idempotencyKey,100);
   if(!Number.isSafeInteger(amountPaise)||amountPaise<1||reason.length<10||idempotencyKey.length<12)return fail(res,400,"Enter a valid refund amount, reason (at least 10 characters) and unique request key.");
   database.exec("BEGIN IMMEDIATE");
   try{
    const duplicate=database.prepare("SELECT id,status FROM institution_fee_refund_requests WHERE institution_id=? AND idempotency_key=?").get(institutionId,idempotencyKey);
    if(duplicate){database.exec("COMMIT");return res.status(200).json({success:true,duplicate:true,refund:{id:duplicate.id,status:duplicate.status}});}
    const payment=database.prepare("SELECT p.id,p.invoice_id AS invoiceId,p.amount_paise AS amountPaise,p.student_user_id AS studentUserId FROM institution_fee_payments p JOIN institution_fee_invoices i ON i.id=p.invoice_id AND i.institution_id=p.institution_id WHERE p.id=? AND p.institution_id=? AND p.student_user_id=?").get(paymentId,institutionId,studentUserId);
    if(!payment){database.exec("ROLLBACK");return fail(res,404,"Your payment record was not found.");}
    const reserved=Number(database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM institution_fee_refund_requests WHERE payment_id=? AND status IN ('requested','approved','recorded')").get(paymentId).n);
    if(reserved+amountPaise>Number(payment.amountPaise)){database.exec("ROLLBACK");return fail(res,409,"Refund request exceeds the unrefunded amount of this payment.");}
    const refundId=id(),timestamp=now();
    database.prepare("INSERT INTO institution_fee_refund_requests(id,institution_id,payment_id,invoice_id,student_user_id,requested_by,amount_paise,reason,idempotency_key,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
     .run(refundId,institutionId,paymentId,payment.invoiceId,payment.studentUserId,req.user.id,amountPaise,reason,idempotencyKey,timestamp,timestamp);
    audit(institutionId,refundId,req.user.id,"refund_requested",{paymentId,invoiceId:payment.invoiceId,amountPaise});
    database.exec("COMMIT");
    return res.status(201).json({success:true,refund:{id:refundId,paymentId,amountPaise,status:"requested",requestedAt:timestamp}});
   }catch(error){try{database.exec("ROLLBACK");}catch{}if(String(error.message||"").includes("UNIQUE constraint failed"))return fail(res,409,"This refund request key has already been used.");throw error;}
  }catch(error){next(error);}
 });

 app.patch("/api/institutions/:institutionId/finance/refunds/:refundId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
  try{
   const institutionId=clean(req.params.institutionId,128),refundId=clean(req.params.refundId,128);
   if(!member(req,res,institutionId,["institution_admin","finance_manager","accounts"]))return;
   const decision=clean(req.body?.decision,20),reviewNote=clean(req.body?.reviewNote,500),externalReference=clean(req.body?.externalReference,120);
   if(!["approve","reject","record"].includes(decision)||reviewNote.length<4)return fail(res,400,"Choose approve, reject or record and provide a review note.");
   if(decision==="record"&&externalReference.length<4)return fail(res,400,"A completed external bank/UPI refund reference is required.");
   database.exec("BEGIN IMMEDIATE");
   try{
    const refund=database.prepare("SELECT id,invoice_id AS invoiceId,payment_id AS paymentId,amount_paise AS amountPaise,status,requested_by AS requestedBy FROM institution_fee_refund_requests WHERE id=? AND institution_id=?").get(refundId,institutionId);
    if(!refund){database.exec("ROLLBACK");return fail(res,404,"Refund request was not found.");}
    if(refund.requestedBy===req.user.id){database.exec("ROLLBACK");return fail(res,403,"A different finance administrator must review this refund request.");}
    const nextStatus=decision==="approve"?"approved":decision==="reject"?"rejected":"recorded";
    const allowed=decision==="approve"?["requested"]:decision==="reject"?["requested","approved"]:["approved"];
    if(!allowed.includes(refund.status)){database.exec("ROLLBACK");return fail(res,409,"This refund request cannot move to the selected state.");}
    const timestamp=now();
    const changed=database.prepare("UPDATE institution_fee_refund_requests SET status=?,reviewed_by=?,review_note=?,external_reference=?,recorded_at=?,updated_at=? WHERE id=? AND institution_id=? AND status=?")
     .run(nextStatus,req.user.id,reviewNote,decision==="record"?externalReference:null,decision==="record"?timestamp:null,timestamp,refundId,institutionId,refund.status);
    if(!changed.changes){database.exec("ROLLBACK");return fail(res,409,"Refund request was updated by another action. Refresh and retry.");}
    if(decision==="record"){
     const invoice=database.prepare("SELECT amount_paise FROM institution_fee_invoices WHERE id=? AND institution_id=?").get(refund.invoiceId,institutionId);
     const gross=Number(database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM institution_fee_payments WHERE invoice_id=?").get(refund.invoiceId).n);
     const refunded=Number(database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM institution_fee_refund_requests WHERE invoice_id=? AND status='recorded'").get(refund.invoiceId).n);
     const netPaid=Math.max(0,gross-refunded),status=netPaid>=Number(invoice.amount_paise)?"paid":netPaid>0?"partial":"unpaid";
     database.prepare("UPDATE institution_fee_invoices SET status=?,updated_at=? WHERE id=? AND institution_id=?").run(status,timestamp,refund.invoiceId,institutionId);
    }
    audit(institutionId,refundId,req.user.id,"refund_"+nextStatus,{amountPaise:refund.amountPaise,reviewNote,externalReference:decision==="record"?externalReference:null});
    database.exec("COMMIT");
    return res.json({success:true,status:nextStatus,externalReference:decision==="record"?externalReference:null});
   }catch(error){try{database.exec("ROLLBACK");}catch{}throw error;}
  }catch(error){next(error);}
 });
}
