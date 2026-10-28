import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function backupAlertConfiguration(){
  const resendConfigured=Boolean(process.env.RESEND_API_KEY?.trim());
  const brevoConfigured=Boolean(process.env.BREVO_API_KEY?.trim());
  const smtpConfigured=Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim() && Number(process.env.SMTP_PORT || 587)>0);
  return {
    recipientConfigured:Boolean(process.env.SECURITY_ALERT_EMAIL?.trim()),
    senderConfigured:Boolean(process.env.OTP_FROM_EMAIL?.trim()),
    providerConfigured:resendConfigured || brevoConfigured || smtpConfigured,
    provider:resendConfigured ? "resend" : brevoConfigured ? "brevo" : smtpConfigured ? "smtp" : null
  };
}
function isBackupAlertingConfigured(){ const config=backupAlertConfiguration(); return config.recipientConfigured && config.senderConfigured && config.providerConfigured; }

let status = { enabled:false, lastRunAt:null, lastSuccessAt:null, lastError:null, lastFile:null, alertingConfigured:isBackupAlertingConfigured() };

async function sendBackupAlert(subject, text){
  const to=process.env.SECURITY_ALERT_EMAIL || "";
  const from=process.env.OTP_FROM_EMAIL || "";
  const fromName=(process.env.OTP_FROM_NAME || "SecureID").trim() || "SecureID";
  if(!to || !from) return;
  try{
    if(process.env.BREVO_API_KEY?.trim()){
      const response=await fetch("https://api.brevo.com/v3/smtp/email",{
        method:"POST",
        headers:{"api-key":process.env.BREVO_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({sender:{name:fromName,email:from},to:[{email:to}],subject,textContent:text})
      });
      if(!response.ok) console.error(JSON.stringify({level:"error",event:"backup_alert_email_failed",provider:"brevo",status:response.status}));
      return;
    }
    if(process.env.RESEND_API_KEY?.trim()){
      const response=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({from:fromName+" <"+from+">",to:[to],subject,text})
      });
      if(!response.ok) console.error(JSON.stringify({level:"error",event:"backup_alert_email_failed",provider:"resend",status:response.status}));
      return;
    }
    if(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()){
      const nodemailer=(await import("nodemailer")).default;
      const configuredPort=Number(process.env.SMTP_PORT || 587);
      const port=configuredPort===2525 ? 587 : configuredPort;
      const transport=nodemailer.createTransport({
        host:process.env.SMTP_HOST,
        port,
        secure:String(process.env.SMTP_SECURE || (port===465 ? "true" : "false")).toLowerCase()==="true",
        auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},
        connectionTimeout:10000,
        greetingTimeout:10000,
        socketTimeout:15000
      });
      await transport.sendMail({from:fromName+" <"+from+">",to,subject,text});
      transport.close();
      return;
    }
    console.error(JSON.stringify({level:"error",event:"backup_alert_email_failed",reason:"no_provider_configured"}));
  }catch(error){
    console.error(JSON.stringify({level:"error",event:"backup_alert_email_failed",reason:error?.name||"NetworkError"}));
  }
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
  const documentDir=process.env.DOCUMENT_STORAGE_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH,"secureid-documents") : "./data/secureid-documents");
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
    const databaseBytes=readFileSync(tmp);
    const documents=existsSync(documentDir)
      ? readdirSync(documentDir,{withFileTypes:true})
          .filter(entry=>entry.isFile() && entry.name.endsWith(".json") && entry.name.slice(0,-5).split("-").map(part=>part.length).join("-")==="8-4-4-4-12" && /^[a-f0-9-]+$/i.test(entry.name.slice(0,-5)))
          .map(entry=>({name:entry.name,data:readFileSync(path.join(documentDir,entry.name)).toString("base64")}))
      : [];
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
    rmSync(tmp,{force:true});
    const retention=Math.max(1,Number(process.env.BACKUP_RETENTION_COUNT||7));
    const files=readdirSync(backupDir).filter(name=>name.endsWith(".backup.json")).map(name=>({name,mtime:statSync(path.join(backupDir,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
    for(const file of files.slice(retention)) rmSync(path.join(backupDir,file.name),{force:true});
    status={enabled:true,lastRunAt:Date.now(),lastSuccessAt:Date.now(),lastError:null,lastFile:out,alertingConfigured:isBackupAlertingConfigured()};
    return {success:true,file:out,bytes:plaintext.length,sha256:payload.sha256};
  }catch(error){
    rmSync(tmp,{force:true});
    status={...status,enabled:true,lastRunAt:Date.now(),lastError:String(error?.message||error),alertingConfigured:isBackupAlertingConfigured()};
    void sendBackupAlert("SecureID encrypted backup failed","An automatic SecureID encrypted backup failed at "+new Date().toISOString()+". Review the production logs and backup status immediately.");
    throw error;
  }
}

export function runEncryptedBackupRestoreDrill(){
  const backupDir=process.env.BACKUP_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH,"secureid-backups") : "./data/backups");
  if(!existsSync(backupDir)) throw new Error("Encrypted backup directory does not exist.");
  const candidates=readdirSync(backupDir)
    .filter(name=>/^secureid-.*\.backup\.json$/.test(name))
    .map(name=>({name,fullPath:path.join(backupDir,name),mtime:statSync(path.join(backupDir,name)).mtimeMs}))
    .sort((a,b)=>b.mtime-a.mtime);
  if(!candidates.length) throw new Error("No encrypted production backup is available for the restore drill.");
  const backup=candidates[0];
  const tempRoot=mkdtempSync(path.join(tmpdir(),"secureid-restore-drill-"));
  const restoredDb=path.join(tempRoot,"restored.sqlite");
  const restoredDocuments=path.join(tempRoot,"documents");
  const restoreScript=path.resolve(process.cwd(),"scripts/secure-restore.mjs");
  try{
    const result=spawnSync(process.execPath,[restoreScript,backup.fullPath],{
      encoding:"utf8",
      timeout:120000,
      maxBuffer:1024*1024,
      env:{...process.env,DATABASE_PATH:restoredDb,DOCUMENT_STORAGE_PATH:restoredDocuments}
    });
    if(result.error) throw new Error("Isolated restore command failed: "+result.error.name);
    if(result.status!==0) throw new Error("Isolated restore failed: "+String(result.stderr||"").slice(0,300).replace(/\s+/g," "));
    if(!existsSync(restoredDb)) throw new Error("Isolated restore did not create a database.");
    const restored=new DatabaseSync(restoredDb,{readOnly:true});
    let tableCount=0;
    try{
      const integrity=restored.prepare("PRAGMA integrity_check").all();
      if(integrity.length!==1 || integrity[0].integrity_check!=="ok") throw new Error("Restored database failed SQLite integrity_check.");
      const tables=restored.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
      if(!tables.includes("users")) throw new Error("Restored database is missing the users table.");
      tableCount=tables.length;
    }finally{ restored.close(); }
    const restoredDocumentCount=existsSync(restoredDocuments)
      ? readdirSync(restoredDocuments).filter(name=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i.test(name)).length
      : 0;
    const resultSummary={success:true,backup:path.basename(backup.fullPath),databaseIntegrity:"ok",tableCount,restoredDocumentCount,isolated:true};
    console.log(JSON.stringify({level:"info",event:"encrypted_backup_restore_drill_completed",...resultSummary}));
    return resultSummary;
  }finally{
    rmSync(tempRoot,{recursive:true,force:true});
  }
}

export function getBackupStatus(){ return {...status}; }

export function startAutomaticBackup(){
  const configured=Boolean(process.env.BACKUP_ENCRYPTION_KEY);
  status.enabled=configured;
  status.alertingConfigured=isBackupAlertingConfigured();
  console.log(JSON.stringify({level:status.alertingConfigured?"info":"warn",event:"backup_alert_configuration",...backupAlertConfiguration(),fullyConfigured:status.alertingConfigured}));
  if(!configured){
    console.warn(JSON.stringify({level:"warn",event:"encrypted_backup_disabled",reason:"BACKUP_ENCRYPTION_KEY is not configured"}));
    return;
  }
  if(process.env.BACKUP_RESTORE_DRILL==="true"){
    setTimeout(()=>{
      try{ runEncryptedBackupRestoreDrill(); }
      catch(error){ console.error(JSON.stringify({level:"error",event:"encrypted_backup_restore_drill_failed",errorType:error?.name||"Error",reason:String(error?.message||"unknown").slice(0,300)})); }
    },20_000).unref();
  }
  const intervalHours=Math.max(1,Number(process.env.BACKUP_INTERVAL_HOURS||24));
  const run=()=>{ try{ runEncryptedBackup(); console.log(JSON.stringify({level:"info",event:"encrypted_backup_completed",file:status.lastFile})); }catch(error){ console.error(JSON.stringify({level:"error",event:"encrypted_backup_failed",errorType:error?.name||"Error"})); } };
  // Create a verified encrypted backup shortly after startup so a new deployment
  // does not remain without a recovery point for the first five minutes.
  setTimeout(run,10_000).unref();
  setInterval(run,intervalHours*60*60*1000).unref();
}
