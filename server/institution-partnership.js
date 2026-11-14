import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clean = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
function subscriptionEligible(subscription, paymentStatus) {
  if (!subscription || !["pilot","active"].includes(subscription.status)) return false;
  const startsValue = subscription.starts_at ?? subscription.startsAt;
  const endsValue = subscription.ends_at ?? subscription.endsAt;
  const starts = startsValue ? Date.parse(startsValue) : 0;
  const ends = endsValue ? Date.parse(endsValue) : Infinity;
  if ((startsValue && !Number.isFinite(starts)) || (endsValue && !Number.isFinite(ends))) return false;
  if ((starts && Date.now() < starts) || (ends !== Infinity && Date.now() >= ends)) return false;
  return subscription.status === "pilot" || paymentStatus === "verified";
}

export function registerInstitutionPartnership({ app, database, requireAuth, enforceSameOrigin }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_partnership_profiles (
      institution_id TEXT PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
      aishe_code TEXT, institution_type TEXT, affiliation TEXT, official_website TEXT,
      official_email_domain TEXT, address TEXT, representative_name TEXT,
      representative_title TEXT, representative_email TEXT, agreement_reference TEXT,
      identity_status TEXT NOT NULL DEFAULT 'pending' CHECK(identity_status IN ('pending','verified','rejected')),
      representative_status TEXT NOT NULL DEFAULT 'pending' CHECK(representative_status IN ('pending','verified','rejected')),
      agreement_status TEXT NOT NULL DEFAULT 'draft' CHECK(agreement_status IN ('draft','signed','rejected')),
      payment_status TEXT NOT NULL DEFAULT 'not_required' CHECK(payment_status IN ('not_required','pending','verified','failed')),
      payment_reference TEXT, payment_amount_paise INTEGER, payment_verified_at TEXT,
      connection_mode TEXT NOT NULL DEFAULT 'dashboard' CHECK(connection_mode IN ('dashboard','csv','api','erp')),
      connection_status TEXT NOT NULL DEFAULT 'not_connected' CHECK(connection_status IN ('not_connected','pending','connected','suspended')),
      connection_verified_at TEXT, notes TEXT, updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS institution_verification_evidence (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      check_type TEXT NOT NULL CHECK(check_type IN ('institution_identity','representative_authority','partnership_agreement','subscription_payment','technical_connection')),
      outcome TEXT NOT NULL CHECK(outcome IN ('pending','verified','rejected')),
      evidence_reference TEXT NOT NULL, notes TEXT, checked_by TEXT NOT NULL REFERENCES users(id),
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_evidence_institution ON institution_verification_evidence(institution_id, checked_at DESC);
    CREATE TABLE IF NOT EXISTS institution_partnership_audit (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_partnership_audit_institution ON institution_partnership_audit(institution_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS institution_payment_links (
      id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      provider_link_id TEXT NOT NULL UNIQUE, amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'), short_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','paid','expired','cancelled')),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, paid_at TEXT
    );
    CREATE TABLE IF NOT EXISTS institution_payment_webhook_events (
      event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, provider_link_id TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);

  function requireMfa(req, res, next) {
    if (!req.user?.mfaVerified) return fail(res,403,"MFA verification is required.","MFA_REQUIRED");
    return next();
  }
  function owner(req, res, next) {
    if (req.user?.role !== "owner") return fail(res, 403, "SecureID Owner access is required.", "OWNER_REQUIRED");
    return requireMfa(req, res, next);
  }
  function getProfile(institutionId) {
    database.prepare(`INSERT OR IGNORE INTO institution_partnership_profiles(institution_id,created_at,updated_at) VALUES(?,?,?)`).run(institutionId, now(), now());
    return database.prepare("SELECT * FROM institution_partnership_profiles WHERE institution_id=?").get(institutionId);
  }
  function snapshot(institutionId) {
    const institution = database.prepare("SELECT id,name,created_at AS createdAt FROM institutions WHERE id=?").get(institutionId);
    if (!institution) return null;
    const profile = getProfile(institutionId);
    const subscription = database.prepare("SELECT plan_key AS planKey,status,starts_at AS startsAt,ends_at AS endsAt,features_json AS featuresJson FROM institution_subscriptions WHERE institution_id=?").get(institutionId) || null;
    const members = database.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM institution_memberships WHERE institution_id=?").get(institutionId);
    const evidence = database.prepare("SELECT id,check_type AS checkType,outcome,evidence_reference AS evidenceReference,notes,checked_at AS checkedAt FROM institution_verification_evidence WHERE institution_id=? ORDER BY checked_at DESC LIMIT 30").all(institutionId);
    const audit = database.prepare("SELECT id,actor_user_id AS actorUserId,action,details_json AS detailsJson,created_at AS createdAt FROM institution_partnership_audit WHERE institution_id=? ORDER BY created_at DESC LIMIT 50").all(institutionId);
    const paidOrPilot = subscriptionEligible(subscription, profile.payment_status);
    const prerequisites = profile.identity_status === "verified" && profile.representative_status === "verified" && profile.agreement_status === "signed" && Boolean(paidOrPilot);
    const connected = profile.connection_status === "connected" && prerequisites;
    return {
      institution, profile: {
        aisheCode: profile.aishe_code, institutionType: profile.institution_type, affiliation: profile.affiliation,
        officialWebsite: profile.official_website, officialEmailDomain: profile.official_email_domain,
        address: profile.address, representativeName: profile.representative_name, representativeTitle: profile.representative_title,
        representativeEmail: profile.representative_email, agreementReference: profile.agreement_reference,
        identityStatus: profile.identity_status, representativeStatus: profile.representative_status,
        agreementStatus: profile.agreement_status, paymentStatus: profile.payment_status,
        paymentReference: profile.payment_reference, paymentAmountPaise: profile.payment_amount_paise,
        paymentVerifiedAt: profile.payment_verified_at, connectionMode: profile.connection_mode,
        connectionStatus: connected ? "connected" : profile.connection_status === "suspended" ? "suspended" : "not_connected",
        notes: profile.notes, updatedAt: profile.updated_at
      },
      subscription: subscription ? { planKey: subscription.planKey, status: subscription.status, startsAt: subscription.startsAt, endsAt: subscription.endsAt } : null,
      members: { total: Number(members.total || 0), active: Number(members.active || 0) },
      readiness: { identityVerified: profile.identity_status === "verified", representativeVerified: profile.representative_status === "verified", agreementSigned: profile.agreement_status === "signed", subscriptionCleared: Boolean(paidOrPilot), canConnect: Boolean(prerequisites), connected },
      evidence, audit
    };
  }

  app.get("/api/admin/institutions/:institutionId/partnership", requireAuth, owner, (req,res,next) => {
    try {
      const institutionId = clean(req.params.institutionId,128);
      const result = snapshot(institutionId);
      if (!result) return fail(res,404,"Institution was not found.");
      res.setHeader("Cache-Control","private, no-store");
      return res.json({success:true,...result});
    } catch(error) { next(error); }
  });

  app.put("/api/admin/institutions/:institutionId/partnership", enforceSameOrigin, requireAuth, owner, (req,res,next) => {
    try {
      const institutionId = clean(req.params.institutionId,128);
      if (!database.prepare("SELECT 1 FROM institutions WHERE id=?").get(institutionId)) return fail(res,404,"Institution was not found.");
      const values = {
        aisheCode: clean(req.body?.aisheCode,40), institutionType: clean(req.body?.institutionType,80),
        affiliation: clean(req.body?.affiliation,180), officialWebsite: clean(req.body?.officialWebsite,240),
        officialEmailDomain: clean(req.body?.officialEmailDomain,180).toLowerCase().replace(/^@/,""),
        address: clean(req.body?.address,500), representativeName: clean(req.body?.representativeName,140),
        representativeTitle: clean(req.body?.representativeTitle,100), representativeEmail: clean(req.body?.representativeEmail,254).toLowerCase(),
        agreementReference: clean(req.body?.agreementReference,160), paymentReference: clean(req.body?.paymentReference,160),
        paymentAmountPaise: req.body?.paymentAmountPaise === "" || req.body?.paymentAmountPaise == null ? null : Number(req.body.paymentAmountPaise),
        connectionMode: clean(req.body?.connectionMode,20), notes: clean(req.body?.notes,1000)
      };
      if (values.officialWebsite && !/^https:\/\//i.test(values.officialWebsite)) return fail(res,400,"Official website must use HTTPS.");
      if (values.officialEmailDomain && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(values.officialEmailDomain)) return fail(res,400,"Enter a valid institutional email domain.");
      if (values.representativeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.representativeEmail)) return fail(res,400,"Enter a valid representative email.");
      if (values.paymentAmountPaise !== null && (!Number.isSafeInteger(values.paymentAmountPaise) || values.paymentAmountPaise < 0)) return fail(res,400,"Payment amount must be a non-negative integer in paise.");
      if (!["dashboard","csv","api","erp"].includes(values.connectionMode)) return fail(res,400,"Choose a valid connection method.");
      const previous = getProfile(institutionId), timestamp = now();
      const identityChanged = previous.aishe_code !== (values.aisheCode||null) || previous.institution_type !== (values.institutionType||null) || previous.affiliation !== (values.affiliation||null) || previous.official_website !== (values.officialWebsite||null) || previous.address !== (values.address||null);
      const representativeChanged = previous.official_email_domain !== (values.officialEmailDomain||null) || previous.representative_name !== (values.representativeName||null) || previous.representative_title !== (values.representativeTitle||null) || previous.representative_email !== (values.representativeEmail||null);
      const agreementChanged = previous.agreement_reference !== (values.agreementReference||null);
      const paymentChanged = previous.payment_reference !== (values.paymentReference||null) || Number(previous.payment_amount_paise||0) !== Number(values.paymentAmountPaise||0);
      const connectionChanged = previous.connection_mode !== values.connectionMode;
      const upstreamChanged = identityChanged || representativeChanged || agreementChanged || paymentChanged || connectionChanged;
      database.prepare(`UPDATE institution_partnership_profiles SET aishe_code=?,institution_type=?,affiliation=?,official_website=?,official_email_domain=?,address=?,representative_name=?,representative_title=?,representative_email=?,agreement_reference=?,payment_reference=?,payment_amount_paise=?,connection_mode=?,notes=?,identity_status=CASE WHEN ? THEN 'pending' ELSE identity_status END,representative_status=CASE WHEN ? THEN 'pending' ELSE representative_status END,agreement_status=CASE WHEN ? THEN 'draft' ELSE agreement_status END,payment_status=CASE WHEN ? THEN 'pending' ELSE payment_status END,payment_verified_at=CASE WHEN ? THEN NULL ELSE payment_verified_at END,connection_status=CASE WHEN ? THEN 'not_connected' ELSE connection_status END,connection_verified_at=CASE WHEN ? THEN NULL ELSE connection_verified_at END,updated_by=?,updated_at=? WHERE institution_id=?`)
        .run(values.aisheCode||null,values.institutionType||null,values.affiliation||null,values.officialWebsite||null,values.officialEmailDomain||null,values.address||null,values.representativeName||null,values.representativeTitle||null,values.representativeEmail||null,values.agreementReference||null,values.paymentReference||null,values.paymentAmountPaise,values.connectionMode,values.notes||null,identityChanged?1:0,representativeChanged?1:0,agreementChanged?1:0,paymentChanged?1:0,paymentChanged?1:0,upstreamChanged?1:0,upstreamChanged?1:0,req.user.id,timestamp,institutionId);
      const changedFields = Object.keys(values).filter(key => {
        const column = ({aisheCode:"aishe_code",institutionType:"institution_type",affiliation:"affiliation",officialWebsite:"official_website",officialEmailDomain:"official_email_domain",address:"address",representativeName:"representative_name",representativeTitle:"representative_title",representativeEmail:"representative_email",agreementReference:"agreement_reference",paymentReference:"payment_reference",paymentAmountPaise:"payment_amount_paise",connectionMode:"connection_mode",notes:"notes"})[key];
        return previous[column] !== (values[key] || null);
      });
      database.prepare("INSERT INTO institution_partnership_audit(id,institution_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,'institution_profile_updated',?,?)")
        .run(id(),institutionId,req.user.id,JSON.stringify({changedFields}),timestamp);
      return res.json({success:true,...snapshot(institutionId)});
    } catch(error) { next(error); }
  });

  app.post("/api/admin/institutions/:institutionId/partnership/checks", enforceSameOrigin, requireAuth, owner, (req,res,next) => {
    try {
      const institutionId = clean(req.params.institutionId,128), checkType = clean(req.body?.checkType,40);
      const outcome = clean(req.body?.outcome,20), evidenceReference = clean(req.body?.evidenceReference,240), notes = clean(req.body?.notes,500);
      if (!database.prepare("SELECT 1 FROM institutions WHERE id=?").get(institutionId)) return fail(res,404,"Institution was not found.");
      const allowed = ["institution_identity","representative_authority","partnership_agreement","subscription_payment","technical_connection"];
      if (!allowed.includes(checkType) || !["pending","verified","rejected"].includes(outcome) || evidenceReference.length < 4) return fail(res,400,"Choose a valid verification check, outcome and evidence reference.");
      const profile = getProfile(institutionId), subscription = database.prepare("SELECT status,starts_at,ends_at FROM institution_subscriptions WHERE institution_id=?").get(institutionId);
      if (checkType === "subscription_payment" && subscription?.status !== "active") return fail(res,409,"Payment can only be verified for an active paid subscription. Pilot access is not a paid membership.");
      if (outcome === "verified") {
        if (checkType === "institution_identity" && (!profile.aishe_code || !profile.official_website || !profile.address)) return fail(res,409,"Complete AISHE code, official HTTPS website and address before verifying the institution.");
        if (checkType === "representative_authority" && (!profile.representative_name || !profile.representative_email || !profile.official_email_domain || !profile.representative_email.endsWith("@"+profile.official_email_domain))) return fail(res,409,"Representative details must include an email on the institution's declared official domain. Confirm authority independently before marking verified.");
        if (checkType === "partnership_agreement" && !profile.agreement_reference) return fail(res,409,"Save the signed agreement reference before marking the agreement verified.");
        if (checkType === "subscription_payment" && (!profile.payment_reference || !profile.payment_amount_paise || profile.payment_amount_paise < 1)) return fail(res,409,"Save a payment reference and amount before verifying receipt.");
        if (checkType === "technical_connection") {
          const paidOrPilot = subscriptionEligible(subscription, profile.payment_status);
          if (profile.identity_status !== "verified" || profile.representative_status !== "verified" || profile.agreement_status !== "signed" || !paidOrPilot) return fail(res,409,"Verify institution identity, representative authority, signed agreement and subscription/payment before connecting.");
        }
      }
      const timestamp = now();
      database.prepare("INSERT INTO institution_verification_evidence(id,institution_id,check_type,outcome,evidence_reference,notes,checked_by,checked_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id(),institutionId,checkType,outcome,evidenceReference,notes||null,req.user.id,timestamp);
      const map = {
        institution_identity: ["identity_status", "identity"],
        representative_authority: ["representative_status", "representative"],
        partnership_agreement: ["agreement_status", "agreement"],
        subscription_payment: ["payment_status", "payment"],
        technical_connection: ["connection_status", "connection"]
      };
      const [column,kind] = map[checkType];
      const status = kind === "agreement" ? (outcome === "verified" ? "signed" : outcome === "rejected" ? "rejected" : "draft")
        : kind === "payment" ? (outcome === "verified" ? "verified" : outcome === "rejected" ? "failed" : "pending")
        : kind === "connection" ? (outcome === "verified" ? "connected" : outcome === "rejected" ? "suspended" : "pending")
        : outcome;
      const extra = kind === "payment" ? ",payment_verified_at=?" : kind === "connection" ? ",connection_verified_at=?" : "";
      const params = [status, ...(extra ? [outcome === "verified" ? timestamp : null] : []), timestamp, req.user.id, institutionId];
      database.prepare("UPDATE institution_partnership_profiles SET "+column+"=?"+extra+",updated_at=?,updated_by=? WHERE institution_id=?").run(...params);
      database.prepare("INSERT INTO institution_partnership_audit(id,institution_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,'verification_check_recorded',?,?)")
        .run(id(),institutionId,req.user.id,JSON.stringify({checkType,outcome,evidenceReference}),timestamp);
      return res.json({success:true,...snapshot(institutionId)});
    } catch(error) { next(error); }
  });

  // Create a real Razorpay Payment Link; payment is never marked paid by the browser.
  app.post("/api/admin/institutions/:institutionId/partnership/payment-link", enforceSameOrigin, requireAuth, owner, async (req,res,next) => {
    try {
      const institutionId = clean(req.params.institutionId,128);
      const institution = database.prepare("SELECT id,name FROM institutions WHERE id=?").get(institutionId);
      if (!institution) return fail(res,404,"Institution was not found.");
      const profile = getProfile(institutionId);
      const subscription = database.prepare("SELECT plan_key AS planKey,status FROM institution_subscriptions WHERE institution_id=?").get(institutionId);
      if (!subscription || subscription.planKey === "pilot" || !["active","past_due"].includes(subscription.status)) return fail(res,409,"Choose a paid institution plan with a valid billing period before creating a payment link.");
      if (!Number.isSafeInteger(profile.payment_amount_paise) || profile.payment_amount_paise < 1) return fail(res,409,"Save the exact subscription amount in rupees before creating a payment link.");
      if (database.prepare("SELECT 1 FROM institution_payment_links WHERE institution_id=? AND status='created' LIMIT 1").get(institutionId)) return fail(res,409,"An unpaid payment link already exists for this institution. Resolve or cancel it before creating another.");
      const keyId = process.env.RAZORPAY_KEY_ID || "", keySecret = process.env.RAZORPAY_KEY_SECRET || "";
      if (!keyId || !keySecret) return fail(res,503,"Razorpay is not configured yet. Add the live/test API key ID and secret in Railway after merchant onboarding.");
      const referenceId = crypto.randomUUID().replaceAll("-","").slice(0,32);
      const response = await fetch("https://api.razorpay.com/v1/payment_links", {
        method:"POST",
        headers:{Authorization:"Basic "+Buffer.from(keyId+":"+keySecret).toString("base64"),"Content-Type":"application/json"},
        body:JSON.stringify({
          amount:profile.payment_amount_paise,currency:"INR",accept_partial:false,
          reference_id:referenceId,expire_by:Math.floor(Date.now()/1000)+7*24*60*60,
          description:"SecureID institution subscription - "+institution.name,
          customer:{name:profile.representative_name||institution.name,email:profile.representative_email||undefined},
          notes:{institution_id:institutionId,plan_key:subscription.planKey,created_by:req.user.id},
          notify:{email:Boolean(profile.representative_email),sms:false}
        }),
        signal:AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(()=>({}));
      if (!response.ok || !result.id || !result.short_url) {
        console.error("razorpay_payment_link_create_failed", {status:response.status,providerError:result.error?.code||"unknown"});
        return fail(res,502,"Payment provider could not create the link. Check the Razorpay account and API configuration.");
      }
      const timestamp = now();
      database.prepare("INSERT INTO institution_payment_links(id,institution_id,provider_link_id,amount_paise,short_url,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(id(),institutionId,result.id,profile.payment_amount_paise,result.short_url,req.user.id,timestamp);
      database.prepare("UPDATE institution_partnership_profiles SET payment_status='pending',payment_reference=?,payment_verified_at=NULL,updated_by=?,updated_at=? WHERE institution_id=?")
        .run(result.id,req.user.id,timestamp,institutionId);
      database.prepare("UPDATE institution_subscriptions SET status='past_due',updated_by=?,updated_at=? WHERE institution_id=? AND status='active'")
        .run(req.user.id,timestamp,institutionId);
      database.prepare("INSERT INTO institution_partnership_audit(id,institution_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,'payment_link_created',?,?)")
        .run(id(),institutionId,req.user.id,JSON.stringify({provider:"razorpay",paymentLinkId:result.id,amountPaise:profile.payment_amount_paise}),timestamp);
      return res.status(201).json({success:true,paymentLink:{id:result.id,shortUrl:result.short_url,amountPaise:profile.payment_amount_paise,currency:"INR",status:"created"}});
    } catch(error) { next(error); }
  });

  // Razorpay signs the exact raw request body. Duplicate webhook deliveries are idempotent.
  app.post("/api/webhooks/razorpay", (req,res,next) => {
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
      const signature = String(req.headers["x-razorpay-signature"] || "");
      const raw = req.rawBody;
      if (!secret || !Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/i.test(signature)) return fail(res,401,"Invalid payment webhook signature.");
      const expected = crypto.createHmac("sha256",secret).update(raw).digest();
      const supplied = Buffer.from(signature,"hex");
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) return fail(res,401,"Invalid payment webhook signature.");
      const eventId = clean(req.headers["x-razorpay-event-id"],180);
      const eventType = clean(req.body?.event,100);
      const paymentLink = req.body?.payload?.payment_link?.entity;
      if (eventType !== "payment_link.paid" || !paymentLink?.id) return res.status(200).json({success:true,ignored:true});
      const link = database.prepare("SELECT * FROM institution_payment_links WHERE provider_link_id=?").get(paymentLink.id);
      if (!link) return res.status(200).json({success:true,ignored:true});
      const paidAmount = Number(paymentLink.amount_paid);
      if (!Number.isSafeInteger(paidAmount) || paidAmount !== link.amount_paise || paymentLink.currency !== "INR") return fail(res,409,"Payment amount does not match the institution invoice.");
      const timestamp = now();
      try {
        database.prepare("INSERT INTO institution_payment_webhook_events(event_id,event_type,provider_link_id,received_at) VALUES(?,?,?,?)")
          .run(eventId || crypto.createHash("sha256").update(raw).digest("hex"),eventType,paymentLink.id,timestamp);
      } catch(error) {
        if (String(error.code || "").includes("SQLITE_CONSTRAINT")) return res.status(200).json({success:true,duplicate:true});
        throw error;
      }
      database.prepare("UPDATE institution_payment_links SET status='paid',paid_at=? WHERE provider_link_id=? AND status<>'paid'").run(timestamp,paymentLink.id);
      database.prepare("UPDATE institution_partnership_profiles SET payment_status='verified',payment_verified_at=?,updated_at=? WHERE institution_id=?")
        .run(timestamp,timestamp,link.institution_id);
      database.prepare("UPDATE institution_subscriptions SET status='active',starts_at=COALESCE(starts_at,?),updated_at=? WHERE institution_id=? AND status='past_due'")
        .run(timestamp,timestamp,link.institution_id);
      database.prepare("INSERT INTO institution_partnership_audit(id,institution_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,'payment_confirmed_by_gateway',?,?)")
        .run(id(),link.institution_id,link.created_by,JSON.stringify({provider:"razorpay",paymentLinkId:paymentLink.id,amountPaidPaise:paidAmount}),timestamp);
      return res.status(200).json({success:true,recorded:true});
    } catch(error) { next(error); }
  });

  app.get("/api/institutions/:institutionId/partnership-status", requireAuth, requireMfa, (req,res,next) => {
    try {
      const institutionId = clean(req.params.institutionId,128);
      const member = database.prepare("SELECT role,status FROM institution_memberships WHERE institution_id=? AND user_id=?").get(institutionId,req.user.id);
      if (!member || member.status !== "active" || member.role !== "institution_admin") return fail(res,403,"An active institution administrator membership is required.");
      const result = snapshot(institutionId);
      if (!result) return fail(res,404,"Institution was not found.");
      return res.json({success:true,institution:result.institution,profile:result.profile,subscription:result.subscription,readiness:result.readiness});
    } catch(error) { next(error); }
  });
}
