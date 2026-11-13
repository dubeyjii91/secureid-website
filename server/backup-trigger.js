import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { rateLimit } from "express-rate-limit";

const MINIMUM_TOKEN_LENGTH = 32;
const MAX_OFFSITE_BACKUP_BYTES = 400 * 1024 * 1024;

function authorized(request, configuredToken) {
  const authorization = String(request.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(configuredToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function setPrivateHeaders(response) {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

export function registerBackupTrigger({ app, runBackup, getBackupFile, env = process.env, now = () => new Date() }) {
  if (!app || typeof app.post !== "function" || typeof app.get !== "function") throw new TypeError("An Express-compatible app is required.");
  if (typeof runBackup !== "function") throw new TypeError("A backup function is required.");
  if (typeof getBackupFile !== "function") throw new TypeError("A backup file provider is required.");

  const backupTriggerRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many backup requests. Try again later." },
  });
  const backupDownloadRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 4,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many backup downloads. Try again later." },
  });

  let running = false;

  app.post("/api/internal/backup/run", backupTriggerRateLimit, async (req, res) => {
    setPrivateHeaders(res);
    const configuredToken = String(env.BACKUP_TRIGGER_TOKEN || "");
    if (configuredToken.length < MINIMUM_TOKEN_LENGTH) return res.status(404).json({ success: false, message: "Backup trigger is not enabled." });
    if (!authorized(req, configuredToken)) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (running) return res.status(409).json({ success: false, message: "A backup is already running." });

    running = true;
    try {
      const result = await Promise.resolve().then(runBackup);
      if (!result?.success || !/^[a-f0-9]{64}$/i.test(String(result.sha256 || ""))) {
        throw new Error("Backup did not return a verified integrity digest.");
      }

      // The backup manager's sha256 is the encrypted payload's internal plaintext
      // snapshot digest. The download endpoint exposes the SHA-256 of the exact
      // encrypted file bytes, so return that artifact digest to off-site exporters.
      // Also bind it to the file just created; never attest a different "latest" file
      // if another backup appeared between the trigger and export lookup.
      const generatedFileName = String(result.file || "").split(/[\\/]/).pop();
      if (!/^secureid-[A-Za-z0-9T._-]+\\.backup\\.json$/.test(generatedFileName)) {
        throw new Error("Backup did not identify the generated encrypted artifact.");
      }
      const artifact = await getBackupFile();
      if (!artifact || artifact.fileName !== generatedFileName ||
          !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ""))) {
        throw new Error("The newly created encrypted artifact is not the current export candidate.");
      }
      return res.status(200).json({ success: true, sha256: artifact.sha256, completedAt: now().toISOString() });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "externally_scheduled_backup_failed", errorType: error?.name || "Error" }));
      return res.status(500).json({ success: false, message: "Encrypted backup failed." });
    } finally {
      running = false;
    }
  });

  app.get("/api/internal/backup/download", backupDownloadRateLimit, async (req, res) => {
    setPrivateHeaders(res);
    const configuredToken = String(env.BACKUP_TRIGGER_TOKEN || "");
    if (configuredToken.length < MINIMUM_TOKEN_LENGTH) return res.status(404).json({ success: false, message: "Backup export is not enabled." });
    if (!authorized(req, configuredToken)) return res.status(401).json({ success: false, message: "Unauthorized." });

    let artifact;
    try {
      artifact = await getBackupFile();
      if (!artifact || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_OFFSITE_BACKUP_BYTES ||
          !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || "")) ||
          !/^secureid-[A-Za-z0-9T._-]+\.backup\.json$/.test(String(artifact.fileName || ""))) {
        return res.status(413).json({ success: false, message: "Encrypted backup is unavailable or exceeds the off-site transfer limit." });
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "encrypted_backup_export_unavailable", errorType: error?.name || "Error" }));
      return res.status(404).json({ success: false, message: "Encrypted backup is unavailable." });
    }

    res.status(200);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Length", String(artifact.size));
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    res.setHeader("X-Backup-SHA256", artifact.sha256);
    res.setHeader("X-Backup-Created-At", artifact.createdAt);
    const stream = createReadStream(artifact.filePath);
    stream.on("error", (error) => {
      console.error(JSON.stringify({ level: "error", event: "encrypted_backup_export_stream_failed", errorType: error?.name || "Error" }));
      if (!res.headersSent) res.status(500).json({ success: false, message: "Encrypted backup download failed." });
      else res.destroy(error);
    });
    stream.pipe(res);
  });
}
