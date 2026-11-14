import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveDocumentStorageDirectory, runEncryptedBackup, runEncryptedBackupRestoreDrill } from "../server/backup-manager.js";

test("production document path matches the encrypted document store and explicit overrides win",()=>{
 assert.equal(resolveDocumentStorageDirectory({NODE_ENV:"production"}),"/data/secureid-documents");
 assert.equal(resolveDocumentStorageDirectory({NODE_ENV:"production",RAILWAY_VOLUME_MOUNT_PATH:"/data"}),path.join("/data","secureid-documents"));
 assert.equal(resolveDocumentStorageDirectory({NODE_ENV:"production",DOCUMENT_STORAGE_PATH:"/custom/docs",RAILWAY_VOLUME_MOUNT_PATH:"/data"}),"/custom/docs");
 assert.equal(resolveDocumentStorageDirectory({NODE_ENV:"test"}),"./data/secureid-documents");
});

test("encrypted backup includes document blobs and isolated restore verifies the same files",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"secureid-backup-document-test-"));
 const dbPath=path.join(root,"secureid.sqlite"),backupDir=path.join(root,"backups"),documentDir=path.join(root,"secureid-documents");
 const keys=["DATABASE_PATH","BACKUP_DIR","DOCUMENT_STORAGE_PATH","BACKUP_ENCRYPTION_KEY","RAILWAY_VOLUME_MOUNT_PATH","NODE_ENV"];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL); INSERT INTO users VALUES('owner','owner@example.test');");
  db.close();
  mkdirSync(documentDir,{recursive:true});
  const documentId=randomUUID();
  writeFileSync(path.join(documentDir,documentId+".json"),JSON.stringify({version:1,ciphertext:"test-encrypted-document"}),{mode:0o600});
  process.env.DATABASE_PATH=dbPath;
  process.env.BACKUP_DIR=backupDir;
  process.env.DOCUMENT_STORAGE_PATH=documentDir;
  process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString("base64");
  process.env.NODE_ENV="test";
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const backup=runEncryptedBackup();
  assert.equal(backup.documentCount,1);
  const drill=runEncryptedBackupRestoreDrill();
  assert.equal(drill.databaseIntegrity,"ok");
  assert.equal(drill.sourceDocumentCount,1);
  assert.equal(drill.restoredDocumentCount,1);
  assert.equal(drill.documentRestoreVerified,true);
 }finally{
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  rmSync(root,{recursive:true,force:true});
 }
});
