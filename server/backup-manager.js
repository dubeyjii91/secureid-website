import { DatabaseSync } from "node:sqlite";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

let status = { enabled:false, lastRunAt:null, lastSuccessAt:null, lastError:null, lastFile:null, alertingConfigured:Boolean(process.env.SECURITY_ALERT_EMAIL && process.env.RESEND_API_KEY && process.env.OTP_FROM_EMAIL) };

async function sendBackupAlert(subject, text){
  const to=process.env.SECURITY_ALERT_EMAIL || "";
  const apiKey=process.env.RESEND_API_KEY || "";
  const from=process.env.OTP_FROM_EMAIL || "";
  if(!to || !apiKey || !from) return;
  try{
    await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,text})});
  }catch{}
}


function backupKey(){
  const raw=process.env.BACKUP_ENCRYPTION_KEY || "";
  const key=Buffer.from(raw,"base64");
  if(key.length!==32) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function runEncryptedBackup(){
  const dbPath=process.env.DATABASE_PATH || "./data/secureid.sqlite";
  const backupDir=process.env.BACKUP_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH,"secureid-backups") : "./data/backups");
  const key=backupKey();
  if(!existsSync(dbPath)) throw new Error("DATABASE_PATH does not exist.");
  mkdirSync(backupDir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const tmp=path.resolve(backupDir,".secureid-"+stamp+".sqlite");
  const out=path.resolve(backupDir,"secureid-"+stamp+".backup.json");
  const db=new DatabaseSync(dbPath,{timeout:5000});
  try{ db.exec("PRAGMA wal_checkpoint(PASSIVE); VACUUM INTO '"+tmp.replaceAll("'","''")+"'"); }
  finally{ db.close(); }
  try{
    const plaintext=readFileSync(tmp);
    const iv=randomBytes(12);
    const cipher=createCipheriv("aes-256-gcm",key,iv);
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    const tag=cipher.getAuthTag();
    const payload={version:1,createdAt:new Date().toISOString(),sha256:createHash("sha256").update(plaintext).digest("hex"),iv:iv.toString("base64"),tag:tag.toString("base64"),data:ciphertext.toString("base64")};
    writeFileSync(out,JSON.stringify(payload),"utf8");
    rmSync(tmp,{force:true});
    const retention=Math.max(1,Number(process.env.BACKUP_RETENTION_COUNT||7));
    const files=readdirSync(backupDir).filter(name=>name.endsWith(".backup.json")).map(name=>({name,mtime:statSync(path.join(backupDir,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
    for(const file of files.slice(retention)) rmSync(path.join(backupDir,file.name),{force:true});
    status={enabled:true,lastRunAt:Date.now(),lastSuccessAt:Date.now(),lastError:null,lastFile:out};
    return {success:true,file:out,bytes:plaintext.length,sha256:payload.sha256};
  }catch(error){
    rmSync(tmp,{force:true});
    status={...status,enabled:true,lastRunAt:Date.now(),lastError:String(error?.message||error)};
    void sendBackupAlert("SecureID encrypted backup failed","An automatic SecureID encrypted backup failed at "+new Date().toISOString()+". Review the production logs and backup status immediately.");
    throw error;
  }
}

export function getBackupStatus(){ return {...status}; }

export function startAutomaticBackup(){
  const configured=Boolean(process.env.BACKUP_ENCRYPTION_KEY);
  status.enabled=configured;
  status.alertingConfigured=Boolean(process.env.SECURITY_ALERT_EMAIL && process.env.RESEND_API_KEY && process.env.OTP_FROM_EMAIL);
  if(!configured){
    console.warn(JSON.stringify({level:"warn",event:"encrypted_backup_disabled",reason:"BACKUP_ENCRYPTION_KEY is not configured"}));
    return;
  }
  const intervalHours=Math.max(1,Number(process.env.BACKUP_INTERVAL_HOURS||24));
  const run=()=>{ try{ runEncryptedBackup(); console.log(JSON.stringify({level:"info",event:"encrypted_backup_completed",file:status.lastFile})); }catch(error){ console.error(JSON.stringify({level:"error",event:"encrypted_backup_failed",errorType:error?.name||"Error"})); } };
  setTimeout(run,Math.min(5*60*1000,intervalHours*60*60*1000)).unref();
  setInterval(run,intervalHours*60*60*1000).unref();
}
