import { DatabaseSync } from "node:sqlite";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import path from "node:path";

const dbPath=process.env.DATABASE_PATH || "./data/secureid.sqlite";
const backupDir=process.env.BACKUP_DIR || "./data/backups";
const documentDir=process.env.DOCUMENT_STORAGE_PATH || "./data/secureid-documents";
const key=Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "","base64");
if(!existsSync(dbPath)) throw new Error("DATABASE_PATH does not exist.");
if(key.length!==32) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64 32-byte key.");
mkdirSync(backupDir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
const tmp=path.resolve(backupDir,".secureid-"+stamp+".sqlite");
const out=path.resolve(backupDir,"secureid-"+stamp+".backup.json");

try {
  const db=new DatabaseSync(dbPath);
  try {
    // VACUUM INTO creates a plaintext snapshot. Restrict its permissions immediately
    // and always remove it, including when encryption or document collection fails.
    const previousUmask = process.umask(0o077);
    try {
      db.exec("VACUUM INTO '"+tmp.replaceAll("'","''")+"'");
    } finally {
      process.umask(previousUmask);
    }
  } finally {
    db.close();
  }
  chmodSync(tmp,0o600);
  const databaseBytes=readFileSync(tmp);
  const documents=existsSync(documentDir)
    ? readdirSync(documentDir,{withFileTypes:true})
        .filter(entry=>entry.isFile() && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[.]json$/i.test(entry.name))
        .map(entry=>({name:entry.name,data:readFileSync(path.join(documentDir,entry.name)).toString("base64")}))
    : [];
  // Version 2 snapshots include encrypted vault blobs as well as SQLite metadata.
  const plaintext=Buffer.from(JSON.stringify({
    version:2,
    database:databaseBytes.toString("base64"),
    documents
  }),"utf8");
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  const payload={version:2,createdAt:new Date().toISOString(),sha256:createHash("sha256").update(plaintext).digest("hex"),iv:iv.toString("base64"),tag:tag.toString("base64"),data:ciphertext.toString("base64")};
  writeFileSync(out,JSON.stringify(payload),{encoding:"utf8",mode:0o600,flag:"wx"});
  console.log(JSON.stringify({success:true,file:out,bytes:plaintext.length,sha256:payload.sha256}));
} finally {
  // Never leave a plaintext SQLite snapshot behind on success or failure.
  rmSync(tmp,{force:true});
}
