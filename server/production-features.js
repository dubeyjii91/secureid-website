import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf","image/jpeg","image/png","image/webp"]);

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
  logEvent
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
          "governmentId",
          "verificationStatus"
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
          created_at AS createdAt
        FROM secure_documents
        WHERE user_id = ?
          AND deleted_at IS NULL
        ORDER BY created_at DESC
      `).all(req.user.id);

      res.json({
        success:true,
        documents
      });
    }catch(error){
      next(error);
    }
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

        if(files.length===0){
          return res.status(400).json({
            success:false,
            message:"Select at least one document."
          });
        }

        const saved=[];

        const insert=database.prepare(`
          INSERT INTO secure_documents
          (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at)
          VALUES (?,?,?,?,?,?,?,?)
        `);

        for(const file of files){
          if(!ALLOWED_MIME.has(file.mimetype)){
            return res.status(400).json({
              success:false,
              message:"Unsupported document type."
            });
          }

          const detected=await fileTypeFromBuffer(file.buffer);

          /*
           * file-type does not identify every valid PDF/image variant,
           * so compare the actual detected type whenever available.
           */
          if(
            detected &&
            !ALLOWED_MIME.has(detected.mime)
          ){
            return res.status(400).json({
              success:false,
              message:"File content does not match its declared type."
            });
          }

          const id=crypto.randomUUID();
          const encrypted=encryptBuffer(file.buffer,key);
          const filename=`${id}.json`;
          const absolute=path.join(dataRoot,filename);

          fs.writeFileSync(
            absolute,
            JSON.stringify(encrypted),
            {
              encoding:"utf8",
              mode:0o600
            }
          );

          const now=Date.now();

          insert.run(
            id,
            req.user.id,
            safeFilename(file.originalname),
            file.mimetype,
            file.size,
            absolute,
            "general",
            now
          );

          saved.push({
            id,
            name:safeFilename(file.originalname),
            mimeType:file.mimetype,
            sizeBytes:file.size,
            category:"general",
            createdAt:now
          });

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
        if(detected && !ALLOWED_MIME.has(detected.mime)) return res.status(400).json({success:false,message:"File content does not match its declared type."});
        const previous=database.prepare("SELECT encrypted_path FROM secure_documents WHERE user_id=? AND document_category=? AND deleted_at IS NULL").all(req.user.id,category);
        const id=crypto.randomUUID();
        const encrypted=encryptBuffer(req.file.buffer,key);
        const absolute=path.join(dataRoot,id+".json");
        fs.writeFileSync(absolute,JSON.stringify(encrypted),{encoding:"utf8",mode:0o600});
        const now=Date.now();
        database.prepare("UPDATE secure_documents SET deleted_at=? WHERE user_id=? AND document_category=? AND deleted_at IS NULL").run(now,req.user.id,category);
        database.prepare("INSERT INTO secure_documents (id,user_id,original_name,mime_type,size_bytes,encrypted_path,document_category,created_at) VALUES (?,?,?,?,?,?,?,?)").run(id,req.user.id,safeFilename(req.file.originalname),req.file.mimetype,req.file.size,absolute,category,now);
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
      enforceShareRateLimit(req,req.user.id);
      assertWalletUnlocked(req.user.id);
      const documentId=String(req.body?.documentId || "").trim();
      const row=database.prepare("SELECT id,original_name,mime_type FROM secure_documents WHERE id=? AND user_id=? AND deleted_at IS NULL").get(documentId,req.user.id);
      if(!row) return res.status(404).json({success:false,message:"Document not found."});
      const now=Date.now();
      const expiresAt=new Date(now+SHARE_TTL_MS);
      const token=crypto.randomBytes(32).toString("base64url");
      const tokenHash=crypto.createHash("sha256").update(token,"utf8").digest("hex");
      database.prepare("INSERT INTO secure_document_shares (user_id,document_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)").run(req.user.id,row.id,tokenHash,new Date(now).toISOString(),expiresAt.toISOString());
      logEvent(req.user.id,"DOCUMENT_SHARED",req);
      res.json({success:true,shareToken:token,shareExpiresAt:expiresAt.toISOString(),document:{id:row.id,name:row.original_name,mimeType:row.mime_type}});
    }catch(error){ next(error); }
  });

  app.post("/api/document-share/revoke",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      assertWalletUnlocked(req.user.id);
      const token=String(req.body?.shareToken || "").trim();
      const tokenHash=crypto.createHash("sha256").update(token,"utf8").digest("hex");
      const result=database.prepare("UPDATE secure_document_shares SET revoked_at=? WHERE token_hash=? AND user_id=? AND revoked_at IS NULL").run(new Date().toISOString(),tokenHash,req.user.id);
      if(!result.changes) return res.status(404).json({success:false,message:"Document share not found."});
      logEvent(req.user.id,"DOCUMENT_SHARE_REVOKED",req);
      res.json({success:true});
    }catch(error){ next(error); }
  });

  app.get("/api/document-share/:token",(req,res,next)=>{
    try{
      const token=String(req.params.token || "");
      if(!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return res.status(404).json({success:false,message:"Document share not found."});
      const tokenHash=crypto.createHash("sha256").update(token,"utf8").digest("hex");
      const row=database.prepare("SELECT s.document_id,s.expires_at,s.revoked_at,d.original_name,d.mime_type,d.encrypted_path FROM secure_document_shares s JOIN secure_documents d ON d.id=s.document_id WHERE s.token_hash=? AND d.deleted_at IS NULL").get(tokenHash);
      if(!row || row.revoked_at || Date.now()>=Date.parse(row.expires_at)) return res.status(404).json({success:false,message:"Document share not found or expired."});
      if(!fs.existsSync(row.encrypted_path)) return res.status(404).json({success:false,message:"Shared document unavailable."});
      const plaintext=decryptBuffer(JSON.parse(fs.readFileSync(row.encrypted_path,"utf8")),key);
      res.setHeader("Content-Type",row.mime_type);
      res.setHeader("Content-Disposition",`inline; filename="${safeFilename(row.original_name)}"`);
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

// SECUREID_SHARE_RATE_LIMIT
const SHARE_RATE_WINDOW_MS = 15 * 60 * 1000;
const SHARE_RATE_IP_MAX = 20;
const SHARE_RATE_USER_MAX = 10;
const shareRateByIp = new Map();
const shareRateByUser = new Map();

function consumeShareRate(map, key, max) {
  const now = Date.now();
  const current = map.get(key);

  if (!current || now - current.startedAt >= SHARE_RATE_WINDOW_MS) {
    map.set(key, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= max) return false;

  current.count += 1;
  return true;
}

function enforceShareRateLimit(req, userId) {
  const ip = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
  const userKey = String(userId);

  if (!consumeShareRate(shareRateByIp, ip, SHARE_RATE_IP_MAX)) {
    const error = new Error("Too many share requests. Try again later.");
    error.statusCode = 429;
    throw error;
  }

  if (!consumeShareRate(shareRateByUser, userKey, SHARE_RATE_USER_MAX)) {
    const error = new Error("Too many share requests. Try again later.");
    error.statusCode = 429;
    throw error;
  }

  if (shareRateByIp.size > 5000) {
    for (const [key, value] of shareRateByIp) {
      if (Date.now() - value.startedAt >= SHARE_RATE_WINDOW_MS) {
        shareRateByIp.delete(key);
      }
    }
  }

  if (shareRateByUser.size > 5000) {
    for (const [key, value] of shareRateByUser) {
      if (Date.now() - value.startedAt >= SHARE_RATE_WINDOW_MS) {
        shareRateByUser.delete(key);
      }
    }
  }
}
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
    enforceShareRateLimit(req, req.user.id);

    try{
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
      const selected={};

      for(const field of shareFields){
        if(req.body?.[field] === true){
          selected[field]=field==="governmentId"
            ? maskGovernmentId(profile[field])
            : profile[field] ?? "";
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
          (user_id,token_hash,encrypted_payload,created_at,expires_at)
        VALUES (?,?,?,?,?)
      `).run(
        req.user.id,
        shareTokenHash(token),
        JSON.stringify(jsonEncrypt({
          claims:selected,
          ownerUserId:req.user.id
        },key)),
        new Date(now).toISOString(),
        expiresAt.toISOString()
      );

      logEvent(req.user.id,"IDENTITY_SHARED",req);

      res.json({
        success:true,
        shareToken:token,
        shareExpiresAt:expiresAt.toISOString(),
        wallet:getWalletState(req.user.id)
      });
    }catch(error){ next(error); }
  });

  app.post("/api/wallet/share/revoke",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
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

      logEvent(payload.ownerUserId,"IDENTITY_SHARE_ACCESSED",req);

      res.setHeader("Cache-Control","no-store");
      res.setHeader("X-Content-Type-Options","nosniff");

      res.json({
        success:true,
        claims:payload.claims,
        createdAt:row.created_at,
        expiresAt:row.expires_at
      });
    }catch(error){ next(error); }
  });

  console.log(JSON.stringify({
    level:"info",
    event:"production_features_registered",
    encryptedDocumentStorage:true,
    identityPersistence:true,
    documentMaxBytes:MAX_DOCUMENT_BYTES
  }));
}
