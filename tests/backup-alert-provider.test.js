import assert from "node:assert/strict";
import { test } from "node:test";
import { startAutomaticBackup } from "../server/backup-manager.js";

test("backup alert configuration reports the provider actually used for delivery", () => {
  const keys = [
    "SECURITY_ALERT_EMAIL",
    "OTP_FROM_EMAIL",
    "BREVO_API_KEY",
    "RESEND_API_KEY",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "BACKUP_ENCRYPTION_KEY",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const messages = [];
  const originalLog = console.log;
  const originalWarn = console.warn;

  try {
    process.env.SECURITY_ALERT_EMAIL = "alerts@example.test";
    process.env.OTP_FROM_EMAIL = "secureid@example.test";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.RESEND_API_KEY = "test-resend-key";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.BACKUP_ENCRYPTION_KEY;
    console.log = (message) => messages.push(JSON.parse(message));
    console.warn = () => {};

    startAutomaticBackup();

    const configuration = messages.find((entry) => entry.event === "backup_alert_configuration");
    assert.equal(configuration.fullyConfigured, true);
    assert.equal(configuration.provider, "brevo");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
