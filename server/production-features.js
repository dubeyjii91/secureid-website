import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { fileTypeFromBuffer } from "file-type";
import { enforceShareRateLimit } from "./share-rate-limit.js";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const ALLOWED_DOCUMENT_CATEGORIES = new Set(["general","aadhaar","pan","passport","voter_id","driving_licence","student_id","institution_proof"]);
const COLLEGE_REVIEW_CONSENT_VERSION = "college-review-v1";

function createCryptoKey(isProduction){
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY || "";
  if(!raw && isProduction){
    throw new Error("DOCUMENT_ENCRYPTION_KEY is required in production.");
  }

  if(!raw){
    return crypto.randomBytes(32);
  }

  try{
    const key = Buffer.from(raw,"base64");
    if(key.length !== 32) throw new Error();
    return key;
  }catch{
    throw new Error("DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
}

function encryptBuffer(buffer,key){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(buffer),cipher.final()]);
  const tag=cipher.getAuthTag();
  return {
    iv:iv.toString("base64"),
    tag:tag.toString("base64"),
    data:ciphertext.toString("base64")
  };
}

function decryptBuffer(payload,key){
  const iv=Buffer.from(payload.iv,"base64");
  const tag=Buffer.from(payload.tag,"base64");
  const data=Buffer.from(payload.data,"base64");

  const decipher=crypto.createDecipheriv("aes-256-gcm",key,iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data),decipher.final()]);
}

function safeFilename(name){
  const cleaned=String(name||"document")
    .replace(/[^\w.\- ()]/g,"_")
    .slice(0,180);

  return cleaned || "document";
}

function jsonEncrypt(value,key){
  return encryptBuffer(Buffer.from(JSON.stringify(value),"utf8"),key);
}

function jsonDecrypt(payload,key){
  return JSON.parse(decryptBuffer(payload,key).toString("utf8"));
}

export function registerProductionFeatures({
  app,
  database,
  requireAuth,
  enforceSameOrigin,
  isProduction,
  logEvent,
  ensureSecurityNotification
}){
  const key=createCryptoKey(isProduction);

  const dataRoot=process.env.DOCUMENT_STORAGE_PATH || (
    isProduction ? "/data/secureid-documents" : path.join(process.cwd(),"data","secureid-documents")
  );

  fs.mkdirSync(dataRoot,{recursive:true});

  /*
   * These tables are intentionally created by migration code here so existing
   * SecureID installations can upgrade without destroying existing data.
   */
  database.exec(`
    CREATE TABLE IF NOT EXISTS admin_document_access_audit (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      document_id TEXT,
      owner_user_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('success','denied','not_found','error')),
      request_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_document_audit_created ON admin_document_access_audit(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_document_audit_document ON admin_document_access_audit(document_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS identity_profiles (
      user_id TEXT PRIMARY KEY,
      encrypted_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secure_documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      encrypted_path TEXT NOT NULL,
      document_category TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_secure_documents_user
      ON secure_documents(user_id, deleted_at);

    CREATE TABLE IF NOT EXISTS identity_document_checks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_category TEXT NOT NULL CHECK (document_category IN ('pan','aadhaar')),
      file_integrity_status TEXT NOT NULL CHECK (file_integrity_status IN ('passed','failed')),
      authenticity_status TEXT NOT NULL DEFAULT 'not_verified' CHECK (authenticity_status IN ('not_verified','verified','rejected')),
      checked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_identity_document_checks_user
      ON identity_document_checks(user_id, document_id, checked_at);

    CREATE TABLE IF NOT EXISTS college_pilot_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_college_pilot_requests_user
      ON college_pilot_requests(user_id, created_at);

    -- Memberships are provisioned only by a trusted operator; no public
    -- endpoint may grant institution roles or create memberships.
    CREATE TABLE IF NOT EXISTS institutions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS institution_memberships (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student','reviewer','institution_admin','read_only')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(institution_id, user_id),
      FOREIGN KEY(institution_id) REFERENCES institutions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_institution_memberships_user
      ON institution_memberships(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_institution_memberships_institution
      ON institution_memberships(institution_id, status);

    CREATE TABLE IF NOT EXISTS hostel_applications (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      student_user_id TEXT NOT NULL REFERENCES users(id),
      academic_year TEXT NOT NULL,
      stay_type TEXT NOT NULL CHECK (stay_type IN ('new_admission','renewal')),
      room_preference TEXT NOT NULL DEFAULT 'no_preference',
      student_note TEXT,
      consented_at TEXT NOT NULL,
      consent_version TEXT NOT NULL DEFAULT 'hostel-application-v1',
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','needs_correction','approved','rejected','withdrawn')),
      encrypted_review_note TEXT,
      reviewed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_applications_institution_status ON hostel_applications(institution_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hostel_applications_student ON hostel_applications(student_user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS hostel_application_audit (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES hostel_applications(id),
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_application_audit_app ON hostel_application_audit(application_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS hostel_buildings (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(institution_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_buildings_institution ON hostel_buildings(institution_id, name);
    CREATE TABLE IF NOT EXISTS hostel_rooms (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      building_id TEXT NOT NULL REFERENCES hostel_buildings(id),
      room_number TEXT NOT NULL,
      room_type TEXT NOT NULL CHECK(room_type IN ('single','shared','dormitory')),
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 12),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(building_id, room_number)
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_rooms_institution ON hostel_rooms(institution_id, status);
    CREATE TABLE IF NOT EXISTS hostel_bed_allocations (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      application_id TEXT NOT NULL REFERENCES hostel_applications(id),
      room_id TEXT NOT NULL REFERENCES hostel_rooms(id),
      academic_year TEXT NOT NULL,
      bed_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'allocated' CHECK(status IN ('allocated','released')),
      allocated_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hostel_active_application_allocation
      ON hostel_bed_allocations(application_id) WHERE status='allocated';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hostel_active_bed_allocation
      ON hostel_bed_allocations(room_id, academic_year, bed_label) WHERE status='allocated';


    CREATE TABLE IF NOT EXISTS institution_review_submissions (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      student_user_id TEXT NOT NULL REFERENCES users(id),
      document_id TEXT NOT NULL REFERENCES secure_documents(id),
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','needs_correction','approved','rejected','withdrawn')),
      encrypted_review_note TEXT,
      consented_at TEXT NOT NULL,
      consent_version TEXT NOT NULL DEFAULT 'college-review-v1',
      reviewed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_review_institution_status ON institution_review_submissions(institution_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_institution_review_student ON institution_review_submissions(student_user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS institution_review_audit (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES institution_review_submissions(id),
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_review_audit_submission ON institution_review_audit(submission_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS institution_membership_audit (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      membership_id TEXT NOT NULL REFERENCES institution_memberships(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      target_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      from_role TEXT,
      to_role TEXT,
      from_status TEXT,
      to_status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_institution_membership_audit_institution ON institution_membership_audit(institution_id, created_at DESC);
  `);

  try { database.exec("ALTER TABLE institution_review_submissions ADD COLUMN consent_version TEXT NOT NULL DEFAULT 'college-review-v1'"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  try { database.exec("ALTER TABLE hostel_rooms ADD COLUMN manual_occupied_beds INTEGER NOT NULL DEFAULT 0 CHECK (manual_occupied_beds BETWEEN 0 AND 12)"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  database.exec(`
    CREATE TABLE IF NOT EXISTS hostel_room_occupancy_audit (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES hostel_rooms(id),
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      previous_manual_occupied_beds INTEGER NOT NULL,
      new_manual_occupied_beds INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_room_occupancy_audit_room ON hostel_room_occupancy_audit(room_id, created_at DESC);
  `);
  try { database.exec("ALTER TABLE hostel_applications ADD COLUMN consented_at TEXT NOT NULL DEFAULT ''"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  try { database.exec("ALTER TABLE hostel_applications ADD COLUMN consent_version TEXT NOT NULL DEFAULT 'hostel-application-v1'"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  try { database.exec("ALTER TABLE secure_documents ADD COLUMN document_category TEXT NOT NULL DEFAULT 'general'"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  try { database.exec("ALTER TABLE secure_documents ADD COLUMN expiry_date TEXT"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }

  const upload=multer({
    storage:multer.memoryStorage(),
    limits:{
      fileSize:MAX_DOCUMENT_BYTES,
      files:5
    },
    fileFilter:(req,file,cb)=>{
      if(ALLOWED_MIME.has(file.mimetype)) return cb(null,true);
      cb(new Error("Only PDF, JPEG, PNG and WebP documents are allowed."));
    }
  });

  function requireMfaProduction(req,res,next){
    if(!req.user?.mfaVerified){
      return res.status(403).json({success:false,message:"MFA verification is required for this action."});
    }
    next();
  }

  function getWalletState(userId){
    const row=database.prepare(`
      SELECT risk,locked,
        share_name,share_age,share_date_of_birth,share_address,
        share_email,share_phone,share_identity_id,share_college,
        share_student_id,share_government_id,share_verification_status
      FROM wallet_settings WHERE user_id=?
    `).get(userId);
    return {
      risk:Number(row?.risk || 0),
      locked:Boolean(row?.locked),
      shareData:{
        name:Boolean(row?.share_name), age:Boolean(row?.share_age), dateOfBirth:Boolean(row?.share_date_of_birth),
        address:Boolean(row?.share_address), email:Boolean(row?.share_email), phone:Boolean(row?.share_phone),
        identityId:Boolean(row?.share_identity_id), college:Boolean(row?.share_college), studentId:Boolean(row?.share_student_id),
        governmentId:Boolean(row?.share_government_id), verificationStatus:Boolean(row?.share_verification_status)
      }
    };
  }

  function assertWalletUnlocked(userId){
    const row=database.prepare(
      "SELECT locked FROM wallet_settings WHERE user_id = ?"
    ).get(userId);

    if(row?.locked){
      const error=new Error("Wallet is locked.");
      error.statusCode=423;
      throw error;
    }
  }

  /*
   * IDENTITY PROFILE
   * All 11 fields are stored server-side.
   * Sensitive values are encrypted before entering SQLite.
   */
  /*
   * Government verification integration readiness.
   * This endpoint reports configuration only; it never claims a document was
   * checked by a government source. Approval flags must be explicitly enabled
   * only after the relevant provider has authorized SecureID.
   */
  app.get("/api/identity/government-verification/readiness",requireAuth,requireMfaProduction,(req,res)=>{
    const panConfigured = Boolean(
      process.env.PAN_VERIFICATION_ENDPOINT &&
      process.env.PAN_VERIFICATION_CLIENT_ID &&
      process.env.PAN_VERIFICATION_CLIENT_SECRET
    );
    const aadhaarConfigured = Boolean(
      process.env.AADHAAR_AUTH_ENDPOINT &&
      process.env.AADHAAR_AUTH_CLIENT_ID &&
      process.env.AADHAAR_AUTH_CLIENT_SECRET
    );
    // An approval flag alone is not evidence of a usable approved integration.
    // Report approval only when the required provider configuration is also present.
    const panApproved = panConfigured && process.env.PAN_VERIFICATION_APPROVED === "true";
    const aadhaarApproved = aadhaarConfigured && process.env.AADHAAR_AUTH_APPROVED === "true";
    res.setHeader("Cache-Control","private, no-store");
    res.json({
      success:true,
      officialVerificationConnected:false,
      pan:{configured:panConfigured,approved:panApproved,live:false},
      aadhaar:{configured:aadhaarConfigured,approved:aadhaarApproved,live:false},
      message:"Readiness only. No government verification request has been performed."
    });
  });

  app.get("/api/identity/verification-status",requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const profileRow=database.prepare("SELECT encrypted_data,updated_at FROM identity_profiles WHERE user_id=?").get(req.user.id);
      const proofs=database.prepare("SELECT document_category,created_at FROM secure_documents WHERE user_id=? AND document_category IN ('student_id','institution_proof') AND deleted_at IS NULL ORDER BY created_at DESC").all(req.user.id);
      const hasStudent=proofs.some(x=>x.document_category==="student_id");
      const hasInstitution=proofs.some(x=>x.document_category==="institution_proof");
      // Verification status is derived from submitted proofs, never from user-editable profile text.
      const status=hasStudent && hasInstitution ? "Pending review" : (hasStudent || hasInstitution ? "Partially submitted" : "Not submitted");
      res.json({success:true,status,proofs:{studentId:hasStudent,institution:hasInstitution},updatedAt:profileRow?.updated_at||null});
    }catch(error){next(error);}
  });

  app.get("/api/identity/profile",requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const row=database.prepare(
        "SELECT encrypted_data,updated_at FROM identity_profiles WHERE user_id = ?"
      ).get(req.user.id);

      if(!row){
        return res.json({
          success:true,
          profile:{},
          updatedAt:null
        });
      }

      const profile=jsonDecrypt(JSON.parse(row.encrypted_data),key);
      const contextLabel=String(req.body?.contextLabel || "").trim().slice(0,160);

      res.json({
        success:true,
        profile,
        updatedAt:row.updated_at
      });
    }catch(error){
      next(error);
    }
  });

  app.put(
    "/api/identity/profile",
    enforceSameOrigin,
    requireAuth,
    requireMfaProduction,
    upload.none(),
    (req,res,next)=>{
      try{
        assertWalletUnlocked(req.user.id);

        const allowed=[
          "name",
          "age",
          "dateOfBirth",
          "address",
          "email",
          "phone",
          "identityId",
          "college",
          "studentId",
          "governmentId"
        ];

        const profile={};

        for(const field of allowed){
          const value=String(req.body?.[field] ?? "").trim();

          if(value.length>500){
            return res.status(400).json({
              success:false,
              message:`${field} is too long.`
            });
          }

          profile[field]=value;
        }

        const encrypted=jsonEncrypt(profile,key);
        const now=Date.now();

        database.prepare(`
          INSERT INTO identity_profiles
            (user_id,encrypted_data,created_at,updated_at)
          VALUES
            (?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET
            encrypted_data=excluded.encrypted_data,
            updated_at=excluded.updated_at
        `).run(
          req.user.id,
          JSON.stringify(encrypted),
          now,
          now
        );

        logEvent(req.user.id,"IDENTITY_PROFILE_UPDATED",req);

        res.json({
          success:true,
          profile,
          updatedAt:now
        });
      }catch(error){
        next(error);
      }
    }
  );

  /*
   * DOCUMENT LIST
   * Metadata only. The encrypted file itself never leaves the server
   * except through the authenticated download endpoint.
   */
  app.get("/api/documents",requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const documents=database.prepare(`
        SELECT
          id,
          original_name AS name,
          mime_type AS mimeType,
          size_bytes AS sizeBytes,
          document_category AS category,
          expiry_date AS expiryDate,
          created_at AS createdAt,
          (
            SELECT json_object(
              'id', c.id,
              'fileIntegrityStatus', c.file_integrity_status,
              'authenticityStatus', c.authenticity_status,
              'checkedAt', c.checked_at,
              'message', CASE
                WHEN c.file_integrity_status='passed'
                  THEN 'File integrity and file-type checks passed. Document authenticity is NOT verified.'
                ELSE 'File integrity checks failed. Document authenticity is NOT verified.'
              END
            )
            FROM identity_document_checks c
            WHERE c.document_id=secure_documents.id AND c.user_id=secure_documents.user_id
            ORDER BY c.checked_at DESC LIMIT 1
          ) AS verificationCheck
        FROM secure_documents
        WHERE user_id = ?
          AND deleted_at IS NULL
        ORDER BY created_at DESC
      `).all(req.user.id).map(document=>({
        ...document,
        verificationCheck: document.verificationCheck ? JSON.parse(document.verificationCheck) : null
      }));

      res.json({
        success:true,
        documents
      });
    }catch(error){
      next(error);
    }
  });

  /*
   * DOCUMENT METADATA UPDATE
   * Optional expiry date only; document bytes remain encrypted and unchanged.
   */
  app.put("/api/documents/:id/metadata",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    res.setHeader("Cache-Control","private, no-store");
    try{
      assertWalletUnlocked(req.user.id);
      const raw=req.body?.expiryDate;
      let expiryDate=null;
      if(raw!==undefined && raw!==null && raw!==""){
        if(typeof raw!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)){
          return res.status(400).json({success:false,message:"Enter the expiry date as YYYY-MM-DD."});
        }
        const parsed=new Date(raw+"T00:00:00.000Z");
        if(Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==raw){
          return res.status(400).json({success:false,message:"Choose a valid calendar date."});
        }
        expiryDate=raw;
      }

      const result=database.prepare(
        "UPDATE secure_documents SET expiry_date=? WHERE id=? AND user_id=? AND deleted_at IS NULL"
      ).run(expiryDate,String(req.params.id||""),req.user.id);
      if(result.changes===0){
        return res.status(404).json({success:false,message:"Document not found."});
      }
      logEvent(req.user.id,"DOCUMENT_EXPIRY_UPDATED",req,{hasExpiryDate:Boolean(expiryDate)});
      res.json({success:true,expiryDate});
    }catch(error){next(error);}
  });

  /*
   * PAN / AADHAAR DOCUMENT CHECK
   * This re-checks encrypted-file integrity only. It deliberately cannot
   * determine whether a PAN/Aadhaar was issued by a government authority.
   */
  app.post("/api/documents/:id/verify",enforceSameOrigin,requireAuth,requireMfaProduction,async (req,res,next)=>{
    res.setHeader("Cache-Control","private, no-store");
    try{
      assertWalletUnlocked(req.user.id);
      const id=String(req.params.id || "");
      const row=database.prepare(`
        SELECT id, original_name, mime_type, size_bytes, encrypted_path, document_category
        FROM secure_documents
        WHERE id=? AND user_id=? AND deleted_at IS NULL
      `).get(id,req.user.id);
      if(!row) return res.status(404).json({success:false,message:"Document not found."});
      if(!["pan","aadhaar"].includes(row.document_category)){
        return res.status(400).json({success:false,message:"Only PAN and Aadhaar documents can use this check."});
      }

      let fileIntegrityStatus="failed";
      let checkMessage="The stored file could not pass integrity checks. Upload a clear, supported PDF or image again.";
      try{
        const payload=JSON.parse(fs.readFileSync(row.encrypted_path,"utf8"));
        const buffer=decryptBuffer(payload,key);
        if(buffer.length===Number(row.size_bytes) && ALLOWED_MIME.has(row.mime_type)){
          // Verify the file signature against the stored MIME, not the filename.
          const actual = await fileTypeFromBuffer(buffer);
          const passed = Boolean(actual && actual.mime === row.mime_type && ALLOWED_MIME.has(actual.mime));
          const status = passed ? "passed" : "failed";
          const message = passed
            ? "File integrity and file-type checks passed. Document authenticity is NOT verified."
            : "The file content does not match its stored file type. Document authenticity is NOT verified.";
          const checkId = crypto.randomUUID();
          const now = Date.now();
          database.prepare("INSERT INTO identity_document_checks (id,user_id,document_id,document_category,file_integrity_status,authenticity_status,checked_at) VALUES (?,?,?,?,?,'not_verified',?)")
            .run(checkId, req.user.id, row.id, row.document_category, status, now);
          logEvent(req.user.id, "IDENTITY_DOCUMENT_CHECKED", req, { documentCategory: row.document_category, fileIntegrityStatus: status, authenticityVerified: false });
          return res.json({ success: true, check: { id: checkId, documentId: row.id, category: row.document_category, fileIntegrityStatus: status, authenticityStatus: "not_verified", checkedAt: now, message } });
        }
      }catch{}
      const checkId=crypto.randomUUID();
      const now=Date.now();
      database.prepare("INSERT INTO identity_document_checks (id,user_id,document_id,document_category,file_integrity_status,authenticity_status,checked_at) VALUES (?,?,?,?,?,'not_verified',?)")
        .run(checkId,req.user.id,row.id,row.document_category,fileIntegrityStatus,now);
      logEvent(req.user.id,"IDENTITY_DOCUMENT_CHECKED",req,{documentCategory:row.document_category,fileIntegrityStatus,authenticityVerified:false});
      res.json({success:true,check:{id:checkId,documentId:row.id,category:row.document_category,fileIntegrityStatus,authenticityStatus:"not_verified",checkedAt:now,message:checkMessage}});
    }catch(error){next(error);}
  });

  /*
   * DOCUMENT UPLOAD
   */
  app.post(
    "/api/documents",
    enforceSameOrigin,
    requireAuth,
    requireMfaProduction,
    (req,res,next)=>{
      assertWalletUnlocked(req.user.id);
      upload.array("documents",5)(req,res,(error)=>{
        if(error){
          if(error instanceof multer.MulterError){
            if(error.code==="LIMIT_FILE_SIZE"){
              return res.status(413).json({
                success:false,
                message:"Each document must be 10 MB or smaller."
              });
            }

            return res.status(400).json({
              success:false,
              message:error.message
            });
          }

          return res.status(400).json({
            success:false,
            message:error.message || "Document upload failed."
          });
        }

        next();
      });
    },
    async (req,res,next)=>{
      try{
        const files=req.files || [];
        const category=String(req.body?.category || "general").trim();

        if(!ALLOWED_DOCUMENT_CATEGORIES.has(category)){
          return res.status(400).json({success:false,message:"Choose a valid document category."});
        }

        if(files.length===0){
          return res.status(400).json({
            success:false,
            message:"Select at least one document."
          });
        }

        const saved=[];
        const createdPaths=[];

        const insert=database.prepare(`
          INSERT INTO secure_documents
          (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at)
          VALUES (?,?,?,?,?,?,?,?)
        `);

        // Validate the entire batch before writing any file or database row.
        for(const file of files){
          if(!ALLOWED_MIME.has(file.mimetype)){
            return res.status(400).json({
              success:false,
              message:"Unsupported document type."
            });
          }

          const detected=await fileTypeFromBuffer(file.buffer);
          if(!detected || !ALLOWED_MIME.has(detected.mime) || detected.mime !== file.mimetype){
            return res.status(400).json({
              success:false,
              message:"File content does not match its declared type."
            });
          }
        }

        // Keep a multi-file upload all-or-nothing if storage or SQLite fails.
        database.exec("BEGIN");
        try{
          for(const file of files){
            const id=crypto.randomUUID();
            const encrypted=encryptBuffer(file.buffer,key);
            const absolute=path.join(dataRoot,`${id}.json`);

            // Track the path before writing so cleanup also covers a partial write failure.
            createdPaths.push(absolute);
            fs.writeFileSync(absolute,JSON.stringify(encrypted),{
              encoding:"utf8",
              mode:0o600,
              flag:"wx"
            });

            const now=Date.now();
            insert.run(
              id,
              req.user.id,
              safeFilename(file.originalname),
              file.mimetype,
              file.size,
              absolute,
              category,
              now
            );

            saved.push({
              id,
              name:safeFilename(file.originalname),
              mimeType:file.mimetype,
              sizeBytes:file.size,
              category,
              createdAt:now
            });
          }
          database.exec("COMMIT");
        }catch(error){
          try{ database.exec("ROLLBACK"); }catch{}
          for(const filename of createdPaths){
            try{ fs.rmSync(filename,{force:true}); }catch{}
          }
          throw error;
        }

        for(const document of saved){
          logEvent(req.user.id,"DOCUMENT_UPLOADED",req);
        }

        res.status(201).json({
          success:true,
          documents:saved
        });
      }catch(error){
        next(error);
      }
    }
  );

  /* IDENTITY PROOF DOCUMENTS */
  app.post("/api/identity/proof",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    assertWalletUnlocked(req.user.id);
    upload.single("document")(req,res,async(error)=>{
      if(error){
        if(error instanceof multer.MulterError && error.code==="LIMIT_FILE_SIZE") return res.status(413).json({success:false,message:"Each document must be 10 MB or smaller."});
        return res.status(400).json({success:false,message:error.message || "Proof upload failed."});
      }
      try{
        const category=String(req.body?.category || "").trim();
        if(!["student_id","institution_proof"].includes(category)) return res.status(400).json({success:false,message:"Invalid identity proof category."});
        if(!req.file) return res.status(400).json({success:false,message:"Select a PDF or image first."});
        const detected=await fileTypeFromBuffer(req.file.buffer);
        if(!detected || !ALLOWED_MIME.has(detected.mime) || detected.mime !== req.file.mimetype) return res.status(400).json({success:false,message:"File content does not match its declared type."});
        const previous=database.prepare("SELECT id,encrypted_path FROM secure_documents WHERE user_id=? AND document_category=? AND deleted_at IS NULL").all(req.user.id,category);
        const id=crypto.randomUUID();
        const encrypted=encryptBuffer(req.file.buffer,key);
        const absolute=path.join(dataRoot,id+".json");
        const now=Date.now();
        // Keep the previous proof active unless both the new file and DB transaction succeed.
        const insertProof=database.prepare("INSERT INTO secure_documents (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at) VALUES (?,?,?,?,?,?,?,?)");
        let fileCreated=false;
        try {
          // Mark for cleanup before writing so partial writes are removed on failure.
          fileCreated=true;
          fs.writeFileSync(absolute,JSON.stringify(encrypted),{encoding:"utf8",mode:0o600,flag:"wx"});
          database.exec("BEGIN");
          database.prepare("UPDATE secure_documents SET deleted_at=? WHERE user_id=? AND document_category=? AND deleted_at IS NULL").run(now,req.user.id,category);
          insertProof.run(id,req.user.id,safeFilename(req.file.originalname),req.file.mimetype,req.file.size,absolute,category,now);
          database.exec("COMMIT");
        } catch(error) {
          try { database.exec("ROLLBACK"); } catch {}
          if(fileCreated) { try { fs.rmSync(absolute,{force:true}); } catch {} }
          throw error;
        }
        // Remove superseded encrypted files only after the DB commit succeeds.
        for(const old of previous){ try{ fs.rmSync(old.encrypted_path,{force:true}); }catch{} }
        logEvent(req.user.id,category==="student_id"?"STUDENT_ID_PROOF_UPDATED":"INSTITUTION_PROOF_UPDATED",req);
        res.status(201).json({success:true,document:{id,name:safeFilename(req.file.originalname),mimeType:req.file.mimetype,sizeBytes:req.file.size,category,createdAt:now}});
      }catch(error){ next(error); }
    });
  });

  /*
   * DOCUMENT DOWNLOAD
   * Ownership is checked before decryption.
   */
  app.get("/api/documents/:id",requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const row=database.prepare(`
        SELECT
          id,
          original_name,
          mime_type,
          encrypted_path
        FROM secure_documents
        WHERE id = ?
          AND user_id = ?
          AND deleted_at IS NULL
      `).get(req.params.id,req.user.id);

      if(!row){
        return res.status(404).json({
          success:false,
          message:"Document not found."
        });
      }

      if(!fs.existsSync(row.encrypted_path)){
        return res.status(404).json({
          success:false,
          message:"Document storage object is unavailable."
        });
      }

      const encrypted=JSON.parse(
        fs.readFileSync(row.encrypted_path,"utf8")
      );

      const plaintext=decryptBuffer(encrypted,key);

      // Share-purpose metadata is not part of a normal document record.

      res.setHeader("Content-Type",row.mime_type);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename(row.original_name)}"`
      );
      res.setHeader("Cache-Control","private, no-store");
      res.setHeader("X-Content-Type-Options","nosniff");

      logEvent(req.user.id,"DOCUMENT_ACCESSED",req);

      res.send(plaintext);
    }catch(error){
      next(error);
    }
  });


  /*
   * OWNER DOCUMENT VAULT
   * Owner-only cross-user access. Every listing/download attempt is audited.
   * Documents remain encrypted at rest; no public storage URLs are exposed.
   */
  function recordAdminDocumentAudit(req,{action,documentId=null,ownerUserId=null,outcome}) {
    database.prepare(`
      INSERT INTO admin_document_access_audit
      (id,actor_user_id,actor_email,action,document_id,owner_user_id,outcome,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      crypto.randomUUID(),
      req.user?.id || null,
      String(req.user?.email || "").slice(0,320) || null,
      action,
      documentId,
      ownerUserId,
      outcome,
      String(req.get("X-Request-Id") || "").slice(0,100) || null,
      Date.now()
    );
  }

  function requireOwnerDocumentAccess(req,res,next) {
    if(req.user?.role !== "owner") {
      try { recordAdminDocumentAudit(req,{action:req.params?.id ? "document_download" : "document_list",documentId:req.params?.id || null,outcome:"denied"}); } catch {}
      return res.status(403).json({success:false,code:"OWNER_REQUIRED",message:"Owner permissions are required."});
    }
    if(!req.user?.mfaVerified) {
      try { recordAdminDocumentAudit(req,{action:req.params?.id ? "document_download" : "document_list",documentId:req.params?.id || null,outcome:"denied"}); } catch {}
      return res.status(403).json({success:false,code:"MFA_REQUIRED",message:"MFA verification is required for Admin document access."});
    }
    next();
  }

  app.get("/api/admin/documents",requireAuth,requireOwnerDocumentAccess,(req,res,next)=>{
    try {
      const limit=Math.max(1,Math.min(100,Number.parseInt(req.query.limit,10)||50));
      const offset=Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
      const search=String(req.query.search||"").trim().slice(0,160);
      const category=String(req.query.category||"").trim().slice(0,40);
      const filters=["d.deleted_at IS NULL"];
      const params=[];
      if(search) {
        filters.push("(instr(lower(u.email), lower(?)) > 0 OR instr(lower(d.original_name), lower(?)) > 0 OR d.id = ?)");
        params.push(search,search,search);
      }
      if(category && ALLOWED_DOCUMENT_CATEGORIES.has(category)) {
        filters.push("d.document_category = ?");
        params.push(category);
      }
      const where=filters.join(" AND ");
      const total=Number(database.prepare(`SELECT COUNT(*) AS total FROM secure_documents d JOIN users u ON u.id=d.user_id WHERE ${where}`).get(...params).total||0);
      const documents=database.prepare(`
        SELECT d.id,d.user_id AS ownerUserId,u.email AS ownerEmail,
          d.original_name AS name,d.mime_type AS mimeType,d.size_bytes AS sizeBytes,
          d.document_category AS category,d.created_at AS createdAt
        FROM secure_documents d JOIN users u ON u.id=d.user_id
        WHERE ${where}
        ORDER BY d.created_at DESC,d.id ASC LIMIT ? OFFSET ?
      `).all(...params,limit,offset);
      recordAdminDocumentAudit(req,{action:"document_list",outcome:"success"});
      res.setHeader("Cache-Control","no-store");
      res.json({success:true,documents,total,limit,offset});
    } catch(error) {
      try { recordAdminDocumentAudit(req,{action:"document_list",outcome:"error"}); } catch {}
      next(error);
    }
  });

  app.get("/api/admin/documents/:id/download",requireAuth,requireOwnerDocumentAccess,(req,res,next)=>{
    try {
      const row=database.prepare(`
        SELECT id,user_id,original_name,mime_type,encrypted_path
        FROM secure_documents WHERE id=? AND deleted_at IS NULL LIMIT 1
      `).get(req.params.id);
      if(!row) {
        recordAdminDocumentAudit(req,{action:"document_download",documentId:String(req.params.id||"").slice(0,100),outcome:"not_found"});
        return res.status(404).json({success:false,message:"Document not found."});
      }
      if(!fs.existsSync(row.encrypted_path)) {
        recordAdminDocumentAudit(req,{action:"document_download",documentId:row.id,ownerUserId:row.user_id,outcome:"not_found"});
        return res.status(404).json({success:false,message:"Document storage object is unavailable."});
      }
      const encrypted=JSON.parse(fs.readFileSync(row.encrypted_path,"utf8"));
      const plaintext=decryptBuffer(encrypted,key);
      recordAdminDocumentAudit(req,{action:"document_download",documentId:row.id,ownerUserId:row.user_id,outcome:"success"});
      res.setHeader("Content-Type",row.mime_type);
      res.setHeader("Content-Disposition",`attachment; filename="${safeFilename(row.original_name)}"`);
      res.setHeader("Cache-Control","no-store");
      res.setHeader("Pragma","no-cache");
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Referrer-Policy","no-referrer");
      res.send(plaintext);
    } catch(error) {
      try { recordAdminDocumentAudit(req,{action:"document_download",documentId:String(req.params.id||"").slice(0,100),outcome:"error"}); } catch {}
      next(error);
    }
  });

  app.get("/api/admin/document-access-audit",requireAuth,requireOwnerDocumentAccess,(req,res,next)=>{
    try {
      const limit=Math.max(1,Math.min(100,Number.parseInt(req.query.limit,10)||50));
      const events=database.prepare(`
        SELECT id,actor_user_id AS actorUserId,actor_email AS actorEmail,action,
          document_id AS documentId,owner_user_id AS ownerUserId,outcome,
          request_id AS requestId,created_at AS createdAt
        FROM admin_document_access_audit ORDER BY created_at DESC LIMIT ?
      `).all(limit);
      res.setHeader("Cache-Control","no-store");
      res.json({success:true,events});
    } catch(error) { next(error); }
  });

  /*
   * DOCUMENT DELETE
   * Soft-delete DB row first, then physically remove encrypted object.
   */
  app.delete(
    "/api/documents/:id",
    enforceSameOrigin,
    requireAuth,
    requireMfaProduction,
    (req,res,next)=>{
      try{
        assertWalletUnlocked(req.user.id);

        const row=database.prepare(`
          SELECT encrypted_path
          FROM secure_documents
          WHERE id = ?
            AND user_id = ?
            AND deleted_at IS NULL
        `).get(req.params.id,req.user.id);

        if(!row){
          return res.status(404).json({
            success:false,
            message:"Document not found."
          });
        }

        const now=Date.now();

        database.prepare(`
          UPDATE secure_documents
          SET deleted_at = ?
          WHERE id = ?
            AND user_id = ?
        `).run(now,req.params.id,req.user.id);

        const affectedReviews = database.prepare(`
          SELECT id, institution_id AS institutionId, status
          FROM institution_review_submissions
          WHERE document_id = ? AND student_user_id = ? AND status IN ('submitted','needs_correction')
        `).all(req.params.id, req.user.id);
        const reviewUpdatedAt = new Date().toISOString();
        for (const review of affectedReviews) {
          database.prepare("UPDATE institution_review_submissions SET status='withdrawn',updated_at=? WHERE id=?")
            .run(reviewUpdatedAt, review.id);
          addInstitutionReviewAudit(review.id, review.institutionId, req.user.id, "document_deleted_withdrawal", review.status, "withdrawn");
        }

        try{
          fs.rmSync(row.encrypted_path,{force:true});
        }catch{}

        logEvent(req.user.id,"DOCUMENT_DELETED",req);

        res.json({success:true});
      }catch(error){
        next(error);
      }
    }
  );


  /* DOCUMENT SHARING */
  app.post("/api/document-share",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      enforceShareRateLimit(database,req,req.user.id);
      assertWalletUnlocked(req.user.id);
      const documentId=String(req.body?.documentId || "").trim();
      const reasonText=String(req.body?.reasonText || "").trim();
      const share_reason=String(req.body?.share_reason || "").trim().replace(/\s+/g," ");
      if(share_reason.length>160) return res.status(400).json({success:false,message:"Sharing purpose must be 160 characters or fewer."});
      const row=database.prepare("SELECT id,original_name,mime_type FROM secure_documents WHERE id=? AND user_id=? AND deleted_at IS NULL").get(documentId,req.user.id);
      if(!row) return res.status(404).json({success:false,message:"Document not found."});
      const now=Date.now();
      const expiresAt=new Date(now+SHARE_TTL_MS);
      const token=crypto.randomBytes(32).toString("base64url");
      const tokenHash=crypto.createHash("sha256").update(token,"utf8").digest("hex");
      database.prepare("INSERT INTO secure_document_shares (user_id,document_id,token_hash,created_at,expires_at,share_reason) VALUES (?,?,?,?,?,?)").run(req.user.id,row.id,tokenHash,new Date(now).toISOString(),expiresAt.toISOString(),share_reason || null);
      logEvent(req.user.id,"DOCUMENT_SHARED",req);
      if(typeof ensureSecurityNotification==="function") ensureSecurityNotification(req.user.id,"DOCUMENT_SHARE_CREATED","Document shared","A secure document share was created. Review Share management to check its purpose and expiry.");
      // Share tokens are bearer credentials: never allow browsers or intermediaries to cache responses containing them.
      res.setHeader("Cache-Control","no-store");
      res.setHeader("Pragma","no-cache");
      res.json({success:true,shareToken:token,shareExpiresAt:expiresAt.toISOString(),share_reason:share_reason || "",document:{id:row.id,name:row.original_name,mimeType:row.mime_type}});
    }catch(error){ next(error); }
  });

  app.post("/api/document-share/revoke",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    try{
      assertWalletUnlocked(req.user.id);
      const token=String(req.body?.shareToken || "").trim();
      const tokenHash=crypto.createHash("sha256").update(token,"utf8").digest("hex");
      const result=database.prepare("UPDATE secure_document_shares SET revoked_at=? WHERE token_hash=? AND user_id=? AND revoked_at IS NULL").run(new Date().toISOString(),tokenHash,req.user.id);
      if(!result.changes) return res.status(404).json({success:false,message:"Document share not found."});
      logEvent(req.user.id,"DOCUMENT_SHARE_REVOKED",req);
      if(typeof ensureSecurityNotification==="function") ensureSecurityNotification(req.user.id,"SHARE_REVOKED","Document share revoked","A document share was revoked.");
      res.json({success:true});
    }catch(error){ next(error); }
  });

  app.get("/api/document-share/:token",(req,res,next)=>{
    // Apply no-cache protections to both successful and failed bearer-token lookups.
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    try{
      const token=String(req.params.token || "");
      if(!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return res.status(404).json({success:false,message:"Document share not found."});
      const tokenHash=crypto.createHash("sha256").update(token,"utf8").digest("hex");
      const row=database.prepare("SELECT s.document_id,s.user_id,s.expires_at,s.revoked_at,s.share_reason,d.original_name,d.mime_type,d.encrypted_path FROM secure_document_shares s JOIN secure_documents d ON d.id=s.document_id WHERE s.token_hash=? AND s.user_id=d.user_id AND d.deleted_at IS NULL").get(tokenHash);
      const expiresAt=Date.parse(row?.expires_at || "");
      if(!row || row.revoked_at || !Number.isFinite(expiresAt) || Date.now()>=expiresAt) return res.status(404).json({success:false,message:"Document share not found or expired."});
      if(!fs.existsSync(row.encrypted_path)) return res.status(404).json({success:false,message:"Shared document unavailable."});
      const plaintext=decryptBuffer(JSON.parse(fs.readFileSync(row.encrypted_path,"utf8")),key);
      database.prepare("UPDATE secure_document_shares SET accessed_at=?, access_count=COALESCE(access_count,0)+1 WHERE token_hash=?").run(new Date().toISOString(),tokenHash);
      logEvent(row.user_id,"DOCUMENT_SHARE_ACCESSED",req);
      res.setHeader("Content-Type",row.mime_type);
      res.setHeader("Content-Disposition",`inline; filename="${safeFilename(row.original_name)}"`);
      res.setHeader("X-SecureID-Share-Reason",String(row.share_reason || "").slice(0,160));
      res.setHeader("X-SecureID-Share-Expires-At",row.expires_at);
      res.setHeader("Cache-Control","no-store");
      res.setHeader("Pragma","no-cache");
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Referrer-Policy","no-referrer");
      res.send(plaintext);
    }catch(error){ next(error); }
  });

  /*
   * PRODUCTION WALLET SHARING
   * Short-lived, encrypted, revocable share tokens.
   */
  const SHARE_TTL_MS = 15 * 60 * 1000;

  const shareFields = [
    "name",
    "age",
    "dateOfBirth",
    "address",
    "email",
    "phone",
    "identityId",
    "college",
    "studentId",
    "governmentId",
    "verificationStatus"
  ];

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS secure_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        encrypted_payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_secure_shares_token
        ON secure_shares(token_hash);
      CREATE INDEX IF NOT EXISTS idx_secure_shares_user
        ON secure_shares(user_id);
    `);
  } catch (shareMigrationError) {
    console.error(JSON.stringify({
      level:"error",
      event:"secure_share_migration_failed",
      message:shareMigrationError?.message || String(shareMigrationError)
    }));
  }

  function shareTokenHash(token){
    return crypto.createHash("sha256").update(token,"utf8").digest("hex");
  }

  function maskGovernmentId(value){
    const text=String(value || "").trim();
    if(!text) return "";
    if(text.length <= 4) return "****";
    return "*".repeat(Math.max(4,text.length-4)) + text.slice(-4);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS secure_document_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES secure_documents(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      share_reason TEXT,
      accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_secure_document_shares_user
      ON secure_document_shares(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_secure_document_shares_token
      ON secure_document_shares(token_hash);
  `);

  try {
    database.exec("ALTER TABLE secure_shares ADD COLUMN accessed_at TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE secure_shares ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0");
  } catch {}
  try {
    database.exec("ALTER TABLE secure_document_shares ADD COLUMN accessed_at TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE secure_document_shares ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0");
  } catch {}

  try { database.exec("ALTER TABLE secure_shares ADD COLUMN share_reason TEXT"); } catch {}
  try { database.exec("ALTER TABLE secure_document_shares ADD COLUMN share_reason TEXT"); } catch {}
  app.get("/api/security/shares",requireAuth,requireMfaProduction,(req,res,next)=>{
    res.setHeader("Cache-Control","private, no-store");
    res.setHeader("Pragma","no-cache");
    try{
      const identity=database.prepare("SELECT id,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,accessed_at AS accessedAt,access_count AS accessCount,share_reason AS shareReason,encrypted_payload AS encryptedPayload FROM secure_shares WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(req.user.id).map(row=>{
        let claims=[];
        let contextLabel="";
        try { const payload=jsonDecrypt(JSON.parse(row.encryptedPayload),key); claims=Object.keys(payload.claims || {}); contextLabel=payload.contextLabel || ""; } catch {}
        return {id:String(row.id),type:"identity",createdAt:row.createdAt,expiresAt:row.expiresAt,revokedAt:row.revokedAt,accessedAt:row.accessedAt,accessCount:Number(row.accessCount||0),contextLabel,claims,verificationBadge:{verified:false,label:"Shared by account owner",assurance:"Identity claims have not been independently verified."}};
      });
      const documents=database.prepare("SELECT s.id,s.created_at AS createdAt,s.expires_at AS expiresAt,s.revoked_at AS revokedAt,s.accessed_at AS accessedAt,s.access_count AS accessCount,s.share_reason AS shareReason,d.original_name AS name FROM secure_document_shares s JOIN secure_documents d ON d.id=s.document_id WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 100").all(req.user.id).map(row=>({id:String(row.id),type:"document",name:row.name,createdAt:row.createdAt,expiresAt:row.expiresAt,revokedAt:row.revokedAt,accessedAt:row.accessedAt,accessCount:Number(row.accessCount||0),contextLabel:row.shareReason||""}));
      res.json({success:true,shares:[...identity,...documents]});
    }catch(error){next(error);}
  });

  app.post("/api/security/shares/revoke",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    res.setHeader("Cache-Control","private, no-store");
    res.setHeader("Pragma","no-cache");
    try{
      const type=String(req.body?.type||"");
      const id=String(req.body?.id||"");
      if(!/^(identity|document)$/.test(type)||!/^[0-9]+$/.test(id)) return res.status(400).json({success:false,message:"Invalid share."});
      const table=type==="identity"?"secure_shares":"secure_document_shares";
      const result=database.prepare(`UPDATE ${table} SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL`).run(new Date().toISOString(),Number(id),req.user.id);
      if(!result.changes) return res.status(404).json({success:false,message:"Share not found or already revoked."});
      logEvent(req.user.id,type==="identity"?"IDENTITY_SHARE_REVOKED":"DOCUMENT_SHARE_REVOKED",req,{shareId:id});
      if(typeof ensureSecurityNotification==="function") ensureSecurityNotification(req.user.id,"SHARE_REVOKED","Secure share revoked","A secure share was revoked and can no longer be used.");
      res.json({success:true});
    }catch(error){next(error);}
  });

  app.get("/api/wallet",requireAuth,(req,res,next)=>{
    try{
      const row=database.prepare(`
        SELECT risk,locked,
          share_name,share_age,share_date_of_birth,share_address,
          share_email,share_phone,share_identity_id,share_college,
          share_student_id,share_government_id,share_verification_status
        FROM wallet_settings
        WHERE user_id=?
      `).get(req.user.id);

      res.json({
        success:true,
        risk:Number(row?.risk || 0),
        locked:Boolean(row?.locked),
        shareData:{
          name:Boolean(row?.share_name),
          age:Boolean(row?.share_age),
          dateOfBirth:Boolean(row?.share_date_of_birth),
          address:Boolean(row?.share_address),
          email:Boolean(row?.share_email),
          phone:Boolean(row?.share_phone),
          identityId:Boolean(row?.share_identity_id),
          college:Boolean(row?.share_college),
          studentId:Boolean(row?.share_student_id),
          governmentId:Boolean(row?.share_government_id),
          verificationStatus:Boolean(row?.share_verification_status)
        }
      });
    }catch(error){ next(error); }
  });

  
// SECUREID_LOCK_REVOKES_SHARES
app.post("/api/wallet/lock", enforceSameOrigin, requireAuth, requireMfaProduction, async (req, res, next) => {
  try {
    const locked = Boolean(req.body?.locked);

    database.prepare(
      "UPDATE wallet_settings SET locked = ? WHERE user_id = ?"
    ).run(locked ? 1 : 0, req.user.id);

    if (locked) {
      database.prepare(
        "UPDATE secure_shares SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL"
      ).run(req.user.id);
      database.prepare(
        "UPDATE secure_document_shares SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL"
      ).run(req.user.id);
    }

    if (typeof logEvent === "function") {
      logEvent(req.user.id, locked ? "WALLET_LOCKED" : "WALLET_UNLOCKED",req);
    }
    if(typeof ensureSecurityNotification==="function") ensureSecurityNotification(req.user.id,locked?"WALLET_LOCKED":"WALLET_UNLOCKED",locked?"Wallet locked":"Wallet unlocked",locked?"Identity sharing was paused and active shares were revoked.":"Your SecureID wallet was unlocked.");

    res.json({
      success: true,
      locked,
      sharesRevoked: locked,
      wallet: getWalletState(req.user.id)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/wallet/share",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      enforceShareRateLimit(database, req, req.user.id);
      assertWalletUnlocked(req.user.id);

      if(!req.user.mfaVerified){
        return res.status(403).json({
          success:false,
          message:"MFA verification is required before sharing identity data."
        });
      }

      const row=database.prepare(
        "SELECT encrypted_data FROM identity_profiles WHERE user_id=?"
      ).get(req.user.id);

      if(!row){
        return res.status(404).json({
          success:false,
          message:"Identity profile not found."
        });
      }

      const profile=jsonDecrypt(JSON.parse(row.encrypted_data),key);
      const share_reason=String(req.body?.share_reason || "").trim().replace(/\s+/g," ");
      if(share_reason.length>160) return res.status(400).json({success:false,message:"Share share_reason must be 160 characters or fewer."});
      const selected={};

      for(const field of shareFields){
        if(req.body?.[field] === true){
          if(field === "verificationStatus"){
            const proofRows=database.prepare(
              "SELECT document_category FROM secure_documents WHERE user_id=? AND document_category IN ('student_id','institution_proof') AND deleted_at IS NULL"
            ).all(req.user.id);
            const hasStudentProof=proofRows.some((item)=>item.document_category==="student_id");
            const hasInstitutionProof=proofRows.some((item)=>item.document_category==="institution_proof");
            // This reports document-submission progress only. It must never imply
            // that a college or government source has independently verified the person.
            selected.verificationStatus=hasStudentProof && hasInstitutionProof
              ? "Student and institution proofs submitted — pending independent review"
              : hasStudentProof || hasInstitutionProof
                ? "Proofs partially submitted — not verified"
                : "No student verification proofs submitted";
          }else{
            const value=field==="governmentId"
              ? maskGovernmentId(profile[field])
              : profile[field] ?? "";
            // Never include empty claims in a share payload. A selected field
            // without a value should not render as a blank identity claim.
            if(String(value).trim()) selected[field]=value;
          }
        }
      }

      if(!Object.values(selected).some((value)=>String(value ?? "").trim())){
        return res.status(400).json({
          success:false,
          message:"Select at least one identity field to share."
        });
      }

      const now=Date.now();
      const expiresAt=new Date(now+SHARE_TTL_MS);
      const token=crypto.randomBytes(32).toString("base64url");

      database.prepare(`
        UPDATE wallet_settings SET
          share_name=?,
          share_age=?,
          share_date_of_birth=?,
          share_address=?,
          share_email=?,
          share_phone=?,
          share_identity_id=?,
          share_college=?,
          share_student_id=?,
          share_government_id=?,
          share_verification_status=?
        WHERE user_id=?
      `).run(
        req.body?.name===true?1:0,
        req.body?.age===true?1:0,
        req.body?.dateOfBirth===true?1:0,
        req.body?.address===true?1:0,
        req.body?.email===true?1:0,
        req.body?.phone===true?1:0,
        req.body?.identityId===true?1:0,
        req.body?.college===true?1:0,
        req.body?.studentId===true?1:0,
        req.body?.governmentId===true?1:0,
        req.body?.verificationStatus===true?1:0,
        req.user.id
      );

      database.prepare(`
        INSERT INTO secure_shares
          (user_id,token_hash,encrypted_payload,created_at,expires_at,share_reason)
        VALUES (?,?,?,?,?,?)
      `).run(
        req.user.id,
        shareTokenHash(token),
        JSON.stringify(jsonEncrypt({
          claims:selected,
          ownerUserId:req.user.id,
          contextLabel:share_reason
        },key)),
        new Date(now).toISOString(),
        expiresAt.toISOString(),
        share_reason
      );

      logEvent(req.user.id,"IDENTITY_SHARED",req);
      if(typeof ensureSecurityNotification==="function") ensureSecurityNotification(req.user.id,"SHARE_CREATED","Identity share created","A new secure identity share was created. Check its purpose and expiry in Share management.");

      // Share tokens are bearer credentials; keep the creation response out of browser and proxy caches.
      res.setHeader("Cache-Control","no-store");
      res.setHeader("Pragma","no-cache");
      res.json({
        success:true,
        shareToken:token,
        shareExpiresAt:expiresAt.toISOString(),
        wallet:getWalletState(req.user.id)
      });
    }catch(error){ next(error); }
  });

  app.post("/api/wallet/share/revoke",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    try{
      database.prepare(`
        UPDATE secure_shares
        SET revoked_at=?
        WHERE user_id=? AND revoked_at IS NULL
      `).run(new Date().toISOString(),req.user.id);

      logEvent(req.user.id,"IDENTITY_SHARES_REVOKED",req);

      res.json({success:true});
    }catch(error){ next(error); }
  });

  app.get("/api/share/:token",(req,res,next)=>{
    // Identity claims and bearer tokens must never be cached, including 404 responses.
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    try{
      const token=String(req.params.token || "");

      if(!/^[A-Za-z0-9_-]{30,100}$/.test(token)){
        return res.status(404).json({
          success:false,
          message:"Share not found."
        });
      }

      const row=database.prepare(`
        SELECT encrypted_payload,created_at,expires_at,revoked_at
        FROM secure_shares
        WHERE token_hash=?
      `).get(shareTokenHash(token));

      if(!row || row.revoked_at || Date.now() >= Date.parse(row.expires_at)){
        return res.status(404).json({
          success:false,
          message:"Share not found or expired."
        });
      }

      const payload=jsonDecrypt(JSON.parse(row.encrypted_payload),key);

      database.prepare("UPDATE secure_shares SET accessed_at=?, access_count=COALESCE(access_count,0)+1 WHERE token_hash=?").run(new Date().toISOString(),shareTokenHash(token));
      logEvent(payload.ownerUserId,"IDENTITY_SHARE_ACCESSED",req);

      res.setHeader("Cache-Control","no-store");
      res.setHeader("X-Content-Type-Options","nosniff");

      res.json({
        success:true,
        claims:payload.claims,
        contextLabel:payload.contextLabel || "",
        verificationBadge:{
          verified:false,
          label:"Shared by account owner",
          assurance:"Identity claims are user-provided and have not been independently verified.",
          issuedAt:row.created_at,
          expiresAt:row.expires_at
        },
        createdAt:row.created_at,
        expiresAt:row.expires_at
      });
    }catch(error){ next(error); }
  });

  /*
   * College pilot interest capture. This stores only institution/workflow
   * metadata, never identity documents or student identity numbers. Each
   * account can read only its own requests; this is not yet a college review
   * portal or a confirmed paid partnership.
   */
  const allowedPilotWorkflows = new Set([
    "Student onboarding",
    "Document submission tracking",
    "Staff review queue",
    "Shareable student credentials",
    "Audit history and reports"
  ]);
  const allowedPilotRoles = new Set([
    "Student", "Faculty", "College administrator", "IT / security team", "Other"
  ]);
  const allowedStudentCounts = new Set([
    "Under 500", "500–2,000", "2,001–10,000", "Over 10,000", "Not sure"
  ]);
  function pilotRequestView(row) {
    const data = jsonDecrypt(JSON.parse(row.encrypted_data), key);
    return {
      id: row.id,
      institutionName: data.institutionName,
      role: data.role,
      studentCount: data.studentCount,
      workflows: data.workflows,
      notes: data.notes,
      status: row.status,
      createdAt: row.created_at
    };
  }
  /*
   * INSTITUTION MEMBERSHIP SELF-VIEW
   * Roles are provisioned out-of-band by a trusted operator. The public API
   * intentionally exposes no invite, role-change, or membership-creation route.
   */
  app.get("/api/institutions/memberships", requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      const memberships = database.prepare(`
        SELECT
          m.institution_id AS institutionId,
          i.name AS institutionName,
          m.role AS role,
          m.status AS status,
          m.created_at AS joinedAt
        FROM institution_memberships m
        INNER JOIN institutions i ON i.id = m.institution_id
        WHERE m.user_id = ?
        ORDER BY i.name COLLATE NOCASE
        LIMIT 50
      `).all(req.user.id);
      res.json({ success: true, memberships });
    } catch (error) { next(error); }
  });

  app.get("/api/college-pilot/requests", requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      const rows = database.prepare(
        "SELECT id, encrypted_data, status, created_at FROM college_pilot_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 25"
      ).all(req.user.id);
      res.json({ success: true, requests: rows.map(pilotRequestView) });
    } catch (error) { next(error); }
  });
  app.post("/api/college-pilot/requests", enforceSameOrigin, requireAuth, requireMfaProduction, (req, res, next) => {
    try {
      const body = req.body || {};
      const institutionName = String(body.institutionName || "").trim();
      const role = String(body.role || "");
      const studentCount = String(body.studentCount || "");
      const workflows = Array.isArray(body.workflows) ? [...new Set(body.workflows.map(String))] : [];
      const notes = String(body.notes || "").trim();
      if (!institutionName || institutionName.length > 120) {
        return res.status(400).json({ success: false, message: "Enter an institution name up to 120 characters." });
      }
      if (!allowedPilotRoles.has(role) || !allowedStudentCounts.has(studentCount) ||
          workflows.length < 1 || workflows.length > allowedPilotWorkflows.size ||
          workflows.some(item => !allowedPilotWorkflows.has(item)) || notes.length > 500) {
        return res.status(400).json({ success: false, message: "Review the pilot form fields and try again." });
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const payload = { institutionName, role, studentCount, workflows, notes };
      database.prepare(
        "INSERT INTO college_pilot_requests (id, user_id, encrypted_data, status, created_at, updated_at) VALUES (?, ?, ?, 'received', ?, ?)"
      ).run(id, req.user.id, JSON.stringify(jsonEncrypt(payload, key)), now, now);
      if (typeof logEvent === "function") logEvent(req.user.id, "COLLEGE_PILOT_INTEREST_CREATED", req);
      res.setHeader("Cache-Control", "private, no-store");
      res.status(201).json({
        success: true,
        request: { id, ...payload, status: "received", createdAt: now }
      });
    } catch (error) { next(error); }
  });


  // Trusted SecureID operator provisioning. No public self-enrollment or self-role assignment.
  function requireTrustedInstitutionOperator(req, res, next) {
    if (req.user?.role !== "owner") return res.status(403).json({ success: false, code: "OWNER_REQUIRED", message: "Trusted SecureID operator access is required." });
    if (!req.user?.mfaVerified) return res.status(403).json({ success: false, code: "MFA_REQUIRED", message: "MFA verification is required." });
    next();
  }
  function getInstitutionMembership(userId, institutionId) {
    return database.prepare("SELECT institution_id, role, status FROM institution_memberships WHERE user_id=? AND institution_id=? LIMIT 1").get(userId, institutionId);
  }
  function addInstitutionReviewAudit(submissionId, institutionId, actorUserId, action, fromStatus = null, toStatus = null) {
    database.prepare("INSERT INTO institution_review_audit (id,submission_id,institution_id,actor_user_id,action,from_status,to_status,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), submissionId, institutionId, actorUserId, action, fromStatus, toStatus, new Date().toISOString());
  }
  app.post("/api/admin/institutions", enforceSameOrigin, requireAuth, requireTrustedInstitutionOperator, (req,res,next) => {
    try {
      const name=String(req.body?.name||"").trim();
      if(!name||name.length>160) return res.status(400).json({success:false,message:"Institution name must be 1–160 characters."});
      const id=crypto.randomUUID(), now=new Date().toISOString();
      database.prepare("INSERT INTO institutions(id,name,created_at) VALUES(?,?,?)").run(id,name,now);
      if(typeof logEvent==="function") logEvent(req.user.id,"INSTITUTION_CREATED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.status(201).json({success:true,institution:{id,name,createdAt:now}});
    } catch(error){next(error);}
  });
  app.post("/api/admin/institutions/:institutionId/memberships", enforceSameOrigin, requireAuth, requireTrustedInstitutionOperator, (req,res,next) => {
    try {
      const institutionId=String(req.params.institutionId||""), userId=String(req.body?.userId||""), role=String(req.body?.role||"");
      if(!userId||userId.length>128||!["student","reviewer","institution_admin","read_only"].includes(role)) return res.status(400).json({success:false,message:"Choose a valid account and role."});
      const institution=database.prepare("SELECT id,name FROM institutions WHERE id=?").get(institutionId);
      const user=database.prepare("SELECT id FROM users WHERE id=?").get(userId);
      if(!institution||!user) return res.status(404).json({success:false,message:"Institution or user account was not found."});
      if(database.prepare("SELECT id FROM institution_memberships WHERE institution_id=? AND user_id=?").get(institutionId,userId)) return res.status(409).json({success:false,message:"Membership already exists."});
      const id=crypto.randomUUID(), now=new Date().toISOString();
      database.prepare("INSERT INTO institution_memberships(id,institution_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)").run(id,institutionId,userId,role,now,now);
      database.prepare("INSERT INTO institution_membership_audit(id,institution_id,membership_id,actor_user_id,target_user_id,action,to_role,to_status,created_at) VALUES(?,?,?,?,?,'membership_provisioned',?,'active',?)")
        .run(crypto.randomUUID(),institutionId,id,req.user.id,userId,role,now);
      if(typeof logEvent==="function") logEvent(req.user.id,"INSTITUTION_MEMBERSHIP_PROVISIONED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.status(201).json({success:true,membership:{id,institutionId,institutionName:institution.name,userId,role,status:"active",joinedAt:now}});
    } catch(error){next(error);}
  });

  app.get("/api/admin/institutions", requireAuth, requireTrustedInstitutionOperator, (req,res,next) => {
    try {
      const institutions=database.prepare(`
        SELECT i.id,i.name,i.created_at AS createdAt,
          (SELECT COUNT(*) FROM institution_memberships m WHERE m.institution_id=i.id) AS membershipCount
        FROM institutions i ORDER BY i.name COLLATE NOCASE LIMIT 200
      `).all();
      const memberships=database.prepare(`
        SELECT m.id,m.institution_id AS institutionId,m.user_id AS userId,u.email,
          m.role,m.status,m.created_at AS joinedAt,m.updated_at AS updatedAt
        FROM institution_memberships m INNER JOIN users u ON u.id=m.user_id
        ORDER BY m.institution_id,m.created_at DESC LIMIT 500
      `).all();
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,institutions,memberships});
    } catch(error){next(error);}
  });
  app.patch("/api/admin/institutions/:institutionId/memberships/:membershipId", enforceSameOrigin, requireAuth, requireTrustedInstitutionOperator, (req,res,next) => {
    try {
      const institutionId=String(req.params.institutionId||""), membershipId=String(req.params.membershipId||"");
      const role=req.body?.role===undefined?null:String(req.body.role), status=req.body?.status===undefined?null:String(req.body.status);
      if(role!==null&&!["student","reviewer","institution_admin","read_only"].includes(role)) return res.status(400).json({success:false,message:"Choose a valid institution role."});
      if(status!==null&&!["active","suspended"].includes(status)) return res.status(400).json({success:false,message:"Membership status must be active or suspended."});
      if(role===null&&status===null) return res.status(400).json({success:false,message:"Provide a role or membership status to update."});
      const current=database.prepare("SELECT id,institution_id,user_id,role,status FROM institution_memberships WHERE id=? AND institution_id=?").get(membershipId,institutionId);
      if(!current) return res.status(404).json({success:false,message:"Institution membership was not found."});
      const nextRole=role||current.role,nextStatus=status||current.status,now=new Date().toISOString();
      database.prepare("UPDATE institution_memberships SET role=?,status=?,updated_at=? WHERE id=? AND institution_id=?").run(nextRole,nextStatus,now,membershipId,institutionId);
      database.prepare("INSERT INTO institution_membership_audit(id,institution_id,membership_id,actor_user_id,target_user_id,action,from_role,to_role,from_status,to_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(crypto.randomUUID(),institutionId,membershipId,req.user.id,current.user_id,"membership_updated",current.role,nextRole,current.status,nextStatus,now);
      if(typeof logEvent==="function") logEvent(req.user.id,"INSTITUTION_MEMBERSHIP_UPDATED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,membership:{id:membershipId,institutionId,userId:current.user_id,role:nextRole,status:nextStatus,updatedAt:now}});
    } catch(error){next(error);}
  });
  app.get("/api/admin/institutions/:institutionId/audit", requireAuth, requireTrustedInstitutionOperator, (req,res,next) => {
    try {
      const rows=database.prepare(`
        SELECT a.action,a.from_role AS fromRole,a.to_role AS toRole,a.from_status AS fromStatus,
          a.to_status AS toStatus,a.created_at AS createdAt,u.email AS targetEmail
        FROM institution_membership_audit a
        INNER JOIN users u ON u.id=a.target_user_id
        WHERE a.institution_id=? ORDER BY a.created_at DESC LIMIT 200
      `).all(String(req.params.institutionId||""));
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,audit:rows});
    } catch(error){next(error);}
  });

  app.get("/api/institutions/my-review-submissions", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const rows=database.prepare(`
        SELECT s.id,s.institution_id AS institutionId,i.name AS institutionName,s.document_id AS documentId,
          d.original_name AS documentName,d.document_category AS documentCategory,s.purpose,s.status,
          s.encrypted_review_note AS encryptedReviewNote,s.consent_version AS consentVersion,s.consented_at AS consentedAt,s.created_at AS createdAt,s.updated_at AS updatedAt
        FROM institution_review_submissions s
        JOIN institutions i ON i.id=s.institution_id
        JOIN secure_documents d ON d.id=s.document_id AND d.user_id=s.student_user_id
        WHERE s.student_user_id=? ORDER BY s.created_at DESC LIMIT 100
      `).all(req.user.id);
      const submissions=rows.map(row=>{let reviewNote="";if(row.encryptedReviewNote){try{reviewNote=String(jsonDecrypt(JSON.parse(row.encryptedReviewNote),key)?.note||"");}catch{}}return {...row,encryptedReviewNote:undefined,reviewNote};});
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,submissions});
    } catch(error){next(error);}
  });
  app.post("/api/institutions/review-submissions", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.body?.institutionId||""), documentId=String(req.body?.documentId||""), purpose=String(req.body?.purpose||"").trim();
      const allowedPurposes = new Set(["College enrollment review","Scholarship application","Hostel admission","Exam registration","Student identity record"]);
      if(req.body?.consent!==true) return res.status(400).json({success:false,message:"Explicit consent is required before submitting a document for review."});
      if(!institutionId||institutionId.length>128||!documentId||documentId.length>128||!allowedPurposes.has(purpose)) return res.status(400).json({success:false,message:"Choose an institution, one of your documents and a purpose up to 160 characters."});
      const membership=getInstitutionMembership(req.user.id,institutionId);
      if(!membership||membership.status!=="active"||membership.role!=="student") return res.status(403).json({success:false,code:"ACTIVE_STUDENT_MEMBERSHIP_REQUIRED",message:"An active student membership is required."});
      const doc=database.prepare("SELECT id,original_name,document_category FROM secure_documents WHERE id=? AND user_id=? AND deleted_at IS NULL").get(documentId,req.user.id);
      if(!doc) return res.status(404).json({success:false,message:"Document was not found in your active Document Vault."});
      const id=crypto.randomUUID(),now=new Date().toISOString();
      database.prepare("INSERT INTO institution_review_submissions(id,institution_id,student_user_id,document_id,purpose,status,consented_at,consent_version,created_at,updated_at) VALUES(?,?,?,?,?,'submitted',?,?,?,?)").run(id,institutionId,req.user.id,documentId,purpose,now,COLLEGE_REVIEW_CONSENT_VERSION,now,now);
      addInstitutionReviewAudit(id,institutionId,req.user.id,"student_submitted",null,"submitted");
      if(typeof logEvent==="function") logEvent(req.user.id,"INSTITUTION_DOCUMENT_SUBMITTED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.status(201).json({success:true,submission:{id,institutionId,documentId,documentName:doc.original_name,documentCategory:doc.document_category,purpose,status:"submitted",consentedAt:now,consentVersion:COLLEGE_REVIEW_CONSENT_VERSION,createdAt:now}});
    } catch(error){next(error);}
  });
  app.delete("/api/institutions/review-submissions/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,student_user_id,status FROM institution_review_submissions WHERE id=?").get(String(req.params.id||""));
      if(!row||row.student_user_id!==req.user.id) return res.status(404).json({success:false,message:"Review submission was not found."});
      if(!["submitted","needs_correction"].includes(row.status)) return res.status(409).json({success:false,message:"This review can no longer be withdrawn."});
      const now=new Date().toISOString();
      database.prepare("UPDATE institution_review_submissions SET status='withdrawn',updated_at=? WHERE id=? AND student_user_id=?").run(now,row.id,req.user.id);
      addInstitutionReviewAudit(row.id,row.institution_id,req.user.id,"student_withdrew",row.status,"withdrawn");
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,status:"withdrawn"});
    } catch(error){next(error);}
  });
  app.get("/api/institutions/review-queue", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const memberships=database.prepare("SELECT institution_id FROM institution_memberships WHERE user_id=? AND status='active' AND role IN ('reviewer','institution_admin','read_only')").all(req.user.id);
      const ids=memberships.map(row=>row.institution_id);
      if(!ids.length) return res.status(403).json({success:false,code:"REVIEWER_MEMBERSHIP_REQUIRED",message:"An active reviewer, institution administrator or read-only membership is required."});
      const requested=String(req.query.institutionId||"");
      if(requested&&!ids.includes(requested)) return res.status(403).json({success:false,message:"You do not have access to this institution."});
      const visible=requested?[requested]:ids, placeholders=visible.map(()=>"?").join(",");
      const rows=database.prepare(`
        SELECT s.id,s.institution_id AS institutionId,i.name AS institutionName,s.student_user_id AS studentUserId,
          s.document_id AS documentId,d.original_name AS documentName,d.document_category AS documentCategory,
          d.size_bytes AS documentSizeBytes,s.purpose,s.status,s.created_at AS createdAt,s.updated_at AS updatedAt,
          s.encrypted_review_note AS encryptedReviewNote
        FROM institution_review_submissions s JOIN institutions i ON i.id=s.institution_id
        JOIN secure_documents d ON d.id=s.document_id AND d.user_id=s.student_user_id
        WHERE s.institution_id IN (${placeholders}) AND s.status<>'withdrawn'
        ORDER BY s.created_at DESC LIMIT 100
      `).all(...visible);
      const submissions=rows.map(row=>{let reviewNote="";if(row.encryptedReviewNote){try{reviewNote=String(jsonDecrypt(JSON.parse(row.encryptedReviewNote),key)?.note||"");}catch{}}addInstitutionReviewAudit(row.id,row.institutionId,req.user.id,"review_queue_viewed",row.status,row.status);return {...row,encryptedReviewNote:undefined,reviewNote};});
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,submissions});
    } catch(error){next(error);}
  });
  app.patch("/api/institutions/review-submissions/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,status FROM institution_review_submissions WHERE id=?").get(String(req.params.id||""));
      if(!row) return res.status(404).json({success:false,message:"Review submission was not found."});
      const membership=getInstitutionMembership(req.user.id,row.institution_id);
      if(!membership||membership.status!=="active"||!["reviewer","institution_admin"].includes(membership.role)) return res.status(403).json({success:false,code:"REVIEW_ACTION_FORBIDDEN",message:"An active reviewer or institution administrator membership is required."});
      const status=String(req.body?.status||""),note=String(req.body?.reviewNote||"").trim();
      if(!["needs_correction","approved","rejected"].includes(status)||note.length>500) return res.status(400).json({success:false,message:"Choose a valid outcome and keep the note within 500 characters."});
      if(["withdrawn","approved","rejected"].includes(row.status)) return res.status(409).json({success:false,message:"This submission is already closed."});
      const encryptedNote=note?JSON.stringify(jsonEncrypt({note},key)):null,now=new Date().toISOString();
      database.prepare("UPDATE institution_review_submissions SET status=?,encrypted_review_note=?,reviewed_by=?,updated_at=? WHERE id=?").run(status,encryptedNote,req.user.id,now,row.id);
      addInstitutionReviewAudit(row.id,row.institution_id,req.user.id,"review_status_changed",row.status,status);
      if(typeof logEvent==="function") logEvent(req.user.id,"INSTITUTION_REVIEW_STATUS_CHANGED",req);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,submission:{id:row.id,status,reviewNote:note,updatedAt:now}});
    } catch(error){next(error);}
  });
  app.get("/api/institutions/review-submissions/:id/audit", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,student_user_id FROM institution_review_submissions WHERE id=?").get(String(req.params.id||""));
      if(!row) return res.status(404).json({success:false,message:"Review submission was not found."});
      const member=getInstitutionMembership(req.user.id,row.institution_id),student=row.student_user_id===req.user.id;
      if(!student&&(!member||member.status!=="active"||!["reviewer","institution_admin","read_only"].includes(member.role))) return res.status(403).json({success:false,message:"You do not have access to this review history."});
      const audit=database.prepare(`
        SELECT a.action,a.from_status AS fromStatus,a.to_status AS toStatus,
          a.created_at AS createdAt,u.email AS actorEmail
        FROM institution_review_audit a INNER JOIN users u ON u.id=a.actor_user_id
        WHERE a.submission_id=? ORDER BY a.created_at ASC LIMIT 200
      `).all(row.id);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,audit});
    } catch(error){next(error);}
  });

  // HOSTEL ADMISSIONS — institution-scoped student applications and reviewer decisions.
  function addHostelAudit(applicationId, institutionId, actorUserId, action, fromStatus = null, toStatus = null) {
    database.prepare("INSERT INTO hostel_application_audit(id,application_id,institution_id,actor_user_id,action,from_status,to_status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), applicationId, institutionId, actorUserId, action, fromStatus, toStatus, new Date().toISOString());
  }

  app.post("/api/institutions/hostel-applications", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.body?.institutionId||"");
      if(req.body?.consent!==true) return res.status(400).json({success:false,message:"Explicit consent is required before submitting a hostel application."});
      const academicYear=String(req.body?.academicYear||"").trim();
      const stayType=String(req.body?.stayType||"");
      const roomPreference=String(req.body?.roomPreference||"no_preference");
      const studentNote=String(req.body?.studentNote||"").trim();
      if(!institutionId||institutionId.length>128||!/^20\d{2}-20\d{2}$/.test(academicYear)||
        !["new_admission","renewal"].includes(stayType)||!["no_preference","single","shared"].includes(roomPreference)||studentNote.length>500) {
        return res.status(400).json({success:false,message:"Check the academic year, stay type, room preference and note."});
      }
      const membership=getInstitutionMembership(req.user.id,institutionId);
      if(!membership||membership.status!=="active"||membership.role!=="student") return res.status(403).json({success:false,code:"ACTIVE_STUDENT_MEMBERSHIP_REQUIRED",message:"An active student membership is required."});
      const duplicate=database.prepare("SELECT id FROM hostel_applications WHERE institution_id=? AND student_user_id=? AND academic_year=? AND status<>'withdrawn' LIMIT 1").get(institutionId,req.user.id,academicYear);
      if(duplicate) return res.status(409).json({success:false,message:"You already have a hostel application for this academic year."});
      const id=crypto.randomUUID(),now=new Date().toISOString();
      database.prepare("INSERT INTO hostel_applications(id,institution_id,student_user_id,academic_year,stay_type,room_preference,student_note,consented_at,consent_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?)")
        .run(id,institutionId,req.user.id,academicYear,stayType,roomPreference,studentNote||null,now,"hostel-application-v1",now,now);
      addHostelAudit(id,institutionId,req.user.id,"student_applied",null,"submitted");
      if(typeof logEvent==="function") logEvent(req.user.id,"HOSTEL_APPLICATION_SUBMITTED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.status(201).json({success:true,application:{id,institutionId,academicYear,stayType,roomPreference,status:"submitted",createdAt:now,updatedAt:now}});
    } catch(error){next(error);}
  });

  app.get("/api/institutions/my-hostel-applications", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const rows=database.prepare(`
        SELECT h.id,h.institution_id AS institutionId,i.name AS institutionName,h.academic_year AS academicYear,
          h.stay_type AS stayType,h.room_preference AS roomPreference,h.student_note AS studentNote,h.status,
          h.encrypted_review_note AS encryptedReviewNote,h.consented_at AS consentedAt,h.consent_version AS consentVersion,
          h.created_at AS createdAt,h.updated_at AS updatedAt,
          a.id AS allocationId,a.bed_label AS bedLabel,a.academic_year AS allocationAcademicYear,
          a.status AS allocationStatus,a.checked_in_at AS checkedInAt,a.checked_out_at AS checkedOutAt,
          CASE WHEN a.status='released' THEN a.updated_at ELSE NULL END AS releasedAt,
          r.room_number AS roomNumber,r.room_type AS roomType,b.name AS buildingName
        FROM hostel_applications h JOIN institutions i ON i.id=h.institution_id
        LEFT JOIN hostel_bed_allocations a ON a.id=(SELECT latest.id FROM hostel_bed_allocations latest WHERE latest.application_id=h.id ORDER BY latest.updated_at DESC,latest.created_at DESC LIMIT 1)
        LEFT JOIN hostel_rooms r ON r.id=a.room_id
        LEFT JOIN hostel_buildings b ON b.id=r.building_id
        WHERE h.student_user_id=? ORDER BY h.created_at DESC LIMIT 100
      `).all(req.user.id);
      const applications=rows.map(row=>{let reviewNote="";if(row.encryptedReviewNote){try{reviewNote=String(jsonDecrypt(JSON.parse(row.encryptedReviewNote),key)?.note||"");}catch{}}return {...row,encryptedReviewNote:undefined,reviewNote};});
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,applications});
    } catch(error){next(error);}
  });

  app.get("/api/institutions/hostel-review-queue", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const memberships=database.prepare("SELECT institution_id FROM institution_memberships WHERE user_id=? AND status='active' AND role IN ('reviewer','institution_admin','read_only')").all(req.user.id);
      const ids=memberships.map(row=>row.institution_id);
      if(!ids.length) return res.status(403).json({success:false,code:"REVIEWER_MEMBERSHIP_REQUIRED",message:"An active reviewer, institution administrator or read-only membership is required."});
      const requested=String(req.query.institutionId||"");
      if(requested&&!ids.includes(requested)) return res.status(403).json({success:false,message:"You do not have access to this institution."});
      const visible=requested?[requested]:ids,placeholders=visible.map(()=>"?").join(",");
      const rows=database.prepare(`
        SELECT h.id,h.institution_id AS institutionId,i.name AS institutionName,h.student_user_id AS studentUserId,
          h.academic_year AS academicYear,h.stay_type AS stayType,h.room_preference AS roomPreference,
          h.student_note AS studentNote,h.status,h.encrypted_review_note AS encryptedReviewNote,
          h.created_at AS createdAt,h.updated_at AS updatedAt,
          a.id AS allocationId,a.bed_label AS bedLabel,a.academic_year AS allocationAcademicYear,
          r.room_number AS roomNumber,r.room_type AS roomType,b.name AS buildingName
        FROM hostel_applications h JOIN institutions i ON i.id=h.institution_id
        LEFT JOIN hostel_bed_allocations a ON a.application_id=h.id AND a.status='allocated'
        LEFT JOIN hostel_rooms r ON r.id=a.room_id
        LEFT JOIN hostel_buildings b ON b.id=r.building_id
        WHERE h.institution_id IN (${placeholders}) AND h.status<>'withdrawn'
        ORDER BY h.created_at DESC LIMIT 100
      `).all(...visible);
      const applications=rows.map(row=>{let reviewNote="";if(row.encryptedReviewNote){try{reviewNote=String(jsonDecrypt(JSON.parse(row.encryptedReviewNote),key)?.note||"");}catch{}}addHostelAudit(row.id,row.institutionId,req.user.id,"review_queue_viewed",row.status,row.status);return {...row,encryptedReviewNote:undefined,reviewNote};});
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,applications});
    } catch(error){next(error);}
  });

  app.patch("/api/institutions/hostel-applications/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,status FROM hostel_applications WHERE id=?").get(String(req.params.id||""));
      if(!row) return res.status(404).json({success:false,message:"Hostel application was not found."});
      const membership=getInstitutionMembership(req.user.id,row.institution_id);
      if(!membership||membership.status!=="active"||!["reviewer","institution_admin"].includes(membership.role)) return res.status(403).json({success:false,code:"HOSTEL_REVIEW_FORBIDDEN",message:"An active reviewer or institution administrator membership is required."});
      const status=String(req.body?.status||""),note=String(req.body?.reviewNote||"").trim();
      if(!["needs_correction","approved","rejected"].includes(status)||note.length>500) return res.status(400).json({success:false,message:"Choose a valid review outcome and keep the note within 500 characters."});
      if(["withdrawn","approved","rejected"].includes(row.status)) return res.status(409).json({success:false,message:"This hostel application is already closed."});
      const encryptedNote=note?JSON.stringify(jsonEncrypt({note},key)):null,now=new Date().toISOString();
      database.prepare("UPDATE hostel_applications SET status=?,encrypted_review_note=?,reviewed_by=?,updated_at=? WHERE id=?").run(status,encryptedNote,req.user.id,now,row.id);
      addHostelAudit(row.id,row.institution_id,req.user.id,"hostel_review_status_changed",row.status,status);
      if(typeof logEvent==="function") logEvent(req.user.id,"HOSTEL_APPLICATION_REVIEWED",req);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,application:{id:row.id,status,reviewNote:note,updatedAt:now}});
    } catch(error){next(error);}
  });


  // HOSTEL INVENTORY — institution-scoped buildings, rooms and capacity-aware bed allotments.
  function getHostelMembership(req, institutionId, allowed = ["reviewer","institution_admin","read_only","student"]) {
    const membership=getInstitutionMembership(req.user.id,institutionId);
    return membership&&membership.status==="active"&&allowed.includes(membership.role)?membership:null;
  }

  app.get("/api/institutions/hostel-inventory", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const memberships=database.prepare("SELECT institution_id,role FROM institution_memberships WHERE user_id=? AND status='active'").all(req.user.id);
      const ids=memberships.map(row=>row.institution_id);
      if(!ids.length) return res.status(403).json({success:false,message:"An active institution membership is required."});
      const requested=String(req.query.institutionId||"");
      if(requested&&!ids.includes(requested)) return res.status(403).json({success:false,message:"You do not have access to this institution."});
      const visible=requested?[requested]:ids,marks=visible.map(()=>"?").join(",");
      const requestedYear=String(req.query.academicYear||"");
      const academicYear=/^20\d{2}-20\d{2}$/.test(requestedYear)?requestedYear:`${new Date().getFullYear()}-${new Date().getFullYear()+1}`;
      const buildings=database.prepare(`SELECT id,institution_id AS institutionId,name FROM hostel_buildings WHERE institution_id IN (${marks}) ORDER BY name`).all(...visible);
      const rooms=database.prepare(`
        SELECT r.id,r.institution_id AS institutionId,r.building_id AS buildingId,b.name AS buildingName,
          r.room_number AS roomNumber,r.room_type AS roomType,r.capacity,r.status,
          r.manual_occupied_beds AS manualOccupiedBeds,
          (SELECT COUNT(*) FROM hostel_bed_allocations a WHERE a.room_id=r.id AND a.academic_year=? AND a.status='allocated') AS allocatedBeds
        FROM hostel_rooms r JOIN hostel_buildings b ON b.id=r.building_id
        WHERE r.institution_id IN (${marks}) ORDER BY b.name,r.room_number
      `).all(academicYear,...visible).map(room=>({...room,occupiedBeds:room.manualOccupiedBeds+room.allocatedBeds,availableBeds:Math.max(0,room.capacity-room.manualOccupiedBeds-room.allocatedBeds)}));
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,buildings,rooms});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/hostel-buildings", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.body?.institutionId||""),name=String(req.body?.name||"").trim();
      const member=getHostelMembership(req,institutionId,["institution_admin"]);
      if(!member) return res.status(403).json({success:false,message:"An active institution administrator is required to manage hostel buildings."});
      if(name.length<2||name.length>80) return res.status(400).json({success:false,message:"Building name must be 2–80 characters."});
      const id=crypto.randomUUID(),now=new Date().toISOString();
      database.prepare("INSERT INTO hostel_buildings(id,institution_id,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id,institutionId,name,req.user.id,now,now);
      res.setHeader("Cache-Control","private, no-store");res.status(201).json({success:true,building:{id,institutionId,name}});
    } catch(error){if(String(error?.code||"").includes("CONSTRAINT")) return res.status(409).json({success:false,message:"A building with this name already exists."});next(error);}
  });

  app.post("/api/institutions/hostel-rooms", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.body?.institutionId||""),buildingId=String(req.body?.buildingId||"");
      const roomNumber=String(req.body?.roomNumber||"").trim(),roomType=String(req.body?.roomType||"shared");
      const capacity=Number(req.body?.capacity),manualOccupiedBeds=Number(req.body?.manualOccupiedBeds ?? 0);
      const member=getHostelMembership(req,institutionId,["institution_admin"]);
      if(!member) return res.status(403).json({success:false,message:"An active institution administrator is required to manage hostel rooms."});
      const building=database.prepare("SELECT id FROM hostel_buildings WHERE id=? AND institution_id=?").get(buildingId,institutionId);
      if(!building) return res.status(404).json({success:false,message:"Select a building belonging to this institution."});
      if(!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/.test(roomNumber)||!["single","shared","dormitory"].includes(roomType)||!Number.isInteger(capacity)||capacity<1||capacity>12||!Number.isInteger(manualOccupiedBeds)||manualOccupiedBeds<0||manualOccupiedBeds>capacity) {
        return res.status(400).json({success:false,message:"Enter a valid room number, room type and capacity (1–12 beds)."});
      }
      const id=crypto.randomUUID(),now=new Date().toISOString();
      database.prepare("INSERT INTO hostel_rooms(id,institution_id,building_id,room_number,room_type,capacity,manual_occupied_beds,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)")
        .run(id,institutionId,buildingId,roomNumber,roomType,capacity,manualOccupiedBeds,now,now);
      res.setHeader("Cache-Control","private, no-store");res.status(201).json({success:true,room:{id,institutionId,buildingId,roomNumber,roomType,capacity,manualOccupiedBeds,status:"active"}});
    } catch(error){if(String(error?.code||"").includes("CONSTRAINT")) return res.status(409).json({success:false,message:"That room number already exists in this building."});next(error);}
  });

  app.patch("/api/institutions/hostel-rooms/:id/occupancy", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const roomId=String(req.params.id||""),manualOccupiedBeds=Number(req.body?.manualOccupiedBeds);
      const room=database.prepare("SELECT id,institution_id,capacity,manual_occupied_beds AS manualOccupiedBeds FROM hostel_rooms WHERE id=?").get(roomId);
      if(!room) return res.status(404).json({success:false,message:"Hostel room was not found."});
      const member=getHostelMembership(req,room.institution_id,["institution_admin"]);
      if(!member) return res.status(403).json({success:false,message:"An active institution administrator (warden) is required to update room occupancy."});
      if(!Number.isInteger(manualOccupiedBeds)||manualOccupiedBeds<0||manualOccupiedBeds>room.capacity) return res.status(400).json({success:false,message:"Enter a whole number of occupied beds between 0 and the room capacity."});
      const academicYear=String(req.body?.academicYear||"");
      if(!/^20\d{2}-20\d{2}$/.test(academicYear)) return res.status(400).json({success:false,message:"Choose a valid academic year before updating occupancy."});
      const allocated=database.prepare("SELECT COUNT(*) AS count FROM hostel_bed_allocations WHERE room_id=? AND status='allocated' AND academic_year=?").get(roomId,academicYear).count;
      if(manualOccupiedBeds+allocated>room.capacity) return res.status(409).json({success:false,message:"Manual occupied beds plus SecureID bed allocations cannot exceed room capacity."});
      const now=new Date().toISOString();
      database.prepare("UPDATE hostel_rooms SET manual_occupied_beds=?,updated_at=? WHERE id=?").run(manualOccupiedBeds,now,roomId);
      database.prepare("INSERT INTO hostel_room_occupancy_audit(id,room_id,institution_id,actor_user_id,previous_manual_occupied_beds,new_manual_occupied_beds,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(crypto.randomUUID(),roomId,room.institution_id,req.user.id,room.manualOccupiedBeds,manualOccupiedBeds,now);
      if(typeof logEvent==="function") logEvent(req.user.id,"HOSTEL_ROOM_OCCUPANCY_UPDATED",req);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,room:{id:roomId,manualOccupiedBeds,allocatedBeds:allocated,occupiedBeds:manualOccupiedBeds+allocated,availableBeds:room.capacity-manualOccupiedBeds-allocated}});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/hostel-applications/:id/allocation", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const applicationId=String(req.params.id||""),roomId=String(req.body?.roomId||""),requestedBed=String(req.body?.bedLabel||"").trim();
      const application=database.prepare("SELECT id,institution_id,student_user_id,academic_year,status FROM hostel_applications WHERE id=?").get(applicationId);
      if(!application) return res.status(404).json({success:false,message:"Hostel application was not found."});
      const member=getHostelMembership(req,application.institution_id,["reviewer","institution_admin"]);
      if(!member) return res.status(403).json({success:false,message:"An active reviewer or institution administrator is required to allot a bed."});
      if(application.status!=="approved") return res.status(409).json({success:false,message:"Approve the hostel application before allotting a room."});
      const room=database.prepare("SELECT id,institution_id,building_id,room_number,capacity,manual_occupied_beds AS manualOccupiedBeds,status FROM hostel_rooms WHERE id=? AND institution_id=?").get(roomId,application.institution_id);
      if(!room||room.status!=="active") return res.status(404).json({success:false,message:"Choose an active room in the same institution."});
      const existing=database.prepare("SELECT id FROM hostel_bed_allocations WHERE application_id=? AND status='allocated'").get(applicationId);
      if(existing) return res.status(409).json({success:false,message:"This application already has an active bed allocation. Release it before making another allotment."});
      const occupied=database.prepare("SELECT COUNT(*) AS count FROM hostel_bed_allocations WHERE room_id=? AND academic_year=? AND status='allocated'").get(roomId,application.academic_year).count;
      if(occupied+room.manualOccupiedBeds>=room.capacity) return res.status(409).json({success:false,message:"This room is full for the selected academic year, including warden-entered occupants."});
      let bedLabel=requestedBed;
      if(!bedLabel) {
        const used=new Set(database.prepare("SELECT bed_label FROM hostel_bed_allocations WHERE room_id=? AND academic_year=? AND status='allocated'").all(roomId,application.academic_year).map(row=>row.bed_label));
        for(let index=1;index<=room.manualOccupiedBeds;index++) used.add(String(index));
        for(let index=1;index<=room.capacity;index++){if(!used.has(String(index))){bedLabel=String(index);break;}}
      }
      if(!bedLabel||bedLabel.length>20) return res.status(400).json({success:false,message:"Bed label must be 1–20 characters."});
      if(/^\d+$/.test(bedLabel)&&Number(bedLabel)<=room.manualOccupiedBeds) return res.status(409).json({success:false,message:"That bed is already occupied according to the warden inventory."});
      const now=new Date().toISOString(),id=crypto.randomUUID();
      database.prepare("INSERT INTO hostel_bed_allocations(id,institution_id,application_id,room_id,academic_year,bed_label,status,allocated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'allocated',?,?,?)")
        .run(id,application.institution_id,applicationId,roomId,application.academic_year,bedLabel,req.user.id,now,now);
      addHostelAudit(applicationId,application.institution_id,req.user.id,"hostel_bed_allocated",null,"allocated");
      if(typeof logEvent==="function") logEvent(req.user.id,"HOSTEL_BED_ALLOCATED",req);
      res.setHeader("Cache-Control","private, no-store");res.status(201).json({success:true,allocation:{id,applicationId,roomId,bedLabel,academicYear:application.academic_year,status:"allocated"}});
    } catch(error){if(String(error?.code||"").includes("CONSTRAINT")) return res.status(409).json({success:false,message:"That bed is already allocated. Refresh the room list and choose another bed."});next(error);}
  });

  app.delete("/api/institutions/hostel-allocations/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const allocation=database.prepare("SELECT id,institution_id,application_id,status,checked_in_at,checked_out_at FROM hostel_bed_allocations WHERE id=?").get(String(req.params.id||""));
      if(!allocation) return res.status(404).json({success:false,message:"Bed allocation was not found."});
      const member=getHostelMembership(req,allocation.institution_id,["reviewer","institution_admin"]);
      if(!member) return res.status(403).json({success:false,message:"An active reviewer or institution administrator is required."});
      if(allocation.status!=="allocated") return res.status(404).json({success:false,message:"Active bed allocation was not found."});
      if(allocation.checked_in_at&&!allocation.checked_out_at) return res.status(409).json({success:false,message:"Check the student out before releasing this bed."});
      const now=new Date().toISOString();
      database.prepare("UPDATE hostel_bed_allocations SET status='released',updated_at=? WHERE id=?").run(now,allocation.id);
      addHostelAudit(allocation.application_id,allocation.institution_id,req.user.id,"hostel_bed_released","allocated","released");
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,status:"released"});
    } catch(error){next(error);}
  });

  app.delete("/api/institutions/hostel-applications/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,student_user_id,status FROM hostel_applications WHERE id=?").get(String(req.params.id||""));
      if(!row||row.student_user_id!==req.user.id) return res.status(404).json({success:false,message:"Hostel application was not found."});
      if(!["submitted","needs_correction"].includes(row.status)) return res.status(409).json({success:false,message:"This hostel application can no longer be withdrawn."});
      const now=new Date().toISOString();
      database.prepare("UPDATE hostel_applications SET status='withdrawn',updated_at=? WHERE id=? AND student_user_id=?").run(now,row.id,req.user.id);
      addHostelAudit(row.id,row.institution_id,req.user.id,"student_withdrew_hostel_application",row.status,"withdrawn");
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,status:"withdrawn"});
    } catch(error){next(error);}
  });


  // HOSTEL OPERATIONS PHASE 3 — check-in/out, fee ledger and warden reporting.
  try { database.exec("ALTER TABLE hostel_bed_allocations ADD COLUMN checked_in_at TEXT"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  try { database.exec("ALTER TABLE hostel_bed_allocations ADD COLUMN checked_out_at TEXT"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }
  database.exec(`
    CREATE TABLE IF NOT EXISTS hostel_fee_records (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      application_id TEXT NOT NULL REFERENCES hostel_applications(id),
      allocation_id TEXT NOT NULL REFERENCES hostel_bed_allocations(id),
      academic_year TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_fee_institution ON hostel_fee_records(institution_id,status,due_date);
    CREATE INDEX IF NOT EXISTS idx_hostel_fee_application ON hostel_fee_records(application_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS hostel_fee_payments (
      id TEXT PRIMARY KEY,
      fee_record_id TEXT NOT NULL REFERENCES hostel_fee_records(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','bank_transfer','upi','other')),
      reference TEXT,
      received_by TEXT NOT NULL REFERENCES users(id),
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_fee_payments_record ON hostel_fee_payments(fee_record_id,received_at);
    CREATE TABLE IF NOT EXISTS hostel_operations_audit (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      application_id TEXT NOT NULL REFERENCES hostel_applications(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hostel_operations_audit ON hostel_operations_audit(institution_id,created_at DESC);
  `);

  function addHostelOperationsAudit(institutionId, applicationId, actorUserId, action, details = null) {
    database.prepare("INSERT INTO hostel_operations_audit(id,institution_id,application_id,actor_user_id,action,details,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), institutionId, applicationId, actorUserId, action, details, new Date().toISOString());
  }

  app.get("/api/institutions/hostel-operations", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.query.institutionId||"");
      const member=getHostelMembership(req,institutionId,["reviewer","institution_admin","read_only"]);
      if(!member) return res.status(403).json({success:false,message:"An active institution reviewer, administrator or read-only membership is required."});
      const allocations=database.prepare(`
        SELECT a.id AS allocationId,a.application_id AS applicationId,a.academic_year AS academicYear,
          a.bed_label AS bedLabel,a.status AS allocationStatus,a.checked_in_at AS checkedInAt,
          a.checked_out_at AS checkedOutAt,a.updated_at AS updatedAt,r.room_number AS roomNumber,b.name AS buildingName,
          h.student_user_id AS studentUserId,h.status AS applicationStatus
        FROM hostel_bed_allocations a
        JOIN hostel_applications h ON h.id=a.application_id
        JOIN hostel_rooms r ON r.id=a.room_id
        JOIN hostel_buildings b ON b.id=r.building_id
        WHERE a.institution_id=? ORDER BY a.created_at DESC LIMIT 500
      `).all(institutionId);
      const fees=database.prepare(`
        SELECT f.id,f.application_id AS applicationId,f.allocation_id AS allocationId,
          f.academic_year AS academicYear,f.description,f.amount_paise AS amountPaise,
          f.due_date AS dueDate,f.status,f.created_at AS createdAt,
          COALESCE((SELECT SUM(p.amount_paise) FROM hostel_fee_payments p WHERE p.fee_record_id=f.id),0) AS paidPaise
        FROM hostel_fee_records f WHERE f.institution_id=? ORDER BY f.created_at DESC LIMIT 500
      `).all(institutionId);
      const totals=database.prepare(`
        SELECT COUNT(*) AS totalBeds,
          SUM(CASE WHEN status='allocated' THEN 1 ELSE 0 END) AS allocatedBeds,
          SUM(CASE WHEN checked_in_at IS NOT NULL AND checked_out_at IS NULL THEN 1 ELSE 0 END) AS currentlyCheckedIn
        FROM hostel_bed_allocations WHERE institution_id=?
      `).get(institutionId);
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,allocations,fees,summary:{totalBeds:totals.totalBeds||0,allocatedBeds:totals.allocatedBeds||0,currentlyCheckedIn:totals.currentlyCheckedIn||0}});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/hostel-allocations/:id/check-in", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,application_id,status,checked_in_at,checked_out_at FROM hostel_bed_allocations WHERE id=?").get(String(req.params.id||""));
      if(!row) return res.status(404).json({success:false,message:"Bed allocation was not found."});
      if(!getHostelMembership(req,row.institution_id,["reviewer","institution_admin"])) return res.status(403).json({success:false,message:"An active reviewer or institution administrator is required."});
      if(row.status!=="allocated") return res.status(404).json({success:false,message:"Active bed allocation was not found."});
      if(row.checked_in_at&&!row.checked_out_at) return res.status(409).json({success:false,message:"Student is already checked in."});
      const now=new Date().toISOString();
      database.prepare("UPDATE hostel_bed_allocations SET checked_in_at=?,checked_out_at=NULL,updated_at=? WHERE id=?").run(now,now,row.id);
      addHostelOperationsAudit(row.institution_id,row.application_id,req.user.id,"student_checked_in");
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,checkedInAt:now});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/hostel-allocations/:id/check-out", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,application_id,status,checked_in_at,checked_out_at FROM hostel_bed_allocations WHERE id=?").get(String(req.params.id||""));
      if(!row||row.status!=="allocated") return res.status(404).json({success:false,message:"Active bed allocation was not found."});
      if(!getHostelMembership(req,row.institution_id,["reviewer","institution_admin"])) return res.status(403).json({success:false,message:"An active reviewer or institution administrator is required."});
      if(!row.checked_in_at||row.checked_out_at) return res.status(409).json({success:false,message:"Student must be checked in before check-out."});
      const now=new Date().toISOString();
      database.prepare("UPDATE hostel_bed_allocations SET checked_out_at=?,updated_at=? WHERE id=?").run(now,now,row.id);
      addHostelOperationsAudit(row.institution_id,row.application_id,req.user.id,"student_checked_out");
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,checkedOutAt:now});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/hostel-applications/:id/fees", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const applicationId=String(req.params.id||""),description=String(req.body?.description||"Hostel fee").trim();
      const amount=Number(req.body?.amount),dueDate=String(req.body?.dueDate||"").trim();
      const application=database.prepare("SELECT id,institution_id,academic_year,status FROM hostel_applications WHERE id=?").get(applicationId);
      if(!application) return res.status(404).json({success:false,message:"Hostel application was not found."});
      if(!getHostelMembership(req,application.institution_id,["institution_admin"])) return res.status(403).json({success:false,message:"An active institution administrator is required to create hostel fees."});
      const allocation=database.prepare("SELECT id FROM hostel_bed_allocations WHERE application_id=? AND status='allocated'").get(applicationId);
      if(!allocation) return res.status(409).json({success:false,message:"A bed must be allocated before hostel fees are added."});
      if(description.length<2||description.length>100||!Number.isFinite(amount)||amount<=0||amount>1000000||!/^\d+(\.\d{1,2})?$/.test(String(req.body?.amount??""))||(dueDate&&!/^20\d{2}-\d{2}-\d{2}$/.test(dueDate))) return res.status(400).json({success:false,message:"Enter a valid fee description, amount and due date."});
      const amountPaise=Math.round(amount*100),id=crypto.randomUUID(),now=new Date().toISOString();
      database.prepare("INSERT INTO hostel_fee_records(id,institution_id,application_id,allocation_id,academic_year,description,amount_paise,due_date,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'unpaid',?,?,?)")
        .run(id,application.institution_id,applicationId,allocation.id,application.academic_year,description,amountPaise,dueDate||null,req.user.id,now,now);
      addHostelOperationsAudit(application.institution_id,applicationId,req.user.id,"hostel_fee_created",String(amountPaise));
      res.setHeader("Cache-Control","private, no-store");res.status(201).json({success:true,fee:{id,applicationId,description,amountPaise,dueDate:dueDate||null,status:"unpaid"}});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/hostel-fees/:id/payments", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const fee=database.prepare("SELECT id,institution_id,application_id,amount_paise FROM hostel_fee_records WHERE id=?").get(String(req.params.id||""));
      if(!fee) return res.status(404).json({success:false,message:"Hostel fee record was not found."});
      if(!getHostelMembership(req,fee.institution_id,["reviewer","institution_admin"])) return res.status(403).json({success:false,message:"An active reviewer or institution administrator is required to record a received payment."});
      const amount=Number(req.body?.amount),method=String(req.body?.paymentMethod||""),reference=String(req.body?.reference||"").trim();
      if(!Number.isFinite(amount)||amount<=0||amount>1000000||!/^\d+(\.\d{1,2})?$/.test(String(req.body?.amount??""))||!["cash","bank_transfer","upi","other"].includes(method)||reference.length>100) return res.status(400).json({success:false,message:"Enter a valid amount, payment method and optional reference."});
      const amountPaise=Math.round(amount*100);
      const paid=database.prepare("SELECT COALESCE(SUM(amount_paise),0) AS total FROM hostel_fee_payments WHERE fee_record_id=?").get(fee.id).total;
      if(paid+amountPaise>fee.amount_paise) return res.status(409).json({success:false,message:"Payment exceeds the outstanding fee balance."});
      const now=new Date().toISOString(),id=crypto.randomUUID();
      database.prepare("INSERT INTO hostel_fee_payments(id,fee_record_id,amount_paise,payment_method,reference,received_by,received_at) VALUES(?,?,?,?,?,?,?)")
        .run(id,fee.id,amountPaise,method,reference||null,req.user.id,now);
      const nextPaid=paid+amountPaise,status=nextPaid===fee.amount_paise?"paid":"partial";
      database.prepare("UPDATE hostel_fee_records SET status=?,updated_at=? WHERE id=?").run(status,now,fee.id);
      addHostelOperationsAudit(fee.institution_id,fee.application_id,req.user.id,"hostel_fee_payment_recorded",String(amountPaise));
      res.setHeader("Cache-Control","private, no-store");res.status(201).json({success:true,payment:{id,feeRecordId:fee.id,amountPaise,paymentMethod:method,reference:reference||null,receivedAt:now},status,paidPaise:nextPaid});
    } catch(error){next(error);}
  });

  app.get("/api/institutions/my-hostel-fees", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const fees=database.prepare(`
        SELECT f.id,f.description,f.amount_paise AS amountPaise,f.due_date AS dueDate,f.status,
          f.academic_year AS academicYear,i.name AS institutionName,
          COALESCE((SELECT SUM(p.amount_paise) FROM hostel_fee_payments p WHERE p.fee_record_id=f.id),0) AS paidPaise
        FROM hostel_fee_records f
        JOIN hostel_applications h ON h.id=f.application_id
        JOIN institutions i ON i.id=f.institution_id
        WHERE h.student_user_id=? ORDER BY f.created_at DESC LIMIT 100
      `).all(req.user.id);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,fees});
    } catch(error){next(error);}
  });

  // INSTITUTION SCHOLARSHIPS — institution-managed programs and student applications.
  database.exec(`
    CREATE TABLE IF NOT EXISTS scholarship_programs (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      eligibility TEXT NOT NULL,
      award_amount_paise INTEGER NOT NULL CHECK(award_amount_paise > 0),
      deadline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scholarship_programs_institution ON scholarship_programs(institution_id,status,deadline);
    CREATE TABLE IF NOT EXISTS scholarship_applications (
      id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL REFERENCES scholarship_programs(id),
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      student_user_id TEXT NOT NULL REFERENCES users(id),
      academic_year TEXT NOT NULL,
      encrypted_details TEXT NOT NULL,
      document_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','needs_correction','approved','rejected','withdrawn')),
      encrypted_review_note TEXT,
      reviewed_by TEXT,
      consented_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(program_id,student_user_id,academic_year)
    );
    CREATE INDEX IF NOT EXISTS idx_scholarship_applications_institution ON scholarship_applications(institution_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scholarship_applications_student ON scholarship_applications(student_user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS scholarship_audit (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES scholarship_applications(id),
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scholarship_audit_application ON scholarship_audit(application_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS scholarship_document_access_audit (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES scholarship_applications(id),
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      document_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('success','denied','not_found','error')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scholarship_document_audit_application ON scholarship_document_access_audit(application_id,created_at DESC);
  `);

  function addScholarshipAudit(applicationId,institutionId,actorUserId,action,fromStatus=null,toStatus=null) {
    database.prepare("INSERT INTO scholarship_audit(id,application_id,institution_id,actor_user_id,action,from_status,to_status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(),applicationId,institutionId,actorUserId,action,fromStatus,toStatus,new Date().toISOString());
  }

  app.get("/api/institutions/scholarship-workspace", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.query.institutionId||"");
      const membership=getInstitutionMembership(req.user.id,institutionId);
      if(!membership||membership.status!=="active"||!["student","reviewer","institution_admin","read_only"].includes(membership.role))
        return res.status(403).json({success:false,message:"An active institution membership is required for scholarship access."});
      const programs=database.prepare(`
        SELECT id,institution_id AS institutionId,title,description,eligibility,
          award_amount_paise AS awardAmountPaise,deadline,status,created_at AS createdAt
        FROM scholarship_programs WHERE institution_id=? ORDER BY deadline ASC,created_at DESC LIMIT 200
      `).all(institutionId);
      const isStudent=membership.role==="student";
      const rows=database.prepare(`
        SELECT a.id,a.program_id AS programId,a.institution_id AS institutionId,
          a.student_user_id AS studentUserId,a.academic_year AS academicYear,
          a.encrypted_details AS encryptedDetails,a.document_ids_json AS documentIdsJson,
          a.status,a.encrypted_review_note AS encryptedReviewNote,a.consented_at AS consentedAt,
          a.created_at AS createdAt,a.updated_at AS updatedAt,p.title AS programTitle,
          p.award_amount_paise AS awardAmountPaise,p.deadline
        FROM scholarship_applications a JOIN scholarship_programs p ON p.id=a.program_id
        WHERE a.institution_id=? ${isStudent ? "AND a.student_user_id=?" : ""}
        ORDER BY a.created_at DESC LIMIT 300
      `).all(...(isStudent?[institutionId,req.user.id]:[institutionId]));
      const applications=rows.map(row=>{
        let details={},reviewNote="";
        try{details=jsonDecrypt(JSON.parse(row.encryptedDetails),key)||{};}catch{}
        try{reviewNote=row.encryptedReviewNote?String(jsonDecrypt(JSON.parse(row.encryptedReviewNote),key)?.note||""):"";}catch{}
        let documentIds=[];try{documentIds=JSON.parse(row.documentIdsJson)||[];}catch{}
        const documents=documentIds.length?database.prepare("SELECT id,original_name AS name,mime_type AS mimeType,size_bytes AS sizeBytes,document_category AS category FROM secure_documents WHERE user_id=? AND deleted_at IS NULL AND id IN ("+documentIds.map(()=>"?").join(",")+")").all(row.studentUserId,...documentIds):[];
        return {...row,encryptedDetails:undefined,encryptedReviewNote:undefined,documentIdsJson:undefined,
          studentNote:String(details.studentNote||""),documentIds,documents,reviewNote};
      });
      res.setHeader("Cache-Control","private, no-store");
      res.json({success:true,membershipRole:membership.role,programs,applications});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/scholarship-programs", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const institutionId=String(req.body?.institutionId||""),title=String(req.body?.title||"").trim(),
        description=String(req.body?.description||"").trim(),eligibility=String(req.body?.eligibility||"").trim(),
        deadline=String(req.body?.deadline||"").trim(),amount=Number(req.body?.awardAmount);
      const member=getInstitutionMembership(req.user.id,institutionId);
      if(!member||member.status!=="active"||member.role!=="institution_admin")
        return res.status(403).json({success:false,message:"An active institution administrator is required to publish scholarship programs."});
      const today=new Date().toISOString().slice(0,10);
      if(title.length<3||title.length>100||description.length<20||description.length>2000||
        eligibility.length<10||eligibility.length>1000||!Number.isFinite(amount)||amount<=0||amount>10000000||
        !/^\d+(\.\d{1,2})?$/.test(String(req.body?.awardAmount??""))||
        !/^20\d{2}-\d{2}-\d{2}$/.test(deadline)||deadline<today)
        return res.status(400).json({success:false,message:"Enter a valid title, description, eligibility, award amount and future application deadline."});
      const id=crypto.randomUUID(),now=new Date().toISOString(),awardAmountPaise=Math.round(amount*100);
      database.prepare("INSERT INTO scholarship_programs(id,institution_id,title,description,eligibility,award_amount_paise,deadline,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?,?)")
        .run(id,institutionId,title,description,eligibility,awardAmountPaise,deadline,req.user.id,now,now);
      if(typeof logEvent==="function") logEvent(req.user.id,"SCHOLARSHIP_PROGRAM_CREATED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.status(201).json({success:true,program:{id,institutionId,title,description,eligibility,awardAmountPaise,deadline,status:"active",createdAt:now}});
    } catch(error){next(error);}
  });

  app.patch("/api/institutions/scholarship-programs/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const program=database.prepare("SELECT id,institution_id,status FROM scholarship_programs WHERE id=?").get(String(req.params.id||""));
      if(!program) return res.status(404).json({success:false,message:"Scholarship program was not found."});
      const member=getInstitutionMembership(req.user.id,program.institution_id);
      if(!member||member.status!=="active"||member.role!=="institution_admin")
        return res.status(403).json({success:false,message:"An active institution administrator is required to update scholarship programs."});
      const status=String(req.body?.status||"");
      if(!["active","closed"].includes(status)) return res.status(400).json({success:false,message:"Choose active or closed status."});
      database.prepare("UPDATE scholarship_programs SET status=?,updated_at=? WHERE id=?").run(status,new Date().toISOString(),program.id);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,status});
    } catch(error){next(error);}
  });

  app.post("/api/institutions/scholarship-programs/:id/applications", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const program=database.prepare("SELECT id,institution_id,title,deadline,status FROM scholarship_programs WHERE id=?").get(String(req.params.id||""));
      if(!program) return res.status(404).json({success:false,message:"Scholarship program was not found."});
      const member=getInstitutionMembership(req.user.id,program.institution_id);
      if(!member||member.status!=="active"||member.role!=="student")
        return res.status(403).json({success:false,message:"An active student membership is required to apply."});
      if(program.status!=="active"||program.deadline<new Date().toISOString().slice(0,10))
        return res.status(409).json({success:false,message:"This scholarship program is closed or its deadline has passed."});
      const academicYear=String(req.body?.academicYear||""),studentNote=String(req.body?.studentNote||"").trim();
      const documentIds=Array.isArray(req.body?.documentIds)?[...new Set(req.body.documentIds.map(value=>String(value)))]:[];
      if(req.body?.consent!==true||!/^20\d{2}-20\d{2}$/.test(academicYear)||studentNote.length>1000||documentIds.length>10||documentIds.some(id=>!id||id.length>128))
        return res.status(400).json({success:false,message:"Confirm consent, enter a valid academic year and keep the note and document selection within the allowed limits."});
      if(documentIds.length){
        const marks=documentIds.map(()=>"?").join(",");
        const owned=database.prepare("SELECT id FROM secure_documents WHERE user_id=? AND deleted_at IS NULL AND id IN ("+marks+")").all(req.user.id,...documentIds);
        if(owned.length!==documentIds.length) return res.status(400).json({success:false,message:"Choose only active documents from your own SecureID Vault."});
      }
      const now=new Date().toISOString(),encryptedDetails=JSON.stringify(jsonEncrypt({studentNote},key)),documentIdsJson=JSON.stringify(documentIds);
      const existing=database.prepare("SELECT id,status FROM scholarship_applications WHERE program_id=? AND student_user_id=? AND academic_year=?").get(program.id,req.user.id,academicYear);
      if(existing){
        if(!["needs_correction","withdrawn"].includes(existing.status))
          return res.status(409).json({success:false,message:"You have already applied to this scholarship for that academic year."});
        database.prepare("UPDATE scholarship_applications SET encrypted_details=?,document_ids_json=?,status='submitted',encrypted_review_note=NULL,reviewed_by=NULL,consented_at=?,updated_at=? WHERE id=?")
          .run(encryptedDetails,documentIdsJson,now,now,existing.id);
        addScholarshipAudit(existing.id,program.institution_id,req.user.id,"student_resubmitted",existing.status,"submitted");
        res.setHeader("Cache-Control","private, no-store");
        return res.status(200).json({success:true,application:{id:existing.id,programId:program.id,programTitle:program.title,academicYear,status:"submitted",consentedAt:now,documentCount:documentIds.length}});
      }
      const id=crypto.randomUUID();
      database.prepare("INSERT INTO scholarship_applications(id,program_id,institution_id,student_user_id,academic_year,encrypted_details,document_ids_json,status,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'submitted',?,?,?)")
        .run(id,program.id,program.institution_id,req.user.id,academicYear,encryptedDetails,documentIdsJson,now,now,now);
      addScholarshipAudit(id,program.institution_id,req.user.id,"student_submitted",null,"submitted");
      if(typeof logEvent==="function") logEvent(req.user.id,"SCHOLARSHIP_APPLICATION_SUBMITTED",req);
      res.setHeader("Cache-Control","private, no-store");
      res.status(201).json({success:true,application:{id,programId:program.id,programTitle:program.title,academicYear,status:"submitted",consentedAt:now,documentCount:documentIds.length}});
    } catch(error){
      const databaseCode=String(error?.code||""),databaseMessage=String(error?.message||"");
      if(databaseCode.includes("CONSTRAINT")||/constraint failed|unique constraint/i.test(databaseMessage))
        return res.status(409).json({success:false,message:"You have already applied to this scholarship for that academic year."});
      next(error);
    }
  });

  app.patch("/api/institutions/scholarship-applications/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,student_user_id,status FROM scholarship_applications WHERE id=?").get(String(req.params.id||""));
      if(!row) return res.status(404).json({success:false,message:"Scholarship application was not found."});
      const member=getInstitutionMembership(req.user.id,row.institution_id);
      if(!member||member.status!=="active"||!["reviewer","institution_admin"].includes(member.role))
        return res.status(403).json({success:false,message:"An active institution reviewer or administrator is required to review applications."});
      const status=String(req.body?.status||""),note=String(req.body?.reviewNote||"").trim();
      if(!["needs_correction","approved","rejected"].includes(status)||note.length>500)
        return res.status(400).json({success:false,message:"Choose a valid review outcome and keep the note within 500 characters."});
      if(["approved","rejected","withdrawn"].includes(row.status))
        return res.status(409).json({success:false,message:"This scholarship application is already closed."});
      const encryptedNote=note?JSON.stringify(jsonEncrypt({note},key)):null,now=new Date().toISOString();
      database.prepare("UPDATE scholarship_applications SET status=?,encrypted_review_note=?,reviewed_by=?,updated_at=? WHERE id=?")
        .run(status,encryptedNote,req.user.id,now,row.id);
      addScholarshipAudit(row.id,row.institution_id,req.user.id,"review_status_changed",row.status,status);
      if(typeof logEvent==="function") logEvent(req.user.id,"SCHOLARSHIP_APPLICATION_REVIEWED",req);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,application:{id:row.id,status,reviewNote:note,updatedAt:now}});
    } catch(error){next(error);}
  });

  app.delete("/api/institutions/scholarship-applications/:id", enforceSameOrigin, requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,student_user_id,status FROM scholarship_applications WHERE id=?").get(String(req.params.id||""));
      if(!row||row.student_user_id!==req.user.id) return res.status(404).json({success:false,message:"Scholarship application was not found."});
      if(!["submitted","needs_correction"].includes(row.status)) return res.status(409).json({success:false,message:"This scholarship application can no longer be withdrawn."});
      const now=new Date().toISOString();
      database.prepare("UPDATE scholarship_applications SET status='withdrawn',updated_at=? WHERE id=?").run(now,row.id);
      addScholarshipAudit(row.id,row.institution_id,req.user.id,"student_withdrew",row.status,"withdrawn");
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,status:"withdrawn"});
    } catch(error){next(error);}
  });

  // CONSENTED SCHOLARSHIP DOCUMENT PREVIEW — view-only, scoped to the submitted application.
  const scholarshipPreviewIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many document preview requests. Try again later." }
  });
  app.get("/api/institutions/scholarship-applications/:id/documents/:documentId/preview", scholarshipPreviewIpLimiter, requireAuth, requireMfaProduction, async (req,res,next) => {
    const applicationId=String(req.params.id||""),documentId=String(req.params.documentId||"");
    let auditContext=null;
    try {
      const application=database.prepare("SELECT id,institution_id,student_user_id,status,document_ids_json,consented_at FROM scholarship_applications WHERE id=?").get(applicationId);
      if(!application) return res.status(404).json({success:false,message:"Scholarship application was not found."});
      auditContext={applicationId,institutionId:application.institution_id,documentId,actorUserId:req.user.id};
      const member=getInstitutionMembership(req.user.id,application.institution_id);
      if(!member||member.status!=="active"||!["reviewer","institution_admin"].includes(member.role)) {
        database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','denied',?)")
          .run(crypto.randomUUID(),application.id,application.institution_id,documentId,req.user.id,new Date().toISOString());
        return res.status(403).json({success:false,message:"An active institution reviewer or administrator is required to preview scholarship documents."});
      }
      let selectedIds=[];try{selectedIds=JSON.parse(application.document_ids_json)||[];}catch{}
      if(!application.consented_at||!["submitted","needs_correction"].includes(application.status)||!selectedIds.includes(documentId)) {
        database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','denied',?)")
          .run(crypto.randomUUID(),application.id,application.institution_id,documentId,req.user.id,new Date().toISOString());
        return res.status(403).json({success:false,message:"This document is not currently shared for scholarship review."});
      }
      // Bound repeated encrypted-file reads per IP and account before touching storage.
      enforceShareRateLimit(database,req,req.user.id);
      const document=database.prepare("SELECT id,user_id,original_name,mime_type,size_bytes,encrypted_path FROM secure_documents WHERE id=? AND user_id=? AND deleted_at IS NULL")
        .get(documentId,application.student_user_id);
      if(!document) {
        database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','not_found',?)")
          .run(crypto.randomUUID(),application.id,application.institution_id,documentId,req.user.id,new Date().toISOString());
        return res.status(404).json({success:false,message:"The student's selected Vault document is no longer available."});
      }
      assertWalletUnlocked(application.student_user_id);
      const payload=JSON.parse(fs.readFileSync(document.encrypted_path,"utf8"));
      const buffer=decryptBuffer(payload,key);
      if(buffer.length!==Number(document.size_bytes)||!ALLOWED_MIME.has(document.mime_type)) {
        database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','error',?)")
          .run(crypto.randomUUID(),application.id,application.institution_id,documentId,req.user.id,new Date().toISOString());
        return res.status(422).json({success:false,message:"The stored document failed its integrity check."});
      }
      const actual=await fileTypeFromBuffer(buffer);
      if(!actual||actual.mime!==document.mime_type) {
        database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','error',?)")
          .run(crypto.randomUUID(),application.id,application.institution_id,documentId,req.user.id,new Date().toISOString());
        return res.status(422).json({success:false,message:"The document content does not match its stored file type."});
      }
      database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','success',?)")
        .run(crypto.randomUUID(),application.id,application.institution_id,documentId,req.user.id,new Date().toISOString());
      res.setHeader("Cache-Control","private, no-store, max-age=0");
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Content-Security-Policy","sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      res.setHeader("Content-Disposition","inline; filename=\""+safeFilename(document.original_name)+"\"");
      res.type(document.mime_type);
      return res.status(200).send(buffer);
    } catch(error) {
      if(auditContext) {
        try { database.prepare("INSERT INTO scholarship_document_access_audit(id,application_id,institution_id,document_id,actor_user_id,action,outcome,created_at) VALUES(?,?,?,?,?,'preview','error',?)")
          .run(crypto.randomUUID(),auditContext.applicationId,auditContext.institutionId,auditContext.documentId,auditContext.actorUserId,new Date().toISOString()); } catch {}
      }
      next(error);
    }
  });

  app.get("/api/institutions/scholarship-applications/:id/audit", requireAuth, requireMfaProduction, (req,res,next) => {
    try {
      const row=database.prepare("SELECT id,institution_id,student_user_id FROM scholarship_applications WHERE id=?").get(String(req.params.id||""));
      if(!row) return res.status(404).json({success:false,message:"Scholarship application was not found."});
      const member=getInstitutionMembership(req.user.id,row.institution_id),isStudent=row.student_user_id===req.user.id;
      if(!isStudent&&(!member||member.status!=="active"||!["reviewer","institution_admin","read_only"].includes(member.role)))
        return res.status(403).json({success:false,message:"You do not have access to this scholarship history."});
      const audit=database.prepare("SELECT action,from_status AS fromStatus,to_status AS toStatus,created_at AS createdAt FROM scholarship_audit WHERE application_id=? ORDER BY created_at ASC LIMIT 100").all(row.id);
      res.setHeader("Cache-Control","private, no-store");res.json({success:true,audit});
    } catch(error){next(error);}
  });

  console.log(JSON.stringify({
    level:"info",
    event:"production_features_registered",
    encryptedDocumentStorage:true,
    identityPersistence:true,
    documentMaxBytes:MAX_DOCUMENT_BYTES
  }));
}
