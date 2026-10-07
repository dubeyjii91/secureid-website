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
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_secure_documents_user
      ON secure_documents(user_id, deleted_at);
  `);

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
  app.get("/api/identity/profile",requireAuth,(req,res,next)=>{
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

        logEvent(req.user.id,"IDENTITY_PROFILE_UPDATED");

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
  app.get("/api/documents",requireAuth,(req,res,next)=>{
    try{
      const documents=database.prepare(`
        SELECT
          id,
          original_name AS name,
          mime_type AS mimeType,
          size_bytes AS sizeBytes,
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
          (id,user_id,original_name,mime_type,size_bytes,encrypted_path,created_at)
          VALUES (?,?,?,?,?,?,?)
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
            now
          );

          saved.push({
            id,
            name:safeFilename(file.originalname),
            mimeType:file.mimetype,
            sizeBytes:file.size,
            createdAt:now
          });

          logEvent(req.user.id,"DOCUMENT_UPLOADED");
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

  /*
   * DOCUMENT DOWNLOAD
   * Ownership is checked before decryption.
   */
  app.get("/api/documents/:id",requireAuth,(req,res,next)=>{
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

      logEvent(req.user.id,"DOCUMENT_ACCESSED");

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

        logEvent(req.user.id,"DOCUMENT_DELETED");

        res.json({success:true});
      }catch(error){
        next(error);
      }
    }
  );

  console.log(JSON.stringify({
    level:"info",
    event:"production_features_registered",
    encryptedDocumentStorage:true,
    identityPersistence:true,
    documentMaxBytes:MAX_DOCUMENT_BYTES
  }));
}
