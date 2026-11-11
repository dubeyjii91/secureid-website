import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../mobile/src/expiry-reminders.ts", import.meta.url), "utf8");

function block(signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `function not found: ${signature}`);
  const end = source.indexOf(nextSignature, start + signature.length);
  assert.notEqual(end, -1, `next function not found: ${nextSignature}`);
  return source.slice(start, end);
}

test("expiry reminder preferences are stored in device secure storage", () => {
  assert.match(source, /const ENABLED_KEY = "secureid\.expiry-reminders\.enabled\.v1"/);
  assert.match(source, /const IDS_KEY = "secureid\.expiry-reminders\.ids\.v1"/);
  assert.match(source, /SecureStore\.getItemAsync\(ENABLED_KEY\)/);
  assert.match(source, /SecureStore\.setItemAsync\(ENABLED_KEY, "true"\)/);
});

test("disabling reminders cancels every scheduled notification and clears stored IDs", () => {
  const disable = block("export async function disableExpiryReminders()", "export async function syncDocumentExpiryReminder(");
  assert.match(disable, /setItemAsync\(ENABLED_KEY, "false"\)/);
  assert.match(disable, /Object\.values\(ids\)\.flat\(\)/);
  assert.match(disable, /cancelScheduledNotificationAsync/);
  assert.match(disable, /deleteItemAsync\(IDS_KEY\)/);
});

test("rescheduling a document first cancels its previous reminders", () => {
  const sync = block("export async function syncDocumentExpiryReminder(", "export async function syncAllDocumentExpiryReminders(");
  assert.match(sync, /ids\[document\.id\] \|\| \[\]/);
  assert.match(sync, /cancelScheduledNotificationAsync/);
  assert.match(sync, /delete ids\[document\.id\]/);
  assert.ok(sync.indexOf("cancelScheduledNotificationAsync") < sync.indexOf("scheduleNotificationAsync"));
});

test("reminders are optional and schedule only future 30, 7 and 1 day notifications", () => {
  const sync = block("export async function syncDocumentExpiryReminder(", "export async function syncAllDocumentExpiryReminders(");
  assert.match(source, /const LEAD_DAYS = \[30, 7, 1\]/);
  assert.match(sync, /areExpiryRemindersEnabled\(\)/);
  assert.match(sync, /!document\.expiryDate/);
  assert.match(sync, /triggerDate\.getTime\(\) <= now\.getTime\(\)/);
  assert.match(sync, /Notifications\.scheduleNotificationAsync/);
  assert.match(sync, /documentId: document\.id, kind: "document-expiry"/);
  assert.match(sync, /leadDays === 1[\s\S]*?expires tomorrow/);
});

test("bulk sync disables reminders when notification permission has been revoked", () => {
  const syncAll = source.slice(source.indexOf("export async function syncAllDocumentExpiryReminders("));
  assert.match(syncAll, /if \(!\(await areExpiryRemindersEnabled\(\)\)\) return/);
  assert.match(syncAll, /Notifications\.getPermissionsAsync\(\)/);
  assert.match(syncAll, /permission\.status !== "granted"/);
  assert.match(syncAll, /await disableExpiryReminders\(\)/);
});

test("bulk sync removes scheduled notifications for documents no longer in the vault", () => {
  const syncAll = source.slice(source.indexOf("export async function syncAllDocumentExpiryReminders("));
  assert.match(syncAll, /new Set\(documents\.map\(\(document\) => document\.id\)\)/);
  assert.match(syncAll, /if \(!activeIds\.has\(staleId\)\)/);
  assert.match(syncAll, /cancelScheduledNotificationAsync/);
  assert.match(syncAll, /delete ids\[staleId\]/);
  assert.match(syncAll, /for \(const document of documents\) await syncDocumentExpiryReminder/);
});
