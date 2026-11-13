import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildInstitutionInventory } from "./test-institution-cleanup.js";

function makeDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE institutions (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE institution_memberships (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      user_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE institution_membership_audit (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      membership_id TEXT NOT NULL REFERENCES institution_memberships(id),
      actor_user_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE fee_invoices (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      student_user_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE fee_payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES fee_invoices(id)
    );
    CREATE TABLE subscription_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE admin_audit_log (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL REFERENCES users(id)
    );
  `);
  database.exec(`
    INSERT INTO users VALUES ('owner','owner@example.test','owner'),('student','student@example.test','student');
    INSERT INTO institutions VALUES
      ('rvs','RVS College of Engineering and Technology'),
      ('test','SecureID Test College'),
      ('unrelated','Unrelated College');
    INSERT INTO institution_memberships VALUES ('m-rvs','rvs','student'),('m-test','test','student'),('m-other','unrelated','student');
    INSERT INTO institution_membership_audit VALUES ('ma-rvs','rvs','m-rvs','owner');
    INSERT INTO fee_invoices VALUES ('invoice-rvs','rvs','student');
    INSERT INTO fee_payments VALUES ('payment-rvs','invoice-rvs');
    INSERT INTO subscription_plans VALUES ('pilot','Pilot');
    INSERT INTO sessions VALUES ('owner-session','owner');
    INSERT INTO admin_audit_log VALUES ('owner-audit','owner');
  `);
  return database;
}

test("recursive inventory includes indirect test payments and audits, but excludes accounts and shared data", () => {
  const database = makeDatabase();
  try {
    const inventory = buildInstitutionInventory(database);
    const counts = Object.fromEntries(inventory.tableCounts.map((item) => [item.table, item.count]));
    assert.deepEqual(inventory.missingTargets, []);
    assert.deepEqual(inventory.unsupported, []);
    assert.equal(counts.institution_memberships, 2);
    assert.equal(counts.institution_membership_audit, 1);
    assert.equal(counts.fee_invoices, 1);
    assert.equal(counts.fee_payments, 1);
    assert.equal(counts.institutions, 2);
    assert.equal(counts.users, undefined);
    assert.equal(counts.sessions, undefined);
    assert.equal(counts.admin_audit_log, undefined);
    assert.equal(counts.subscription_plans, undefined);
    assert.equal(inventory.categories.reduce((sum, item) => sum + item.count, 0), inventory.totalRecords);
  } finally {
    database.close();
  }
});

test("dependency order removes child payment and audit rows before their parents while preserving owner and unrelated college", () => {
  const database = makeDatabase();
  try {
    const inventory = buildInstitutionInventory(database);
    assert.ok(inventory.deleteOrder.indexOf("fee_payments") < inventory.deleteOrder.indexOf("fee_invoices"));
    assert.ok(inventory.deleteOrder.indexOf("institution_membership_audit") < inventory.deleteOrder.indexOf("institution_memberships"));
    database.exec("BEGIN IMMEDIATE");
    database.exec("PRAGMA defer_foreign_keys=ON");
    for (const table of inventory.deleteOrder) {
      const ids = [...inventory.selected.get(table).rowids];
      if (!ids.length) continue;
      const placeholders = ids.map(() => "?").join(",");
      database.prepare('DELETE FROM "' + table + '" WHERE rowid IN (' + placeholders + ')').run(...ids);
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM pragma_foreign_key_check").get().total, 0);
    database.exec("COMMIT");
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM users").get().total, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM institutions").get().total, 1);
    assert.equal(database.prepare("SELECT id FROM institutions").get().id, "unrelated");
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM fee_payments").get().total, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM subscription_plans").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sessions").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM admin_audit_log").get().total, 1);
  } finally {
    database.close();
  }
});
