import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const backupPath=process.argv[2];
const dbPath=process.env.DATABASE_PATH || "./data/secureid.sqlite";
const key=Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "","base64");
if(!backupPath || !existsSync(backupPath)) throw new Error("Pass a valid encrypted backup file.");
if(key.length!==32) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64 32-byte key.");
const payload=JSON.parse(readFileSync(backupPath,"utf8"));
const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(payload.iv,"base64"));
decipher.setAuthTag(Buffer.from(payload.tag,"base64"));
const decrypted=Buffer.concat([decipher.update(Buffer.from(payload.data,"base64")),decipher.final()]);
const digest=createHash("sha256").update(decrypted).digest("hex");
if(digest!==payload.sha256) throw new Error("Backup integrity check failed.");

let databaseBytes=decrypted;
let documents=null;
if(payload.version===2){
  let snapshot;
  try { snapshot=JSON.parse(decrypted.toString("utf8")); }
  catch { throw new Error("Backup snapshot is invalid."); }
  if(snapshot.version!==2 || typeof snapshot.database!=="string" || !Array.isArray(snapshot.documents)){
    throw new Error("Backup snapshot is incomplete.");
  }
  databaseBytes=Buffer.from(snapshot.database,"base64");
  documents=snapshot.documents;
  for(const item of documents){
    if(!item || typeof item.name!=="string" || !/^[a-f0-9-]+\.json$/i.test(item.name) || typeof item.data!=="string"){
      throw new Error("Backup contains an invalid document entry.");
    }
  }
}else if(payload.version!==1){
  throw new Error("Unsupported backup version.");
}

mkdirSync(path.dirname(path.resolve(dbPath)),{recursive:true});
const stamp=Date.now();
const temp=path.resolve(path.dirname(dbPath),".secureid-restore-"+stamp+".sqlite");
writeFileSync(temp,databaseBytes,{mode:0o600});
if(existsSync(dbPath)) renameSync(dbPath,dbPath+".pre-restore-"+stamp);
renameSync(temp,dbPath);

if(documents){
  const documentDir=path.resolve(process.env.DOCUMENT_STORAGE_PATH || "./data/secureid-documents");
  const parent=path.dirname(documentDir);
  const stage=documentDir+"-restore-"+stamp;
  const previous=documentDir+"-pre-restore-"+stamp;
  mkdirSync(parent,{recursive:true});
  mkdirSync(stage,{recursive:true});
  try {
    for(const item of documents) writeFileSync(path.join(stage,item.name),Buffer.from(item.data,"base64"),{mode:0o600,flag:"wx"});
    if(existsSync(documentDir)) renameSync(documentDir,previous);
    renameSync(stage,documentDir);
    if(existsSync(previous)) rmSync(previous,{recursive:true,force:true});
  } catch(error) {
    rmSync(stage,{recursive:true,force:true});
    if(!existsSync(documentDir) && existsSync(previous)) renameSync(previous,documentDir);
    throw error;
  }
}
console.log(JSON.stringify({success:true,restoredTo:path.resolve(dbPath),restoredDocuments:documents?.length ?? null,sha256:digest}));
