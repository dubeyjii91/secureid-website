import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { enforceShareRateLimit } from "./share-rate-limit.js";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const ALLOWED_DOCUMENT_CATEGORIES = new Set(["general","aadhaar","pan","passport","voter_id","driving_licence","student_id","institution_proof"]);

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
  `);

  try { database.exec("ALTER TABLE secure_documents ADD COLUMN document_category TEXT NOT NULL DEFAULT 'general'"); } catch (error) { if (!String(error?.message || "").includes("duplicate column name")) throw error; }

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
   * PAN / AADHAAR DOCUMENT CHECK
   * This re-checks encrypted-file integrity only. It deliberately cannot
   * determine whether a PAN/Aadhaar was issued by a government authority.
   */
  app.post("/api/documents/:id/verify",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
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
          fileTypeFromBuffer(buffer).then((actual)=>{
            const passed=Boolean(actual && actual.mime===row.mime_type && ALLOWED_MIME.has(actual.mime));
            const status=passed?"passed":"failed";
            const message=passed
              ?"File integrity and file-type checks passed. Document authenticity is NOT verified."
              :"The file content does not match its stored file type. Document authenticity is NOT verified.";
            const checkId=crypto.randomUUID();
            const now=Date.now();
            database.prepare("INSERT INTO identity_document_checks (id,user_id,document_id,document_category,file_integrity_status,authenticity_status,checked_at) VALUES (?,?,?,?,?,'not_verified',?)")
              .run(checkId,req.user.id,row.id,row.document_category,status,now);
            logEvent(req.user.id,"IDENTITY_DOCUMENT_CHECKED",req,{documentCategory:row.document_category,fileIntegrityStatus:status,authenticityVerified:false});
            res.json({success:true,check:{id:checkId,documentId:row.id,category:row.document_category,fileIntegrityStatus:status,authenticityStatus:"not_verified",checkedAt:now,message}});
          }).catch(next);
          return;
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
      const row=database.prepare("SELECT s.document_id,s.user_id,s.expires_at,s.revoked_at,s.share_reason,d.original_name,d.mime_type,d.encrypted_path FROM secure_document_shares s JOIN secure_documents d ON d.id=s.document_id WHERE s.token_hash=? AND d.deleted_at IS NULL").get(tokenHash);
      if(!row || row.revoked_at || Date.now()>=Date.parse(row.expires_at)) return res.status(404).json({success:false,message:"Document share not found or expired."});
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

  console.log(JSON.stringify({
    level:"info",
    event:"production_features_registered",
    encryptedDocumentStorage:true,
    identityPersistence:true,
    documentMaxBytes:MAX_DOCUMENT_BYTES
  }));
}
