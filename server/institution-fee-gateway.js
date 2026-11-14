import crypto from "node:crypto";
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),clean=(v,n=160)=>String(v??"").trim().slice(0,n),fail=(r,s,m)=>r.status(s).json({success:false,message:m});
export function registerInstitutionFeeGateway({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}){
 database.exec(`
 CREATE TABLE IF NOT EXISTS institution_fee_payment_links(
  id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES institution_fee_invoices(id),student_user_id TEXT NOT NULL REFERENCES users(id),
  provider_link_id TEXT NOT NULL UNIQUE,amount_paise INTEGER NOT NULL CHECK(amount_paise>0),
  short_url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','paid','cancelled','expired')),
  created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,paid_at TEXT
 );
 CREATE INDEX IF NOT EXISTS idx_fee_payment_links_invoice ON institution_fee_payment_links(institution_id,invoice_id,status);
 `);
 app.post("/api/institutions/:institutionId/finance/invoices/:invoiceId/payment-link",enforceSameOrigin,requireAuth,requireMfaProduction,async(req,res,next)=>{
  try{
   const i=clean(req.params.institutionId,128),invoiceId=clean(req.params.invoiceId,128),m=getInstitutionMembership(req.user.id,i);
   if(!m||m.status!=="active"||!["institution_admin","student"].includes(m.role))return fail(res,403,"Active student or institution administrator membership is required.");
   if(!hasInstitutionFeature(i,"finance"))return fail(res,403,"Finance module is not enabled.");
   const invoice=database.prepare("SELECT id,student_user_id AS studentUserId,amount_paise AS amountPaise,status FROM institution_fee_invoices WHERE id=? AND institution_id=?").get(invoiceId,i);
   if(!invoice||invoice.status==="cancelled")return fail(res,404,"Invoice not found or cancelled.");
   if(m.role==="student"&&invoice.studentUserId!==req.user.id)return fail(res,403,"You can only pay your own invoice.");
   if(invoice.status==="paid")return fail(res,409,"This invoice is already paid.");
   const paid=Number(database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM institution_fee_payments WHERE invoice_id=?").get(invoiceId).n),balance=Number(invoice.amountPaise)-paid;
   if(!Number.isSafeInteger(balance)||balance<=0)return fail(res,409,"No outstanding balance remains.");
   const existing=database.prepare("SELECT provider_link_id AS id,short_url AS shortUrl,amount_paise AS amountPaise,status FROM institution_fee_payment_links WHERE invoice_id=? AND status='created' ORDER BY created_at DESC LIMIT 1").get(invoiceId);
   if(existing&&Number(existing.amountPaise)===balance)return res.json({success:true,paymentLink:existing,reused:true});
   if(existing)return fail(res,409,"An older payment link is still active for a different outstanding balance. Cancel or reconcile it before creating another.");
   const keyId=process.env.RAZORPAY_KEY_ID||"",secret=process.env.RAZORPAY_KEY_SECRET||"";
   if(!keyId||!secret)return fail(res,503,"Online fee payments are not configured. Razorpay merchant credentials are required.");
   const customer=database.prepare("SELECT email FROM users WHERE id=?").get(invoice.studentUserId);
   const ref=crypto.randomUUID().replaceAll("-","").slice(0,32),expire=Math.floor(Date.now()/1000)+7*86400;
   const provider=await fetch("https://api.razorpay.com/v1/payment_links",{method:"POST",headers:{Authorization:"Basic "+Buffer.from(keyId+":"+secret).toString("base64"),"Content-Type":"application/json"},body:JSON.stringify({amount:balance,currency:"INR",accept_partial:false,reference_id:ref,expire_by:expire,description:"Institution fee invoice "+invoiceId,customer:{email:customer?.email},notes:{institution_id:i,invoice_id:invoiceId,student_user_id:invoice.studentUserId},notify:{email:true,sms:false}}),signal:AbortSignal.timeout(15000)});
   const result=await provider.json().catch(()=>({}));
   if(!provider.ok||!result.id||!result.short_url){console.error("razorpay_fee_link_create_failed",{status:provider.status,providerError:result.error?.code||"unknown"});return fail(res,502,"Payment provider could not create the fee payment link.");}
   const ts=now();database.prepare("INSERT INTO institution_fee_payment_links(id,institution_id,invoice_id,student_user_id,provider_link_id,amount_paise,short_url,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id(),i,invoiceId,invoice.studentUserId,result.id,balance,result.short_url,req.user.id,ts);
   database.prepare("INSERT INTO institution_operations_audit(id,institution_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,'fee_payment_link_created','invoice',?,?,?)").run(id(),i,req.user.id,invoiceId,JSON.stringify({provider:"razorpay",paymentLinkId:result.id,amountPaise:balance}),ts);
   return res.status(201).json({success:true,paymentLink:{id:result.id,shortUrl:result.short_url,amountPaise:balance,currency:"INR",status:"created"}});
  }catch(e){next(e);}
 });
}
