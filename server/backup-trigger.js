import { timingSafeEqual } from "node:crypto";
import { rateLimit } from "express-rate-limit";

const MINIMUM_TOKEN_LENGTH = 32;

function authorized(request, configuredToken) {
  const authorization = String(request.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(configuredToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function registerBackupTrigger({ app, runBackup, env = process.env, now = () => new Date() }) {
  if (!app || typeof app.post !== "function") throw new TypeError("An Express-compatible app is required.");
  if (typeof runBackup !== "function") throw new TypeError("A backup function is required.");

  const backupTriggerRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many backup requests. Try again later." },
  });

  let running = false;

  app.post("/api/internal/backup/run", backupTriggerRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");

    const configuredToken = String(env.BACKUP_TRIGGER_TOKEN || "");
    if (configuredToken.length < MINIMUM_TOKEN_LENGTH) {
      return res.status(404).json({ success: false, message: "Backup trigger is not enabled." });
    }
    if (!authorized(req, configuredToken)) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (running) {
      return res.status(409).json({ success: false, message: "A backup is already running." });
    }

    running = true;
    try {
      const result = await Promise.resolve().then(runBackup);
      if (!result?.success || !/^[a-f0-9]{64}$/i.test(String(result.sha256 || ""))) {
        throw new Error("Backup did not return a verified integrity digest.");
      }
      return res.status(200).json({
        success: true,
        sha256: result.sha256,
        completedAt: now().toISOString(),
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "externally_scheduled_backup_failed",
        errorType: error?.name || "Error",
      }));
      return res.status(500).json({ success: false, message: "Encrypted backup failed." });
    } finally {
      running = false;
    }
  });
}
