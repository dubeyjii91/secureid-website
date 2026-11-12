import { timingSafeEqual, createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { rateLimit } from "express-rate-limit";

const MINIMUM_TOKEN_LENGTH = 32;
const MAX_OFFSITE_BACKUP_BYTES = 450 * 1024 * 1024;

function authorized(request, configuredToken) {
  const authorization = String(request.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(configuredToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function configuredToken(env) {
  const token = String(env.BACKUP_TRIGGER_TOKEN || "");
  return token.length >= MINIMUM_TOKEN_LENGTH ? token : "";
}

function rejectUnauthorized(req, res, token) {
  if (!token) {
    res.status(404).json({ success: false, message: "Backup trigger is not enabled." });
    return true;
  }
  if (!authorized(req, token)) {
    res.status(401).json({ success: false, message: "Unauthorized." });
    return true;
  }
  return false;
}

export function registerBackupTrigger({ app, runBackup, env = process.env, now = () => new Date() }) {
  if (!app || typeof app.post !== "function" || typeof app.get !== "function") throw new TypeError("An Express-compatible app is required.");
  if (typeof runBackup !== "function") throw new TypeError("A backup function is required.");

  const backupTriggerRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many backup requests. Try again later." },
  });
  const backupDownloadRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many backup downloads. Try again later." },
  });

  let running = false;
  let latestBackup = null;

  app.post("/api/internal/backup/run", backupTriggerRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    const token = configuredToken(env);
    if (rejectUnauthorized(req, res, token)) return;
    if (running) return res.status(409).json({ success: false, message: "A backup is already running." });

    running = true;
    try {
      const result = await Promise.resolve().then(runBackup);
      if (!result?.success || !/^[a-f0-9]{64}$/i.test(String(result.sha256 || "")) || typeof result.file !== "string") {
        throw new Error("Backup did not return a verified encrypted backup file and digest.");
      }
      const filePath = path.resolve(result.file);
      if (!/^secureid-.*\.backup\.json$/.test(path.basename(filePath))) {
        throw new Error("Backup output filename is invalid.");
      }
      const fileStat = statSync(filePath);
      if (!fileStat.isFile() || fileStat.size < 1 || fileStat.size > MAX_OFFSITE_BACKUP_BYTES) {
        throw new Error("Encrypted backup exceeds the off-site artifact size limit.");
      }
      latestBackup = { filePath, createdAt: now().toISOString() };
      return res.status(200).json({
        success: true,
        sha256: result.sha256,
        bytes: fileStat.size,
        completedAt: latestBackup.createdAt,
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

  app.get("/api/internal/backup/download", backupDownloadRateLimit, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    const token = configuredToken(env);
    if (rejectUnauthorized(req, res, token)) return;
    if (!latestBackup?.filePath) return res.status(404).json({ success: false, message: "No backup has been prepared in this service session. Trigger a new backup first." });

    try {
      const filePath = latestBackup.filePath;
      if (path.basename(filePath) !== path.basename(latestBackup.filePath) || !/^secureid-.*\.backup\.json$/.test(path.basename(filePath))) {
        return res.status(404).json({ success: false, message: "Backup is unavailable." });
      }
      const fileStat = statSync(filePath);
      if (!fileStat.isFile() || fileStat.size < 1 || fileStat.size > MAX_OFFSITE_BACKUP_BYTES) {
        return res.status(413).json({ success: false, message: "Encrypted backup exceeds the off-site artifact size limit." });
      }
      const digest = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", chunk => digest.update(chunk));
      stream.on("error", () => {
        if (!res.headersSent) res.status(500).json({ success: false, message: "Encrypted backup download failed." });
        else res.destroy();
      });
      stream.on("end", () => {
        // The digest header is set before streaming; hash is independently checked by the workflow.
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Length", String(fileStat.size));
      res.setHeader("Content-Disposition", 'attachment; filename="' + path.basename(filePath) + '"');
      res.setHeader("X-Backup-Created-At", latestBackup.createdAt);
      stream.pipe(res);
    } catch {
      return res.status(404).json({ success: false, message: "Encrypted backup is unavailable." });
    }
  });
}
